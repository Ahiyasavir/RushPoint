# Tasks — fix-fixed-points-speed-template-drift

## 1. RED — failing tests that pin the drift and the guarantees

- [x] 1.1 Add a pure test (`functions/src/runs/buildRankings.test.ts` or a co-located
  `scoringPresets.test.ts` / `scripts/test-*.ts`) with the **mutate-template-mid-run** case: a
  `fixed_points_speed` game + a finished Team A whose records carry
  `expectedDurationMinutesAtCompletion` stamps; score once, then LOWER a task's
  `expectedDurationMinutes` and score the SAME stored team doc again; assert the score is UNCHANGED.
  (RED today: the current template reduce makes it drop.)
- [x] 1.2 Add the **no-regression-on-unedited-runs** case: for an unedited template, assert the new
  summed expected total equals the old `game.stages.reduce(...)` value and the final score matches a
  golden pre-change number.
- [x] 1.3 Add the **legacy fallback** case: a finished team whose records LACK the stamp scores via
  the template fallback (equal to the pre-change score for that unedited template) and does not throw.
- [x] 1.4 Add the **order-flip** case: two close finished teams near the 200-pt cap keep their order
  under a mid-run edit that would have flipped them before.
- [x] 1.5 Add the **stamp-written-once** case: the stamp equals the resolved template value at
  completion and a duplicate completion does not overwrite it.

## 2. GREEN — stamp the value and sum the stamps

- [x] 2.1 Add `RunTaskRecord.expectedDurationMinutesAtCompletion?: number` (+ doc comment) beside
  `excludedMs` in `packages/shared/src/types/index.ts`.
- [x] 2.2 Add the pure `resolveExpectedMinutes(task)` and `teamExpectedRouteMinutes(stages, game)`
  helpers to `packages/shared/src/scoringPresets.ts`; `teamExpectedRouteMinutes` sums each
  completed/skipped record's stamp and falls back to the resolved template value (matched by
  `taskId`) when the stamp is absent — never `NaN`, never a throw.
- [x] 2.3 Change `scoreFixedPointsSpeed` to compute `expectedTotal = teamExpectedRouteMinutes(stages,
  game)` in place of the `game.stages.reduce(...)` at lines 76-82; leave every other line (taskPoints
  loop, `excludedMs`/`adjustedElapsedMs`, the `!startedAt || !finishedAt` early return) unchanged.
- [x] 2.4 In `completeTaskForTeam` (`functions/src/runs/index.ts`), stamp
  `taskRec.expectedDurationMinutesAtCompletion = resolveExpectedMinutes(gameTask)` inside the same
  whole-object stage rewrite that stamps `excludedMs` (`~940-957`).
- [x] 2.5 Apply the same stamp on every terminal SKIP transition (skipStage, partial-completion
  auto-skip, exclusive-group auto-skip, task-expiry) from the corresponding template task, so a
  finished team's every terminal record carries the stamp and the guarantee is total.

## 3. REFACTOR / verify

- [x] 3.1 Confirm `buildRankings`' call site (`functions/src/runs/index.ts:1464-1470`) is unchanged in
  shape (it already passes `game`); update the header comment to note the expected-total is now summed
  from stamps too.
- [x] 3.2 Confirm no sanitizer-allowlist change is needed (the field is on `RunTaskRecord`, not the
  participant `Task`) and that the `requestNextTask`/`getRecommendedTasks` skill-ratio projections
  need no change.
- [ ] 3.3 Run the gates: `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` ·
  `npm run play:build` · `npm run bundle:budget` · `npm run i18n:check:strict` — green. (No UI change,
  but shared types recompile.) `npm run e2e` under the emulator to confirm no lifecycle regression.
  (NOT run in this authoring lane.)
