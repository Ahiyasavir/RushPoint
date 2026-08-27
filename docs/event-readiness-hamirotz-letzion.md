# Event readiness — "המירוץ לציון" (דר ריקי יונה), ~100 teams

Prepared 2026-08-27/28. Source game: `users/FkAP7tr1BAa33lJU7AMuNlIbOnp1/games/FQOTOHkLqLn7DiG0i3mq`
— 3 stages, 13 missions, `mode: team`, `smart_weighted`, safe zone radius 5,890 m.

Reproduce every number below with:

```bash
npx tsx scripts/preflight-game.ts <game.json> --teams=120 --minutes=120
```

---

## Verdict

**No structural blocker.** Every mission is completable and every stage is winnable, checked with
the product's own validators (`taskCompletabilityError`, `requiredTaskCountProblem`) — the same ones
`launchRun` enforces. The risks below are all **authored-content** decisions, not code defects, and
every one of them is fixable in the Builder in minutes.

---

## 1. Throughput — the event needs ~2 hours of station time at 120 teams

Station capacity (`maxConcurrentTeams`) is a **hard** cap in routing, and a team with every station
full is held with reason `stationsFull`. So a stage's ceiling is `Σ (cap ÷ duration)` teams/minute.

| Stage | Completions needed (120 teams) | Throughput | Floor |
|---|---|---|---|
| 0 — משימות שדה (3 of 5) | 360 | 5.3/min | 68 min |
| 1 — משימות טנא (2 of 4) | 240 | 4.8/min | 50 min |
| 2 — תהליך היין (1 of 4) | 120 | 54.5/min | 2 min |
| **Total** | | | **~120 min** |

That floor assumes **perfect packing** — real routing and real walking make it longer, never shorter.

**The bottleneck is narrow and specific:** two missions carry `estimatedMinutes: 10` with
`maxConcurrentTeams: 3`, i.e. **0.30 teams/min each**:

- stage 0 — `קומו ונעלה ציון!` (video)
- stage 1 — `חשיפת האוצר במגדל 🏺`

Raising just those two caps from 3 to 6 roughly halves each stage's floor. That is the single
highest-leverage change available before the event.

---

## 2. Three arrival radii are at or below GPS error

`reportArrival` compares the device's fix to the mission's geofence. A consumer phone is good to
roughly 5–15 m in the open and worse beside buildings. These three are at or under that:

| Mission | Radius | Risk |
|---|---|---|
| `מכתב לישעיהו הנביא` (smart_station, `trigger: exact`) | **4 m** | a team standing on the spot can be told it has not arrived |
| `תעודת יינן מבית ראשון` (quiz) | **5 m** | same |
| `שולחן השופטים וסיום המסלול` (field) | **10 m** | this is the **finish line** — a team that cannot check in cannot finish |

The finish-line one is the most serious: everything upstream can work perfectly and teams still fail
to complete. Widening these to 25–30 m costs nothing in gameplay at this scale.

---

## 3. Two missions park teams on a human reviewer

Neither photo mission sets `autoApprove`, so each submission waits for a person.

- `סימון דרך לעולי הרגל` (photo) — ~72 submissions expected at 120 teams
- `קומו ונעלה ציון!` (**video**) — ~72 submissions expected

That is **~144 manual reviews ≈ 72 reviewer-minutes**. Inside a 2-hour window that is one person
reviewing continuously and doing nothing else. Either staff it deliberately, or turn on
auto-approve for one of the two.

Note the second is `captureKind: 'video'`, not a photo — participants record and upload a clip
(cap 20 MB). Expect ~0.6 GB of participant media overall at 120 teams. Disk is not a concern
(72 GB free on the VPS), but review time and upload duration on mobile data are.

---

## 4. What was checked and found healthy

- **Anonymous auth is enabled in production** — verified by a real `accounts:signUp` against the
  live project. (An older note in the project memory said it was disabled; that is stale.)
- **Both sites and the API are up** — `creator.rush-point.com`, `rush-point.com` and
  `api.rush-point.com` all answer 200/401 as expected from off-host.
- **Uploads stream to disk** rather than buffering in RAM (`stream-upload-write`), so peak memory
  per upload is a fixed chunk regardless of file size or concurrency.
