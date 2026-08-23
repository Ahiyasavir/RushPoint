## 1. RED: pin the accumulation and subtraction rule as pure logic

- [x] 1.1 Write `packages/shared/src/pausedClock.test.ts` (vitest) against the not-yet-existing
  `packages/shared/src/pausedClock.ts`: `taskExcludedMs` for a non-pausing task, an ordinary span,
  a never-completed record, a never-started record, a skipped/expired record, a re-routed record, a
  duplicate completion, `completedAt < startedAt` (clock skew), unparsable/`NaN`/non-string stamps;
  `teamExcludedMs` for zero tasks, for negative / `NaN` / `Infinity` stored values, and for a sum
  across stages; `adjustedElapsedMs` / `adjustedElapsedSeconds` for the ordinary case, for
  `excluded ≥ raw` (floor at zero, never negative), for a raw `Infinity` (unfinished team keeps
  "no duration"), and for `NaN` inputs. Run vitest; confirm RED because the module does not exist.

## 2. GREEN: the shared pure module

- [x] 2.1 Add `Task.pausesTimer?: boolean` and `RunTaskRecord.excludedMs?: number` to
  `packages/shared/src/types/index.ts`, each with a comment naming this change and stating that
  absent means off / zero.
- [x] 2.2 Write `packages/shared/src/pausedClock.ts` (`taskExcludedMs`, `teamExcludedMs`,
  `adjustedElapsedMs`, `adjustedElapsedSeconds`) guarding every input for finiteness the way
  `taskScoreSmart` does, and export it from `packages/shared/src/index.ts`. Re-run 1.1; confirm
  green.

## 3. GREEN: the presets honour the excluded duration

- [x] 3.1 Add an optional trailing `excludedMs = 0` parameter to `scoreFixedPointsSpeed` in
  `packages/shared/src/scoringPresets.ts`, subtracting it from the actual span before the speed
  bonus, floored at zero and non-finite-safe. Existing call sites and tests keep passing unchanged.
- [x] 3.2 In `buildRankings` (`functions/src/runs/index.ts`) compute `excludedMs =
  teamExcludedMs(team.stages)` once per team and feed it to (a) `scoreFixedPointsSpeed`, (b) the
  emitted `durationSeconds` / `totalMinutes`, (c) `durationMin`, which is what the Z-Score and the
  `time_only` ordering read. No second subtraction anywhere.
- [x] 3.3 In `completeTaskForTeam` stamp `taskRec.excludedMs` from the SERVER span when the game
  task carries `pausesTimer`, leaving `actualMinutes` at its real measured value, and feed
  `gameTask.estimatedMinutes` (not `actualMinutes`) to `taskScoreSmart` for a paused task.

## 4. RED→GREEN: seeded property invariants

- [x] 4.1 Extend `functions/src/__property__/invariants.property.test.ts` with a
  `pausedClock — excluded-time invariants` block in the existing house style (local seeded LCG):
  `adjustedElapsedMs` never negative, never above the raw value, monotonic non-increasing in the
  excluded amount, finite for finite inputs; `scoreFixedPointsSpeed` with an excluded amount is
  `≥` the same call without one and stays inside `SPEED_BONUS_CAP`. Add to the existing
  `buildRankings` block: a run in which EVERY completed task carries `excludedMs` still yields
  contiguous ranks `1..n`, finite scores and non-negative durations.

## 5. GREEN: routing pace is protected

- [x] 5.1 Re-read `functions/src/routing/assignNextTask.ts` immediately before editing (another
  lane owns it). Additively: add `excludedMs?: number` to `SlotSummary` and drop any record whose
  `excludedMs` is present from `computeSkillRatio`'s measurable sample, with a comment naming this
  change. Pass `excludedMs: t.excludedMs` at the two `computeSkillRatio` call sites in
  `functions/src/runs/index.ts`.
- [x] 5.2 Extend `functions/src/routing/assignNextTask.test.ts`: a paused record is dropped, an
  all-paused sample returns the neutral `0`, and an `excludedMs: 0` record is still dropped.

## 6. GREEN: server-side validation and the game file

