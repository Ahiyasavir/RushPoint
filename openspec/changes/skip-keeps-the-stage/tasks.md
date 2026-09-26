# Tasks: skip-keeps-the-stage

## 1. RED

- [x] 1.1 `scripts/test-gate-satisfaction.ts` against the not-yet-existing `satisfiesGate` /
      `gateSatisfiedTaskIds` (design D1) and the new `unreachableTaskIds` behaviour (D3), using the
      exact 2026-09-22 chain (`f13163ca` → `2b83fd50` → `c42b88d4`). Confirm it fails for the right
      reason (missing export, then: dependents retired).
- [x] 1.2 Add `dependentsOpened` + chain `stageCompletes` rows to `scripts/test-skip-single-task.ts`.
      Confirm RED.
- [x] 1.3 Vitest for `applyStageCompletion` on the chain with the head `skipped/operator`: stage stays
      active. Confirm RED (today it completes).
- [x] 1.4 e2e scenario "skip keeps a chained stage" in `scripts/e2e-verify.mjs` (design, test strategy),
      including the `dryRun` no-write assertion. Run `npm run e2e`; confirm exactly these fail.

## 2. GREEN

- [x] 2.1 `RunTaskRecord.skipCause?: 'operator' | 'operatorStage' | 'exclusive' | 'expired' | 'unreachable' | 'stageSatisfied'`
      in `packages/shared/src/types/index.ts`.
- [x] 2.2 `satisfiesGate`, `gateSatisfiedTaskIds` in `gating.ts`; `unreachableTaskIds` seeds `alive`
      from them; rename `isUnlocked`'s parameter to `satisfiedTaskIds`. 1.1 → green.
- [x] 2.3 Stamp `skipCause` at all six writers (design table). 1.3 → green.
- [x] 2.4 Pass `gateSatisfiedTaskIds` to every `isUnlocked`/`lockedTaskIds` call in
      `routing/assignNextTask.ts` and `runs/index.ts` (keep `completedTaskIds` for the "already done"
      exclusion).
- [x] 2.5 `planTaskSkip`: `dependentsOpened`, `stageCompletes` after D3. 1.2 → green.
- [x] 2.6 `skipTaskForTeam({ dryRun: true })` (design D5); both apps' `services/calls.ts` wrappers gain
      the flag and the result fields. 1.4 → green.
- [x] 2.7 Participant sanitizer: allow-list `skipCause` on task records; `LockedTasksList` uses
      `gateSatisfiedTaskIds`.
- [x] 2.8 Confirm dialogs in `RunConsolePage.tsx` (`skipTeamTask`) and `StaffConsole.tsx` (`skipTask` op)
      render the dry-run result in words; fall back to the generic copy on failure. i18n he/en.

## 3. REFACTOR

- [ ] 3.1 One helper builds `{completedTaskIds, gateSatisfiedTaskIds}` from `team.stages`; replace the
      four hand-rolled `flatMap(...).filter(completed)` copies in `runs/index.ts`.
- [ ] 3.2 Add a CLAUDE.md gotcha: "a skipped prerequisite is satisfied ONLY for an operator skip;
      read `satisfiesGate`, never `status === 'completed'`".

## 4. Verify

- [ ] 4.1 Preview: creator console, a team on the head of a chain, open skip ⇒ the dialog names the
      mission that opens and says the stage continues; confirm ⇒ the team is routed to it.
- [ ] 4.2 `npm run verify` and `npm run e2e` green (exit codes captured to a file).

## Progress notes (2026-09-25)

- The chain from production run oNaUvNrCWRia4Y1b9xOO is the fixture in every lane (pure, vitest, e2e).
- Found while implementing: `planTaskSkip` did not know the unlock graph, so the console's preview
  would have said "the stage continues" while the server ended it. It now uses the same
  `unreachableTaskIds` the completion path uses, and reports `dependentsOpened`.
- Found while implementing: `getRecommendedTasks` passed the WHOLE stage and excluded only completed
  ids, so an expired or exclusive-lost task could be recommended. Now it offers unassigned tasks only.
  (No app calls it today; e2e covers it.)
- Critical review: between missions the dry run says "not on a mission right now"; both consoles now
  say so instead of asking to confirm a skip that would then fail.
- Wording decided once in `packages/shared/src/skipPreview.ts` (tested by `scripts/test-skip-preview.ts`).
- 1.4 honesty: the e2e scenario was written after the server change, so it was NOT observed RED
  against the old code. RED was proven in the pure lane (test-gate-satisfaction, test-skip-single-task)
  and in vitest (helpers.test.ts e2/e3); the e2e proves the integrated GREEN.