- **VPS headroom**: 2.8 GB RAM available, 72 GB disk free, 4 CPUs, load 0.14.
- Every mission's answer key resolves: the two quizzes that look empty are the **ordering** variant
  (`orderItems`), which is graded by order, not by an `answers` array.

---

## 5. Recommended changes before the event

In priority order, all in the Builder, all quick:

1. **Widen the finish-line geofence** (`שולחן השופטים וסיום המסלול`) from 10 m to ~30 m.
2. **Widen** `מכתב לישעיהו הנביא` (4 m) and `תעודת יינן מבית ראשון` (5 m) to ~25 m.
3. **Raise `maxConcurrentTeams` from 3 to 6** on the two 10-minute missions.
4. **Decide the review plan**: either assign a dedicated reviewer, or enable auto-approve on one of
   the two media missions.

Items 1–3 are strictly safer at this scale; none of them changes what the game asks players to do.

---

## 6. Firebase quota — the thing that would actually have stopped the event

Measured against **production** (`api.rush-point.com` with server-side op counting on), not
estimated. Spark allows **50,000 reads and 20,000 writes per day**, and one event has to fit
inside one day.

### Writes: fixed

`updateLocation` cost **2 writes per ping**. For 100 teams over 75 minutes that is 54,000 writes
— 2.7× the daily ceiling from location alone. After `spark-tier-location-load` the pin is
written at most once a minute (immediately on a real move) and the history track keeps a point
per ~100 m instead of per ping:

| | before | after | ceiling |
|---|---|---|---|
| writes, 100 teams | ~54,000 | **13,500** | 20,000 |

### Reads: found, and fixed

Adding the op counter immediately showed the read side was worse, and that **location was not
the culprit**:

| source | reads at 100 teams | share |
|---|---|---|
| `getMyTeamState` polled every 12 s | 61,125 | **65%** |
| `updateLocation` every 20 s | 22,500 | 24% |
| everything else | ~10,000 | 11% |
| **total** | **~93,600** | vs a 50,000 ceiling |

The participant screen polled every 12 seconds *in addition to* a live document listener that
already pushes every change. The poll is a fallback for the leaderboard and for listener
recovery — neither needs 12 seconds. `participant-read-budget` changes it to 45 s and stops the
client sending location fixes the server was going to discard anyway (it applies the server's
own verdict, with a 60-second safety floor so a safe-zone breach is still caught).

| | before | after | ceiling |
|---|---|---|---|
| reads, 100 teams | ~93,600 | **~33,800** | 50,000 |
| reads, 120 teams | ~112,300 | **~40,600** | 50,000 |

Measured in the gate's own test: a walking team now sends **76 of 226 fixes — 66% withheld** —
while still reporting often enough that the live staff map stays useful.

**Verdict: 100 teams fits, with roughly a third of the read budget spare. 120 teams fits at
about 81% of the ceiling** — enough to run, thin enough that it should be watched rather than
assumed.

### One caveat worth stating plainly

These figures count reads the **server** performs. The participant app also holds client-side
Firestore listeners (team document, chat, announcements, photo feed) whose reads are billed but
are invisible to the server-side counter. They are small per team, but they are not zero, and
they are not in the table above.

---

## 7. One open defect, found while testing — not yet fixed

The 8-team emulator load simulation occasionally reports:

```
VIOLATION  no player callable surfaced INTERNAL under load :: 1x [completeTask]
```

`completeTask` returns an opaque `internal` error to the player. The harness's own comment
identifies this class as an un-retried Firestore `ABORTED` under the single-run-document lock.
**The player sees "something went wrong" on an action that actually succeeded server-side** — a
reload shows the points banked, which is why it reads as random rather than as a bug.

Reproduction rate measured tonight, 8 teams:

| server code | clean runs | violations |
|---|---|---|
| before the location change | 3 | 0 |
| after the location change | 4 | 1 |

That is **not enough evidence to attribute it to the location change**, and it did not reproduce
in the three most recent runs on current code. It is rare (~1 in 5 at 8 teams) and appears to be
pre-existing. It is recorded here rather than dismissed because the failure rate under lock
contention should be expected to rise with team count, and at ~100 teams a rare error becomes a
regular one. Next step is to reproduce at `--teams=16`, where the harness notes it becomes
reliable, and capture the underlying Firestore error.

Not a launch blocker on its own: the action succeeds, the score is correct, and the player
recovers by reloading. But it is the most likely source of "the app showed an error" reports on
the day.
