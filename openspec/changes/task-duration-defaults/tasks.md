# Tasks — task-duration-defaults

## RED

- [x] 1. Write `scripts/test-task-duration-defaults.ts` against the not-yet-existing
      `defaultExpectedDurationMinutes` / `effectiveExpectedDurationMinutes`: every task type, the
      §3 number table value by value, survey at 1/5/40 choices (2 min ceiling), sequence at 1/12
      steps, unknown + missing + non-string type, no content arrays, explicit override wins,
      malformed explicit (`NaN`/`Infinity`/`0`/negative) falls back, absurd explicit clamps to 30,
      photo audio capture, both smart-station verification types, and the
      `scoreFixedPointsSpeed` invariance pin. Register it in the unit-test aggregator if the
      aggregator does not glob. Record the RED output verbatim.
- [x] 2. Add a seeded-random property to `functions/src/__property__/invariants.property.test.ts`:
      `defaultExpectedDurationMinutes` is finite, `> 0`, `<= 30` for arbitrary garbage. RED.
- [x] 3. Extend the TASK-level payload guard in `scripts/test-game-presentation.ts` to cover
      `expectedDurationMinutes`. RED.

## GREEN

- [x] 4. Create `packages/shared/src/taskDuration.ts` implementing the §3 table:
      `TASK_DURATION_MIN_MINUTES = 0.5`, `TASK_DURATION_MAX_MINUTES = 30`,
      `SURVEY_MAX_DURATION_MINUTES = 2`, `TASK_DURATION_FALLBACK_MINUTES = 2`,
      `defaultExpectedDurationMinutes(task)`, `effectiveExpectedDurationMinutes(task)`. Pure, no
      Firebase imports. Export from `packages/shared/src/index.ts`.
- [x] 5. Range-check `expectedDurationMinutes` in `gameStructureProblems`
      (`packages/shared/src/validation.ts`) and in the game-file task validator
      (`packages/shared/src/gameFile.ts`).
- [x] 6. Leave `blankTask()`'s `estimatedMinutes` at 15 and document why in place
      (`apps/creator-web/src/lib/wizardLogic.ts`): `actualMinutes` is measured from a `startedAt`
      stamped at ASSIGNMENT, so it includes the walk, and an interaction-only estimate would tank
      every smart_weighted score. See design.md §2.
- [x] 7. Builder UI in `apps/creator-web/src/components/TaskWizard.tsx`: derived-duration hint +
      "use it" affordance + explicit override input. `dir="auto"`, static Tailwind, logical RTL
      classes, no em-dashes.
- [x] 8. HE + EN copy in `apps/creator-web/src/i18n.ts` (additive; the file is contended).
- [x] 9. Run the whole pure lane green.

## REFACTOR / VERIFY

- [x] 10. `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`, `npm run i18n:check:strict`.
- [x] 11. `npx openspec validate task-duration-defaults --strict`.
- [x] 12. Report the e2e assertions another lane should add to `scripts/e2e-verify.mjs` (not edited
      here): `expectedDurationMinutes` stays in `ALLOWED_TASK_KEYS`, and `updateGame` refuses a
      negative / non-finite value.
