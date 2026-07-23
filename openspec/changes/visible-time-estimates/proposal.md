## Why

The sibling change `task-duration-defaults` gave `Task.expectedDurationMinutes` an honest
per-interaction default, and correctly flagged that **this is not the number the product owner
sees**. There are two duration fields and the owner's ask lands on the other one.

| field | who reads it | today |
|---|---|---|
| `expectedDurationMinutes` | `scoreFixedPointsSpeed` only (`packages/shared/src/scoringPresets.ts:80`) | now derived per interaction |
| `estimatedMinutes` | everything else | a flat **15** for every new task |

`estimatedMinutes` is the visible and load-bearing one:

- the `smart_weighted` sigmoid — `taskScoreSmart(gameTask.difficulty, actualMinutes,
  gameTask.estimatedMinutes)` at `functions/src/runs/index.ts:918-921`, and the skip award at
  `packages/shared/src/scoringPresets.ts:229`
- the routing pace model — `computeSkillRatio`, `functions/src/routing/assignNextTask.ts:141-145`
- the public gallery total — `sumEstimatedMinutes`, `packages/shared/src/gameStats.ts:12`, written
  to `publicGames/{id}.estimatedTotalMinutes`
- the two places a creator actually reads a number — the per-task badge
  `apps/creator-web/src/components/TaskCard.tsx:168` and the Preview total
  `apps/creator-web/src/pages/BuilderPage.tsx:1932`

and `blankTask()` (`apps/creator-web/src/lib/wizardLogic.ts:53`) hands every task a flat 15.

**The trap the previous lane hit.** `RunTaskRecord.startedAt` is stamped at **assignment**
(`functions/src/runs/index.ts:3059`), and `completeTaskForTeam` measures the span from it
(`functions/src/runs/index.ts:853-857`). So the actual span compared against `estimatedMinutes` is
**walk + interaction**. Seeding it with an interaction-only number (a `field` check-in derives 1
minute) makes a team that walked six minutes score `sigmoid(6) ~ 0.2` at every single stop. So
`estimatedMinutes` needs a **transit allowance**, not just the interaction default.

## What Changes

**One pure function derives the visible estimate as interaction time plus a transit allowance.**

- New `defaultEstimatedMinutes(task, siblings)` in `packages/shared/src/taskEstimate.ts`. It reuses
  `defaultExpectedDurationMinutes(task)` for the interaction half (it does not restate those
  numbers) and adds `transitAllowanceMinutes(task, siblings)`.
- **Transit allowance** approximates the leg the player walks to reach this stop, using routing's
  own walking model (haversine at 5 km/h, i.e. `x 12` minutes per km, `assignNextTask.ts:46-58`).
  At authoring time there is no "previous stop", so the allowance is the **median leg** from this
  task to the other located tasks of its stage, clamped. A `locationless` task gets **zero**. A task
  with no usable coordinates, and a single-stop stage with no leg to measure, both get the same
  constant routing already uses when coordinates are unavailable. Derivation and defence in
  `design.md` section 2.
- **Clamped and total.** Every result is a finite whole number of minutes in `[1, 60]` for every
  input, including `null`, `NaN` coordinates, absurd coordinates and a non-array sibling list.
- **An authored value always wins.** `effectiveEstimatedMinutes(task, siblings)` only fills the gap.
- **No scoring path changes.** `taskScoreSmart`, `scoreSmartWeighted`, `computeSkillRatio`,
  `buildRankings` and `skipAward` keep reading the authored `estimatedMinutes` exactly as today. The
  default is applied at **authoring time** only, by `blankTask()` on a task that has never existed
  and by an explicit creator tap. No migration, no backfill, no write-on-read. In-flight and
  finalised runs are addressed in `design.md` section 3.
- **`blankTask()` seeds the derived value instead of 15.** With the transit allowance folded in
  this is now walk-inclusive and therefore comparable to the span the server measures.
- **Builder**: the task editor shows the derived estimate for the task as currently authored, with
  a one-tap apply and the existing numeric override, alongside (not duplicating) the interaction
  duration block the sibling lane added.

## Impact

- Affected specs: `visible-time-estimates` (new)
- Affected code: `packages/shared/src/taskEstimate.ts` (new),
  `packages/shared/src/taskEstimate.test.ts` (new), `packages/shared/src/index.ts`,
  `apps/creator-web/src/lib/wizardLogic.ts`, `apps/creator-web/src/components/TaskWizard.tsx`,
  `apps/creator-web/src/i18n.ts`, `scripts/test-game-presentation.ts`,
  `functions/src/__property__/invariants.property.test.ts`
- **Not** affected (deliberately): `scoringPresets.ts`, `functions/src/runs/index.ts`,
  `functions/src/routing/assignNextTask.ts`, `buildRankings`, `gameStats.ts`,
  `packages/shared/src/taskDuration.ts`
- `BUILDER_EDITABLE_FIELDS` needs no new entry: `estimatedMinutes` is a TASK-level field and rides
  the already-registered `stages` passthrough. The payload-completeness guard in
  `scripts/test-game-presentation.ts` is extended to prove it.
