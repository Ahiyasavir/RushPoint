## Why

`startInstantPlay` (`functions/src/runs/index.ts:2452-2524`) is the engine behind the flagship
demo (`gameId demo-instant-spy`) and every marketplace "play now" run. It creates a run that is
`selfGuided: true, maxParticipants: 1, participantCount: 1` with **no organizer** and registers the
caller as the sole team (`:2498-2512`).

Nothing ever finalizes such a run. `finalizeRun` (`:1826-1884`) is the ONLY thing that writes
`run.leaderboard`, and it is a creator-authenticated callable — there is no creator on an
instant-play run to call it. Every finish path only flips the TEAM to `status:'finished'`
(`completeTaskForTeam` `:1088`, `skipStage` `:1215`, `skipTaskForTeam` `:1390`, the poll sweeps
`:3135/:3199/:3235`); none writes `run.leaderboard`, and the live snapshot is computed lazily and
never persisted during play (`completeTask` WO Fix 4, `:1110-1121`).

So a first-time demo player who finishes lands on `FinalScreen` with `run.leaderboard` null and:

- the perpetual **"Waiting for the host to finalize the leaderboard…"** spinner
  (`apps/play-web/src/screens/FinalScreen.tsx:284-289`) — but there is no host;
- **no rank medal / podium** — `myRank` comes from the gated `board`, which is null (`:39-42, :86, :176`);
- **no badges** — player profiles are recorded by the `onRunFinalized` trigger on the run's
  `status:'finished'` transition (`:1919-1932`, `recordPlayerResult` `:1130`), which never fires
  because the RUN doc stays `status:'live'`.

This is the single most important conversion moment in the funnel — a stranger who just tried the
product — and it dead-ends in confusion.

## What Changes

- Extract `finalizeRun`'s authoritative write body into an internal, reusable
  `finalizeRunCore(ownerUid, gameId, runId, opts?)` that reads the game + teams, runs the EXISTING
  `buildRankings`, and writes the run doc (`status:'finished'`, a frozen `leaderboard`, reconciled
  `taskCounts`) — the exact write `finalizeRun` does today. `finalizeRun` the callable keeps its
  auth/ownership checks and delegates the write to this core, so live/final scoring stays identical.
- Add an internal, best-effort `maybeAutoFinalizeSoloRun(ownerUid, gameId, runId)` that finalizes a
  run **only** when it is `selfGuided === true` AND `participantCount <= 1` AND its sole team has
  reached `status:'finished'` AND the run is not already finished. It calls `finalizeRunCore` with a
  forced `publish: true` (there is no host to stage a reveal), giving the solo finisher a real
  rank #1, podium, badges and a published board.
- Invoke `maybeAutoFinalizeSoloRun` from the single shared grading choke point
  `completeTaskForTeam` (after its transaction commits, best-effort, never throwing) so it covers
  every grading callable (`completeTask`, `submitTaskAnswer`, `submitSequenceStep`,
  `verifyStationCode`, `submitStationPhoto`, `reviewStationSubmission`) through one call site.

## What does NOT change

- **A normal organizer run is untouched.** The guard requires `selfGuided === true`; a launched run
  (`launchRun`) is not self-guided, so it still waits for the organizer's manual `finalizeRun` and
  the "🤫 withheld" staged-reveal path stays exactly as-is. No multi-team run is ever auto-finalized.
- `buildRankings` and every scoring/ranking rule — reused verbatim, not duplicated.
- The `onRunFinalized` trigger fires exactly as it does for a manual finalize (same
  `status:'finished'` transition), so badges/profile/benchmark/summary are recorded the same way,
  once, idempotently under its existing transition guard.
- No new callable is added (the core + helper are internal), so the e2e callable-coverage guard is
  unaffected.

## Impact

- Affected specs: `instant-play-finalization` (new capability, requirements ADDED).
- Affected code: `functions/src/runs/index.ts` — extract `finalizeRunCore`, add
  `maybeAutoFinalizeSoloRun`, one best-effort call in `completeTaskForTeam`.
- Affected tests: `scripts/e2e-verify.mjs` — a new scenario (authoritative gate; UNVERIFIED here,
  the implementer runs `npm run e2e`).
- NOT touched: `apps/play-web` (the fix makes the EXISTING FinalScreen render correctly with a
  real board; no client change required), the client `services/calls.ts`, `packages/shared`.
