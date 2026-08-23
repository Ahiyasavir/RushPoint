# Tasks — visible-time-estimates

## RED

- [x] 1. Write `packages/shared/src/taskEstimate.test.ts` against the not-yet-existing
  `./taskEstimate` module: every task type, locationless, no coordinates, the `0,0` sentinel, a
  single-stop stage, far-apart stops, absurd coordinates, `NaN` coordinates, a non-array sibling
  list, median-not-mean, an explicit author value winning, malformed authored values, and both
  clamps. Run `npm test -w @rushpoint/shared` and record the failure verbatim.

## GREEN

- [x] 2. Add `packages/shared/src/taskEstimate.ts`: the constants, `transitAllowanceMinutes(task,
  siblings)` and `defaultEstimatedMinutes(task, siblings)` reusing
  `defaultExpectedDurationMinutes` for the interaction half, plus
  `effectiveEstimatedMinutes(task, siblings)`. Export it from `packages/shared/src/index.ts`.
- [x] 3. Re-run the vitest lane to GREEN.
- [x] 4. `apps/creator-web/src/lib/wizardLogic.ts` — `blankTask()` seeds
  `defaultEstimatedMinutes(base, [])` instead of the flat 15; replace the stale comment with the
  walk-inclusive rationale and the corrected `runs/index.ts:3059` reference.
- [x] 5. `apps/creator-web/src/components/TaskWizard.tsx` — extend the existing duration block
  (do not duplicate it) with the derived estimate, a one-tap apply, and reuse the existing
  `b.estMin` numeric input as the override.
- [x] 6. `apps/creator-web/src/i18n.ts` — Hebrew and English copy for the new strings, no em-dash.

## REFACTOR / GATES

- [x] 7. Extend `functions/src/__property__/invariants.property.test.ts` with the
  finite-and-in-range invariant for `defaultEstimatedMinutes`.
- [x] 8. Extend `scripts/test-game-presentation.ts`: the fixture task carries `estimatedMinutes` and
  the guard asserts it survives the save payload via `stages`.
- [x] 9. Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
  `npm run play:build`, `npm run bundle:budget`, `npm run i18n:check:strict`.
- [x] 10. `npx openspec validate visible-time-estimates --strict`.
