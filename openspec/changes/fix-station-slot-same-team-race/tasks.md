# Tasks: fix-station-slot-same-team-race

## 1. RED — expose the leak
- [ ] Add an e2e scenario to `scripts/e2e-verify.mjs` that fires two concurrent assignment requests
      for the SAME team on a multi-task stage, then asserts `Σ run.taskCounts` equals the number of
      teams with a task in flight (no leaked slot). Confirm it fails against the current code.

## 2. GREEN — atomic claim + compensation
- [x] In `assignNextInActiveStage` multi-task branch, commit the team assignment inside a
      `db.runTransaction` that re-reads the team, yields to an existing in-flight task, and otherwise
      writes the assignment.
- [x] When the race is lost, `releaseTask` the reserved slot and return the winning task id.
- [ ] Confirm the new e2e scenario passes.

## 3. REFACTOR / verify
- [x] `npm run typecheck` green.
- [ ] `npm run e2e` green (new scenario + existing station-contention + idempotence).
- [ ] `npm run verify:emulator` — simulate + adversarial "no leaked station slots" stays green.