- [x] 6.1 Add `pausesTimer` to `EXPORTED_TASK_KEYS` and to `TASK_FIELD_TYPES` as `'boolean'` in
  `packages/shared/src/gameFile.ts`.
- [x] 6.2 Extend `scripts/test-game-file.ts`: populate `pausesTimer` on the `fullTask` classifier
  fixture (so the export/exclude completeness check really exercises it) and add a refusal case for
  a non-boolean value.

## 7. GREEN: Builder (creator-web)

- [x] 7.1 Widen `sectionApplies('rules', …)` in `apps/creator-web/src/lib/wizardSections.ts` to
  every task type (the pause-clock rule applies to all of them), include `pausesTimer` in
  `sectionSummary('rules')` and in `defaultOpenSections`, and update
  `scripts/test-wizard-sections.ts` accordingly.
- [x] 7.2 Add the toggle to the `rules` section of `apps/creator-web/src/components/TaskWizard.tsx`,
  writing `pausesTimer: true` / `undefined` (never `false`, so a game that never touched it stays
  byte-identical), with the located-task warning line beneath it.
- [x] 7.3 Add `pauseClock`, `pauseClockDesc` and `pauseClockLocatedWarn` to BOTH dictionaries in
  `apps/creator-web/src/i18n.ts` (re-read the file immediately before editing; another lane owns
  it). Natural Hebrew, no em-dashes.
- [x] 7.4 Extend `scripts/test-game-presentation.ts` with a task-level payload guard: a `Task` field
  authored in the Builder survives `buildSavePayload` through `stages` and changing it changes the
  serialized payload (marks the game dirty).

## 8. GREEN: participant notice (play-web)

- [x] 8.1 Render a paused-clock notice on the task card in
  `apps/play-web/src/components/TaskRunner.tsx`, reusing the `answerCost` notice idiom
  (`role="status"`, `dir="auto"`, static Tailwind, logical spacing classes).
- [x] 8.2 Add `clockPaused` to BOTH dictionaries in `apps/play-web/src/i18n.ts` (re-read
  immediately before editing; another lane owns it).

## 9. REPORT (not edited here): the e2e assertions this change owes

`scripts/e2e-verify.mjs` is owned elsewhere in this session, so the following are **reported, not
written**:

- [~] 9.1 `ALLOWED_TASK_KEYS` gains `'pausesTimer'` — without it the sanitizer allowlist scenario
  fails loud the first time a paused task reaches a participant.
- [~] 9.2 Lifecycle scenario: a `time_only` run where team A completes a paused task and team B does
  not; assert A's `durationSeconds` on the final board equals its raw span minus the paused span
  (±1 s) and that A outranks B despite a longer wall-clock run.
- [~] 9.3 Leaderboard invariant oracle: extend it to assert `durationSeconds >= 0` and finite for
  every entry, and that `durationSeconds <= wallClock(startedAt→finishedAt)` for every finished
  team — the oracle's statement of "excluded time can only ever subtract".
- [~] 9.4 Live/final parity: refresh the leaderboard mid-run after a paused task completes, finalise
  with no further activity, and assert entry-for-entry equality of `score`, `durationSeconds` and
  `rank`.
- [~] 9.5 Idempotence: submit the same paused task twice and assert `excludedMs` and the team's
  final duration are unchanged by the second submission.
- [~] 9.6 Mid-run template edit: complete a paused task, `updateGame` to clear `pausesTimer`,
  refresh, and assert the completed task's contribution is unchanged.
- [~] 9.7 All-paused run: every task carries `pausesTimer`; assert the final board has contiguous
  ranks, finite scores and a `durationSeconds` of `0` rather than a negative number or a crash.
- [~] 9.8 Station contention is untouched: a paused task still releases its slot on completion
  (the counter returns to 0 in the simulate audit).

## 10. REFACTOR + gates

- [x] 10.1 Re-read every file owned by another lane and confirm this change is purely additive.
- [x] 10.2 Run, verbatim: `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
  `npm run play:build`, `npm run bundle:budget`, `npm run i18n:check:strict`.
- [x] 10.3 `npx openspec validate pause-clock-tasks --strict`.
