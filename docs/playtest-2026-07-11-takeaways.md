# RushPoint — Family Playtest Takeaways & To-Do (2026-07-11)

> **Status (2026-07-12):** All four **P0** items are implemented as SDD+TDD OpenSpec changes and are
> gate-green (P0-1/P0-2 also pass `e2e`): `fix-nonfinite-callable-payload` (P0-1, root cause of the
> Infinity crash → also fixes P0-4's analytics-crash class), `fix-getmyteamstate-hotpath-writes`
> (P0-2, the 20s freezes), `fix-play-offline-continuity` (P0-3), `fix-post-run-analytics-visibility`
> (P0-4). The seven **P1** items are being authored as OpenSpec changes now, then implemented serially.
> Uncommitted on `topographic-maps`.


Combines the live playtester feedback with hard telemetry from the run's emulator log
(`.firebase/playtest-forever.log`, `runId QhCxBck1gfN15z6OxO7M`). Priorities: **P0** = broke or
badly degraded the run; **P1** = confused/hurt the experience; **P2** = polish / nice-to-have.

---

## Telemetry summary (objective signal from the run)

| Callable | Failure | Count | Notes |
|---|---|---|---|
| `getMyTeamState` | `Transaction lock timeout` (ABORTED, code 10) | 73 | latencies **17–21 s** |
| `getMyTeamState` | returned `Infinity` → JSON-encode crash | 47 | whole response lost |
| `refreshLeaderboard` | `Infinity` → JSON-encode crash | 4 | live board / analytics dead |
| `submitStationPhoto` | `invalid-argument` | 13 | confusing photo error |
| `captureZone` | `failed-precondition` ("Not within the zone") | 8 | zone invisible on map |
| `completeTask` | `failed-precondition` | 7 | — |

---

## P0 — broke the run (fix first)

### P0-1 · Non-finite number crashes player state + leaderboard  *(NEW — telemetry)*
`getMyTeamState` and `refreshLeaderboard` returned `Infinity`, failing JSON encoding 51× — the
player screen and live leaderboard got an error instead of data. Explains "stuck at 0", frozen
screens, and the broken analytics (#8). `applyZScoreBonus`/`computeSkillRatio` are already guarded,
so the non-finite value is leaking through another field.
- Pinpoint which numeric field is `Infinity` (add a `sanitizeFinite()` pass over the payload as a
  guaranteed backstop, then trace the true source).
- Add a property-test / e2e assertion that no callable returns a non-finite number.

### P0-2 · `getMyTeamState` writes on the hot read path → 20 s lock timeouts  *(NEW — telemetry)*
Polled by every device, but it also does blocking `.update()`s (scheduled-release unlock
`runs/index.ts:2614`, expiry sweep `:2632`). Under concurrency these contend → 17–21 s
`Transaction lock timeout`. This is the core "screen freezes / feels unstable" cause.
- Make the read path read-only; move the unlock/sweep writes to a debounced/best-effort path or a
  dedicated mutation, guarded so a write failure never fails the read.
- Add throttling/backoff to the client poll; consider a Firestore snapshot listener instead of poll.

### P0-3 · Offline resilience — keep the screen alive through reconnects  *(#3)*
When connectivity drops the screen freezes/breaks instead of holding steady. Combined with P0-2's
20 s hangs it reads as "the app crashed."
- Keep last-known state on screen; show a non-blocking "reconnecting…" affordance; never blank out.
- Ensure the poll/listener resumes cleanly and the game "continues to feel alive."

### P0-4 · Post-game analytics broken after finishing  *(#8)*
Analytics screen doesn't work after game end. Almost certainly downstream of P0-1 (leaderboard
payload crash). Re-verify after P0-1; fix any remaining finalize-time analytics path.

---

## P1 — confused or hurt the experience

### P1-1 · Photo task: camera-only capture, no upload/data blowup  *(#1)*
- Replace the file-upload control with a **native camera-capture-only** button (no gallery picker,
  no link). (`capture="environment"` + drop the file-picker affordance.)
- Compress/downscale client-side before upload — uploads were huge and slow on mobile data.
- Kill the confusing `"photo must be uploaded to your own team folder"` error (13× in the run):
  fix the path/validation so a normal capture just works, and replace any remaining message with
  plain language.

### P1-2 · Play screen layout: hierarchy + no scroll  *(#4)*
- Put the **primary task front and center at the top**, large and legible.
- Move low-priority info (territory-capture status, hot zones, etc.) **to the bottom**.
- Eliminate the main-screen scroll so the core task is always visible without hunting.

### P1-3 · Territory capture: draw zones on the map + verify re-capture  *(#7)*
- **Render capturable zones on the map** (center + radius + current holder). They're currently
  invisible — this is why players couldn't tell where to stand (8× "Not within the zone").
- `canCapture` correctly allows any non-holder to re-capture, so the "couldn't re-capture" report is
  most likely the invisibility. Re-test capture flow end-to-end once zones are drawn; if a real
  re-capture bug remains, chase it then.

### P1-4 · Hidden-location task: leak guard  *(#2)*
When a creator hides a task's location (hint-based), warn about — and ideally auto-strip — anything
that reveals the location in the **title or description**, since a leak there defeats the mechanic.
- Builder-time warning + optional auto-scrub; server sanitizer as a backstop.

### P1-5 · Trivia/quiz: lenient location verification  *(#5)*
Add flexible presence verification so quiz/trivia answers can't be submitted from anywhere.
- Reuse the geofence check with a generous radius (configurable, lenient), gated per task.

### P1-6 · Intro / instructions page  *(#6)*
Let creators author an intro/instructions screen, viewable **before launch** and **inside the live
game**, explaining mechanics (territory capture, hot zones, etc.). These feel unexplained today.

### P1-7 · Feedback → email run summary to the creator  *(#9)*
Survey results currently land nowhere the creator sees. Desired: an **email run-summary/report**
after each run (standings, completion stats, feedback digest, photos).
- Depends on the (currently blocked) email/transport setup; wire an owner-facing in-app summary in
  the meantime so nothing is lost.

---

## P2 — polish / follow-ups

- `completeTask` `failed-precondition` (7×) — audit for a legit race vs. stale client state.
- Client poll cadence / payload size review once P0-2 lands (bandwidth + battery).
- Add a "no non-finite numbers" invariant to the e2e oracle so P0-1 can't regress.

---

## Suggested order
1. **P0-1** (Infinity crash) — unblocks player state, leaderboard, and analytics in one shot.
2. **P0-2 / P0-3** (hot-path writes + offline stability) — kills the "frozen/unstable" feel.
3. **P1-1** (camera-only photo) and **P1-2** (layout) — biggest felt UX wins.
4. **P1-3** (zones on map) — restores the territory feature.
5. Remaining P1s, then P2.
