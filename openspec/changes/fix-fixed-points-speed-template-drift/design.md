# Design — fix-fixed-points-speed-template-drift

## The decision: stamp the expected duration, sum the stamps

This is the exact pattern already proven for the other input to the same `speedBonus()` call. The
pause-clock term is summed from the server-stamped `RunTaskRecord.excludedMs`
(`packages/shared/src/pausedClock.ts`, `teamExcludedMs`), and `buildRankings`' header
(`functions/src/runs/index.ts:1441-1450`) spells out why: summing the stamps rather than re-reading
the template makes a finished task's contribution immutable, so a mid-run template edit cannot
retroactively re-time finished work. We apply the same shape to the route's expected-total minutes.

The alternative — re-reading `game.stages[].tasks[].expectedDurationMinutes` on every recompute
(today's code) — is exactly what drifts. Rejected for the reason the header already documents.

A single team-level snapshot at finish (`team.expectedRouteMinutesAtFinish = reduce(template)`) was
also considered and rejected: the per-task stamp mirrors the established `excludedMs` idiom, degrades
per-record (a legacy record falls back independently), and is the shape the rest of the file already
reasons about.

## The stamp field

Add to `RunTaskRecord` (`packages/shared/src/types/index.ts:792`, beside `excludedMs`):

```ts
// fix-fixed-points-speed-template-drift: the per-task EXPECTED route-time
// contribution (minutes), snapshotted from the game template at the moment this
// record reached a terminal state — the same value scoreFixedPointsSpeed's route
// reduce reads today (expectedDurationMinutes ?? estimatedMinutes), with the same
// finite-and->0 guard. buildRankings SUMS this stamp across the team's terminal
// records instead of reducing over the live template, so a creator editing a
// task's expected duration mid-run cannot retroactively re-score a team that has
// already finished (which would jump the live board and break live/final parity).
// Absent on every pre-change record and on any run started before this shipped —
// read via a template fallback, never as 0.
expectedDurationMinutesAtCompletion?: number;
```

Name note: the value is snapshotted at the record's terminal transition. "AtCompletion" reads
naturally for the completion path (its primary site); a skipped record is stamped at its skip
transition with the same value. The name is kept for symmetry with the excludedMs completion-stamp.

## The resolved value (must equal today's template reduce, per task)

`scoreFixedPointsSpeed` currently resolves each task's expected contribution as
(`scoringPresets.ts:80-81`):

```ts
const m = t.expectedDurationMinutes ?? t.estimatedMinutes;
return s + (Number.isFinite(m) && m > 0 ? m : 0);
```

The stamp is exactly this resolved, guarded value for the task being finalized. Reusing the identical
resolution guarantees the no-edit case is byte-for-byte unchanged: at completion the stamp equals
what the reduce would have read, so the summed stamp total equals today's reduce total.

## The completion-path change (primary stamp site)

In `completeTaskForTeam` (`functions/src/runs/index.ts`), inside the same whole-object stage rewrite
that already sets `taskRec.status = 'completed'`, `taskRec.completedAt`, and — for paused tasks —
`taskRec.excludedMs` (`~940-957`), stamp the resolved expected duration from the resolved `gameTask`
(already in scope at that point, used for `earnedScore` at `~907-928`):

```ts
taskRec.expectedDurationMinutesAtCompletion = resolveExpectedMinutes(gameTask);
```

where `resolveExpectedMinutes` is the shared pure helper below. Stamped unconditionally at completion
(not gated on preset): the value is cheap, always meaningful, and a game's preset is fixed, so
stamping regardless keeps the record self-describing. The already-terminal no-op guard higher in
`completeTaskForTeam` makes a duplicate submission a no-op, so the first stamp is final — as with
`excludedMs`.

**Skip transitions.** A finished team's route expected-total is summed over its completed **and
skipped** records. To make the immutability guarantee total (and so this change genuinely closes the
LAST drift vector — see below), the same stamp is written wherever a record transitions to `skipped`:
`skipStage`, the partial-completion auto-skip, the exclusive-group auto-skip, and task-expiry. Each
of those already rewrites the record's status; they additionally set
`expectedDurationMinutesAtCompletion = resolveExpectedMinutes(gameTask)` from the corresponding
template task. (Records that never reach a terminal state cannot be summed — a finished team has no
such records, because finishing requires every stage complete and every in-stage remainder
auto-skipped — so only terminal records need the stamp.)

## The scoring change (sum stamps, with a legacy fallback)

Introduce a pure helper in `scoringPresets.ts` and have `scoreFixedPointsSpeed` use it in place of
the `game.stages.reduce(...)` at lines 76-82:

```ts
/** One task's resolved expected route-minutes, guarded exactly as the old reduce. */
export function resolveExpectedMinutes(
  t: Pick<Task, 'expectedDurationMinutes' | 'estimatedMinutes'>,
): number {
  const m = t.expectedDurationMinutes ?? t.estimatedMinutes;
  return Number.isFinite(m) && (m as number) > 0 ? (m as number) : 0;
}

/**
 * Route expected-total minutes for a team, summed from the STAMP the server wrote
 * on each terminal (completed/skipped) record — never re-derived from the live
 * template. A record missing the stamp (pre-change / legacy) falls back to that
 * task's resolved template value, so old runs keep scoring and nothing throws.
 */
export function teamExpectedRouteMinutes(
  stages: RunStageRecord[],
  game: Pick<Game, 'stages'>,
): number { … }
```

`scoreFixedPointsSpeed` then computes `expectedTotal = teamExpectedRouteMinutes(stages, game)` instead
of reducing over `game.stages`. Everything else in the function (the `taskPoints` loop, the
`excludedMs`/`adjustedElapsedMs` handling, the `!startedAt || !finishedAt` early return) is unchanged.

### Legacy fallback — precise semantics

For each of the team's completed/skipped records:
- if `expectedDurationMinutesAtCompletion` is a finite number, add it (immutable — this is the fix);
- else look up the matching template task (by `taskId`, resolving through `game.stages[].tasks`) and
  add `resolveExpectedMinutes(templateTask)` — the pre-change behavior for that one task;
- a record whose template task can no longer be found (deleted mid-run) contributes the stamp if it
  has one, else 0 — never `NaN`, never a throw.

Because the fallback resolves to the same value the old reduce read, a legacy in-flight run scores
exactly as it does today until its records start carrying stamps.

### Summation set — why "completed/skipped" matches today's total

Today's reduce runs over EVERY template task. The new sum runs over the team's completed/skipped
records. These agree for the case that matters: `scoreFixedPointsSpeed` only computes an
`expectedTotal` when `startedAt && finishedAt` are both present (line 73 early-returns otherwise), and
`buildRankings` only passes a `finishedAt` when `team.status === 'finished'`
(`functions/src/runs/index.ts:1467`). A finished team has every stage completed and every in-stage
remainder auto-skipped, so every one of its records is terminal — the completed/skipped set equals the
full template task set, and (with stamp-or-fallback per task) the totals match. For an unfinished team
the expected total is never computed at all, so the summation set is irrelevant.

## Sanitizer / serialization note

`expectedDurationMinutesAtCompletion` lives on `RunTaskRecord` (part of the server-write-only team
document), not on the participant-facing `Task`. The participant task sanitizer's
`ALLOWED_TASK_KEYS` / `ALLOWED_SMART_KEYS` allowlist (enforced by the e2e sanitizer scenario) gates
`Task` fields, not `RunTaskRecord` fields, so this addition does not touch that allowlist. The field
is not secret to a team (like `excludedMs` and `surveyResponse` it may flow through `getMyTeamState`
unchanged), and it is a plain finite number, so no JSON-encode / leaderboard-serialization guard is
needed. Implementers touching the `RunTaskRecord` projections in `requestNextTask` /
`getRecommendedTasks` (`functions/src/runs/index.ts:3242,4092`) should be aware the shape grew a
field, but those projections carry only what `computeSkillRatio` reads and need no change.

## Test strategy (test-first)

Pure lane — no emulator. A co-located test (`functions/src/runs/buildRankings.test.ts`, or a
`scoringPresets.test.ts` / `scripts/test-*.ts` run by the aggregator). The headline assertion is a
**mutate-template-mid-run** test:

1. **No drift.** Build a `fixed_points_speed` game + a finished Team A whose records carry
   `expectedDurationMinutesAtCompletion` stamps. Run `buildRankings` (or `scoreFixedPointsSpeed`) →
   record score S1. **Mutate** `game.stages[].tasks[].expectedDurationMinutes` (lower it). Run again
   on the SAME stored team doc → assert the score is **unchanged** (`=== S1`). This is the bug fixed.
2. **No regression on unedited runs.** For a game whose template is not edited, assert the new summed
   total equals the old `game.stages.reduce(...)` result and the final score is identical to the
   pre-change value (a golden number).
3. **Legacy fallback.** A finished team whose records LACK the stamp scores via the template fallback
   — equal to the pre-change score for that same (unedited) template; and it does not throw.
4. **Order flip.** Two close finished teams near the 200-pt cap: a mid-run edit that would have
   flipped their order under the old code leaves the order unchanged under the new code.
5. **Stamp written once.** The stamp equals the resolved template value at completion time and a
   duplicate completion does not overwrite it (the already-terminal guard).

E2E / coverage implications: `completeTaskForTeam` is internal (not a callable, not a trigger), so the
callable-coverage guard needs no new entry. No sanitizer-allowlist change (see the note above). An
additive `scripts/e2e-verify.mjs` assertion could exercise a real finish → template-edit →
`refreshLeaderboard` → unchanged-board flow, but the pure test above is the primary gate.

## This closes the last template-drift vector in the preset family

Per the bug-hunt: the `fixed_points_speed` speed bonus has exactly two inputs to `speedBonus()` —
`expectedTotal` and `actualTotal`. `actualTotal` was already made template-independent (the
`excludedMs` stamp sum + the `finishedAt ?? now` phantom-decay fix). `expectedTotal` is the only
remaining input still read from the live template. Stamping it closes that vector, so no term of the
`fixed_points_speed` score is re-derived from the template on recompute. `time_only` reads no
template durations, and `smart_weighted` already scores each task from its stored `earnedScore`
(stamped at completion) — neither has an analogous live-template read. With this change, no scoring
preset re-derives a finished team's score from the current template.
