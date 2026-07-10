# Design: fix-station-slot-same-team-race

## Files touched

- `functions/src/runs/index.ts` — `assignNextInActiveStage`, multi-task branch only. After
  `const result = await assignTask(...)`, wrap the team write in `db.runTransaction`:
  - `tx.get(teamRef)`; if the active stage already has a task with `status === 'assigned'`, return
    that task id with `mine: false` (we lost the race).
  - otherwise flip the chosen task to `assigned`/`startedAt` in a deep-copied `stages` array and
    `tx.update(teamRef, { stages, activeTaskId, updatedAt })`, returning `mine: true`.
  - After the transaction, if `!mine`, call `releaseTask(result.taskId, ownerUid, gameId, runId)` to
    reverse `assignTask`'s reservation, and return the task actually in flight.

## Why this is correct

- Firestore serializes transactions contending on `teamRef`: whichever team write commits first is
  seen by the other's re-read (with a retry), so exactly one assignment wins and every loser releases
  its reserved slot. `assignTask` (increment +1) and `releaseTask` (increment −1, floored at 0) are
  symmetric on `run.taskCounts[taskId]`, so the compensation is exact.
- Single-task stages are untouched: they bypass `assignTask` (no counter reserved) and both racers
  select the same task, so an overwrite is idempotent — no leak possible.

## Test strategy

- **e2e (`scripts/e2e-verify.mjs`, emulator):** add a scenario that, for one team on a multi-task
  stage, fires two assignment requests concurrently (e.g. two `requestNextTask` calls, or a
  completion + poll), then asserts via the existing station-counter oracle that
  `Σ run.taskCounts == teams with an assigned/active task` and that all counters return to 0 once the
  run finishes. RED against the old code (leaks a slot), GREEN after.
- The existing "no leaked station slots" invariant in `simulate-run` / `simulate-browser` continues to
  pass.

## Gates

`npm run typecheck` · `npm test` · `npm run e2e` · `npm run verify:emulator` (simulate + adversarial).
