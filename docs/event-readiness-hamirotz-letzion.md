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

## 7. A defect I reported here earlier was not real

An earlier version of this document recorded `completeTask` intermittently surfacing an opaque
`INTERNAL` under load as an open defect. **That was wrong, and this is the correction.**

Running the load simulation at 16 teams and counting carefully:

| run | INTERNAL errors | emulator "function timed out after ~60s" | "socket hang up" |
|---|---|---|---|
| with the read-cost fixes | 5 | 5 | 5 |
| with the read-cost fixes | 8 | 8 | 8 |
| **without** them (control) | 21 | 21 | 21 |

A one-to-one correlation in every run. The errors are the **Firebase Functions emulator's
60-second function timeout**, hit because the emulator runs callables through a worker pool on
one laptop and saturates at 16 concurrent teams. Two further facts confirm it: the callables
logged 253 `callable.ok` and **zero** `callable.error`, so nothing ever reached the handler's
error path; and the 100-team **production** run made ~11,000 callables with not one INTERNAL.

Note the control column: the version WITHOUT the read reductions timed out four times as often.
Fewer reads means shorter functions, which means fewer timeouts — the fixes improve this rather
than causing it.

**Lesson worth keeping:** an emulator saturating on a developer laptop and a product failing
under load produce the same red line in the same suite. Counting the emulator's own timeout
messages is what separated them, and it took three runs plus a control to be sure.

## 8. The 120-team production rehearsal — what actually happened

Run against `api.rush-point.com` with the real game copied into the operator's own account,
100+ real anonymous identities, real GPS movement, and real photo and video uploads.

### It found a genuine event-stopping bug, and the fix is verified

The first attempt died in the **join** phase:

```
10 ABORTED: Aborted due to cross-transaction contention.
note: 'Exception occurred in retry method that was not classified as transient'
```

`joinRun` enforces the capacity cap inside a transaction that reads and writes the ONE run
document, so every simultaneous join queues on the same lock — and an event begins with the
whole field scanning the same QR code in the same minute. It reached the participant as an
opaque `INTERNAL`. `joinTeamAsDevice` had the same flaw on the run-wide device counter.

Both are now wrapped in `withLockRetry` (the helper that already protected the routing paths
after this same bug class was found in `completeTask`). **Re-run after the fix: 100 of 100
teams inside the cap joined successfully, zero contention errors.**

A declared static guard (`scripts/test-transaction-retry.ts`) now fails the build if a
transaction that many participants can enter at once is left unwrapped, or if a declared site
is renamed out from under the check.

### The 20 refusals were correct behaviour

Teams 101–120 were refused with `resource-exhausted`:

> This free run is full (100 participants max). The host can add an Event Credit or go Pro for more.

**This matters for the event.** A free run caps at **100 participants**, and ~100 teams means
zero headroom — one extra phone and someone is turned away. Launch with an Event Credit or Pro
if the field might exceed 100.

### What the run measured

| | |
|---|---|
| teams joined | 100 / 100 within cap (20 correctly refused) |
| teams finished | 75 / 100 within the harness's turn limit |
| wall time | 9.8 min (compressed — teams do not really walk between stations) |
| `stationsFull` holds | **2,027** |
| callable p50 latency | 380–650 ms; `submitTaskAnswer` p50 2.4 s, p95 4.3 s |

**`stationsFull` 2,027 times is the headline.** It is the throughput ceiling from §1 showing up
in practice: teams spend most of the game queueing for stations, not playing. This is authored
capacity, not a code limit — raising `maxConcurrentTeams` on the two 10-minute missions is the
fix.

### Testing stopped deliberately, short of a final clean 120-team pass

The op counter showed **~39,000 of the 50,000 daily reads already spent** on tonight's testing.
Another full pass costs ~33,000 and would have exhausted the day's quota — which would take the
**live** site down for real users until the quota resets (07:00 UTC). Stopped rather than
risk that.

What remains is one clean 120-team pass with the corrected harness, after the quota resets and
well before the event. Everything it would validate has already been validated at 6 and 100
teams; the outstanding value is confirming the finish rate once the harness stops re-submitting
photos.

---

## 9. Read cost after the fixes: MEASURED, 0.69x of the ceiling

Section 6 projected the read budget and was **wrong twice** before it was right, both times for
the same reason: per-call costs were measured in a compressed simulation, where anything
throttled by wall-clock fires far less often per unit of game time than it really does. Modelled
honestly at real time-scale the figure was ~83,000 reads, 1.66x over.

Two costs dominated, and both were invisible:

- **The live leaderboard refresh** runs inside player callables on a 20-second throttle and read
  **every team document** uncached: ~27,450 reads at 120 teams. Its cost was billed to whichever
  player action triggered it, which is why `submitTaskAnswer` measured 10.53 reads/call while its
  own logic touches three documents.
- **`resolveCallerTeam`** is the most-called read in the product: every participant callable
  resolves its team through it, ~23,000 times per run, one uncached read each.

Both now use the cache that `listRunTeams` already used. Measured against production, before and
after, per call:

| callable | before | after | |
|---|---|---|---|
| `listRunTeams` | 68.31 | **8.00** | -88% |
| `updateLocation` | 1.01 | **0.07** | -93% |
| `reportArrival` | 2.00 | **0.00** | -100% |
| `submitTaskAnswer` | 10.53 | **6.81** | -35% |
| `completeTask` | 10.69 | **8.00** | -25% |
| `joinRun` | 15.15 | **10.25** | -32% |
| `getMyTeamState` | 1.54 | **1.37** | -11% |

Projected from those measured costs, 120 teams over 75 minutes:

| | reads | |
|---|---|---|
| players | 24,030 | |
| run console | 7,200 | |
| leaderboard refresh | 2,700 | |
| one-off (launch, joins) | 320 | |
| **total** | **34,250** | **0.69x of the 50,000 ceiling** |

Writes land around 15,600 of 20,000 (0.78x) and are now the **tighter** of the two. The
identified lever if that ever needs headroom is the post-run movement track, which exists only
to draw the heatmap: making it a per-run opt-in takes it to zero for runs nobody analyses.

### What is still owed

**A full 120-team production run against these fixes.** Tonight's testing had already spent
roughly 39,000 of the day's 50,000 reads before these changes landed, and another full pass
costs ~34,000 — it would have exhausted the quota and taken the **live** site down for real
users. The Spark day resets at 07:00 UTC (10:00 Israel time).

Everything the final pass would exercise has been validated at 8 and 100 teams: 100 concurrent
joins with zero contention errors, every mission type completing, real photo and video uploads,
and the per-call costs above. What the full pass adds is confirmation that the projection holds
at the real number, which is worth having before an event and is not worth breaking the live site
for tonight.

