## Why

`Task.expectedDurationMinutes` exists on the type and is read by exactly one consumer
(`scoreFixedPointsSpeed`, `packages/shared/src/scoringPresets.ts:80`), but **nothing in the
product ever sets it**. Its sibling `estimatedMinutes` is required, so every authoring surface has
to supply one, and every one of them supplies a number that has nothing to do with what the player
is actually asked to do:

- `blankTask()` (`apps/creator-web/src/lib/wizardLogic.ts:46`) hands **15 minutes** to every new
  task, whether it is a one-tap check-in or a twelve-step puzzle.
- the quick-start templates (`apps/creator-web/src/lib/taskTemplates.ts`) each hard-code a number
  chosen by hand, so two `photo` tasks from two templates disagree (2 vs 5 vs 10).
- the spreadsheet importer (`packages/shared/src/importSheet.ts:112`) falls back to a flat **5**.

So a 20-second photo snap and a 10-minute riddle are estimated identically, and the creator has no
signal about what a realistic number would be. The estimate is not cosmetic: it feeds the
`fixed_points_speed` route target, the `smart_weighted` sigmoid, and the routing pace model.

The product owner's ask: *"change the task default time to match every interaction — a survey will
not take more than 2 min, as well as usually pictures. Match an accurate estimated default time for
every interaction."*

## What Changes

**One pure function derives a realistic default duration from the task's own interaction.**

- New `defaultExpectedDurationMinutes(task)` in `packages/shared/src/taskDuration.ts`, a
  **function, not a constant map**: `survey`, `sequence` and `quiz` scale with their own authored
  content (choices, steps, ordering items), the rest are flat per type. Every result is clamped to
  `[0.5, 30]` minutes, and `survey` carries its own hard ceiling of **2 minutes** (the owner's
  stated number). An unknown/absent/garbage `type` falls back to a safe constant — never `NaN`,
  never `0`, never negative.
- **The number covers the interaction AT the stop only.** Walking time is a wholly separate routing
  term (`transitMinutes()`, `functions/src/routing/assignNextTask.ts:46`, haversine at 5 km/h) and
  is deliberately not folded in — see `design.md`.
- **An explicit `expectedDurationMinutes` always wins.** The default only fills the gap, via
  `effectiveExpectedDurationMinutes(task)`, which also sanitises a stored `NaN` / negative / zero /
  absurd value back onto the default rather than trusting it.
- **No scoring path changes.** `scoreFixedPointsSpeed`, `taskScoreSmart` and `computeSkillRatio`
  keep the exact fallback chain they have today, so no live run and no finalised run moves by a
  single point. The default is applied at **authoring time** only. See the in-flight decision in
  `design.md`.
- **Builder**: the task editor shows the derived default for the chosen type ("about 2 minutes")
  next to the estimate field, offers it with one tap, and offers an explicit override. The
  suggestion is never auto-applied, so a creator who typed their own number keeps it.
- **`blankTask()`'s flat 15 stays.** Found during implementation and load-bearing: the server
  stamps `RunTaskRecord.startedAt` at **assignment**, so the `actualMinutes` that
  `estimatedMinutes` is scored against includes the **walk** to the stop. Seeding it with an
  interaction-only number would make every team look five times slow under `smart_weighted`. See
  `design.md` §2.
- **Server**: `updateGame` / `publishGame` (via `gameStructureProblems`) and `importGameFile`
  reject a non-finite or negative `expectedDurationMinutes` instead of storing it.

## Impact

- Affected specs: `task-duration-defaults` (new)
- Affected code: `packages/shared/src/taskDuration.ts` (new), `packages/shared/src/index.ts`,
  `packages/shared/src/validation.ts`, `packages/shared/src/gameFile.ts`,
  `apps/creator-web/src/lib/wizardLogic.ts` (comment only), `apps/creator-web/src/components/TaskWizard.tsx`,
  `apps/creator-web/src/i18n.ts`, `scripts/test-task-duration-defaults.ts` (new),
  `scripts/test-game-presentation.ts`
- **Not** affected (deliberately): `scoringPresets.ts`, `functions/src/runs/index.ts`,
  `functions/src/routing/assignNextTask.ts`, `buildRankings`.
