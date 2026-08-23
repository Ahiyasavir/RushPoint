## 1. RED — reproduce the strand and pin the decision

- [x] 1.1 Add `packages/shared/src/gating.unreachable.test.ts` (vitest) for `unreachableTaskIds` and
      `exclusiveUnlockRisks`, covering every case in the design's Test Strategy.
- [x] 1.2 Extend `functions/src/runs/helpers.test.ts`: with `a1` skipped, `a2` completed and `b`
      gated on `a1`, `applyStageCompletion` must complete the stage and retire `b`; plus scoring,
      the assigned dependent, the untouched playable gate, transitivity and `requiredTaskCount`.
- [x] 1.3 Run both files and record the failures verbatim.

## 2. GREEN — resolve reachability at run time, warn at build time

- [x] 2.1 `packages/shared/src/gating.ts`: `unreachableTaskIds(tasks, statusByTaskId)` as a least
      fixpoint seeded with completed and assigned tasks (terminates on cycles, never returns a task
      the team started or finished).
- [x] 2.2 `packages/shared/src/gating.ts`: `exclusiveUnlockRisks(stage)` via a prerequisite closure
      against `effectiveExclusiveGroups`, so the choice search needs no enumeration.
- [x] 2.3 `functions/src/runs/helpers.ts`: retire the unreachable tasks at the top of
      `applyStageCompletion`, before it counts. Marked `skipped` with no award, matching the
      exclusive group retire loop. Both existing callers inherit it.
- [x] 2.4 `functions/src/runs/index.ts`: heal an ALREADY stranded team on its `requestNextTask`
      poll, guarded by the pure check so a healthy team pays nothing, skipped while a task is in
      flight.
- [x] 2.5 `apps/creator-web/src/i18n.ts` (ADDITIVE, shared file): HE + EN copy for the branch
      warning. No dashes of any kind.
- [x] 2.6 `apps/creator-web/src/pages/BuilderPage.tsx`: render the warning beside the existing stage
      warnings. Advisory only, never a save or launch blocker.
- [x] 2.7 Re-run both test files — green.

## 3. REFACTOR / verify

- [x] 3.1 Confirm no site re-derives reachability locally, and that `validateUnlockGraph`,
      `gameReadiness` and `stagesProblems` are unchanged (this is not a launch blocker).
- [x] 3.2 Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`, `npm run i18n:check:strict`.
- [x] 3.3 `npx openspec validate unreachable-task-strand --strict`.
- [x] 3.4 Report the e2e assertions owed (that lane owns `scripts/e2e-verify.mjs`).
