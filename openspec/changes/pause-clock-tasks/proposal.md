## Why

Every RushPoint scoring preset is a clock. `time_only` ranks purely on elapsed time,
`fixed_points_speed` pays a speed bonus for beating the expected route duration, and
`smart_weighted` multiplies each task by `sigmoid(actualMinutes / estimatedMinutes)`. On top of all
three, `finalizeRun` applies a Z-Score bonus derived from the team's total duration. Nothing in the
product can opt a single task out of that clock.

That is fine for a check-in and wrong for a **survey**. A survey task exists to collect a considered
answer — "what did this stop make you think about?", "rate the neighbourhood you just walked
through" — and the running clock tells the team the exact opposite: type anything, tap submit, keep
moving. The mechanic the creator wants ("stop and actually think here") is defeated by the mechanic
the platform enforces ("every second costs you"). A creator today can only choose between asking a
reflective question and running a timed game.

## What Changes

**A task can be authored to STOP the team's race clock while they are on it.**

- A new optional task field, `Task.pausesTimer`. Absent/`false` on every existing task and every
  in-flight run, so nothing that exists today changes by a single point or second.
- **Offered for every task type**, defaulting OFF, rather than as a survey-only special case — see
  the scope argument in `design.md`. The Builder warns when the toggle is used on a *located* task,
  because there the excluded span also swallows the walk to the spot.
- The excluded duration is computed **entirely from server timestamps** already stamped on the
  team's own `RunTaskRecord` (`startedAt` → `completedAt`). No client ever reports a duration, so a
  paused-clock task is not a lever for faking a fast finish.
- The server stamps the result once, at completion, as `RunTaskRecord.excludedMs`. Every downstream
  consumer reads that stored number instead of re-deriving it, which is what makes the live board
  and the final board agree by construction and makes a mid-run edit of the game template unable to
  retro-change a completed task.
- **All three presets honour it.** The adjusted elapsed time (`raw − excluded`, floored at zero)
  drives `time_only` ranking, the `fixed_points_speed` speed bonus, and the `finalizeRun` Z-Score.
  Under `smart_weighted` a paused task is scored **on-estimate** (`x = 1`), so its sigmoid
  multiplier is time-independent: no reward for rushing, no penalty for thinking.
- **Routing is protected.** `computeSkillRatio` measures a team's pace to fit task difficulty. A
  paused task's duration is deliberation, not pace, so its record is excluded from the ratio
  entirely instead of making the team look artificially slow.
- **The participant is told.** A task whose clock is paused says so on the task card. A team that
  does not know the timer stopped will hurry anyway, which is the whole feature failing silently.

## Non-goals

- **No new callable.** `completeTask` / `submitTaskAnswer` stamp one extra number on a record they
  already rewrite.
- **No change to `buildRankings`' contract.** It keeps its `(game, teams, now)` signature and stays
  the single ranking implementation shared by `finalizeRun` and `refreshLeaderboard`.
- **No retroactive migration.** No document is rewritten. An absent `excludedMs` reads as `0`.
- **No pause for tasks a team never completes.** An abandoned, expired, skipped or auto-skipped
  paused task excludes nothing (see the design's exploit argument).
- **No "pause the whole run" operator control.** That is a different feature (live-task-pause owns
  run-level task availability); this change is per-task authorship on the game template.
- **No change to `RunTaskRecord.actualMinutes`.** It keeps recording the REAL measured span, so
  benchmarks, per-type analytics and the staff over-duration warning are unaffected.

## Capabilities

### New Capabilities
- `pause-clock-tasks`: A creator-authored, per-task flag that excludes the team's server-measured
  time on that task from every time-derived scoring term (task score, speed bonus, ranked duration,
  Z-Score) and from routing's pace measurement, computed only from server timestamps, stamped once
  at completion, and announced to the participant while they are on the task.

### Modified Capabilities
<!-- none: no existing requirement changes meaning. Every time-derived term keeps its formula; the
     elapsed value fed into it becomes the adjusted one, which for every pre-existing game is
     byte-for-byte the raw one (excluded === 0). -->

## Impact

- **Surfaces touched:** `packages/shared` (types, new pure module, one extra optional parameter on
  `scoreFixedPointsSpeed`, game-file key lists) · `functions/` (`runs/index.ts`,
  `routing/assignNextTask.ts`) · `apps/creator-web` (one Builder toggle + i18n + wizard section
  rules) · `apps/play-web` (one notice on the task card + i18n). **No Firestore rules change, no new
  index, no new env var, no new callable.**
- **Files:** `packages/shared/src/pausedClock.ts` (new), `packages/shared/src/pausedClock.test.ts`
  (new), `packages/shared/src/index.ts`, `packages/shared/src/types/index.ts`,
  `packages/shared/src/scoringPresets.ts`, `packages/shared/src/gameFile.ts`,
  `functions/src/runs/index.ts`, `functions/src/routing/assignNextTask.ts`,
  `functions/src/__property__/invariants.property.test.ts`,
  `apps/creator-web/src/components/TaskWizard.tsx`, `apps/creator-web/src/lib/wizardSections.ts`,
  `apps/creator-web/src/i18n.ts`, `apps/play-web/src/components/TaskRunner.tsx`,
  `apps/play-web/src/i18n.ts`, `scripts/test-game-file.ts`, `scripts/test-game-presentation.ts`,
  `scripts/test-wizard-sections.ts`, `scripts/e2e-verify.mjs`.
- **New persisted state:** `RunTaskRecord.excludedMs` — a number of milliseconds, written once by
  the server as part of the whole-object stage rewrite the record already receives (never through a
  dotted array path). Absent everywhere today and read as `0`.
- **Allowlist:** the participant sanitizer passes unknown `Task` keys through `...rest`, so
  `Task.pausesTimer` reaches the player. `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs` must gain
  `pausesTimer` or the allowlist scenario fails loud. It carries no part of an answer key — it says
  the clock is stopped, which the player must be told anyway.
- **Risk:** a game whose every task pauses the clock has a total adjusted elapsed time of zero.
  Nothing divides by elapsed time, but the Z-Score's standard deviation becomes zero — already
  guarded (`sigma === 0` returns the raw score) — and the speed bonus saturates at its existing cap
  for every team, i.e. it stops discriminating. That is the correct meaning of "this game is not
  timed" and is covered by an explicit test.
- **Testing:** the accumulation and subtraction rule is a pure module in `packages/shared` with a
  vitest suite (RED first), extended seeded property invariants in
  `functions/src/__property__/invariants.property.test.ts`, and boundary-script coverage for the
  game-file round trip and the Builder save payload. Callable behaviour is covered by named
  `scripts/e2e-verify.mjs` assertions listed in `design.md`. UI is verified via `npm run
  i18n:check:strict` plus the production builds.
