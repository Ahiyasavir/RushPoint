# Proposal — fix-fixed-points-speed-template-drift

## Why

The codebase has one load-bearing scoring invariant, stated in `buildRankings`' own header
(`functions/src/runs/index.ts:1441-1450`) and in CLAUDE.md: **anything affecting a finished team's
duration or score must be a pure function of the STORED team document — never re-derived from the
current game template and never from `now`** — because `buildRankings` is shared by `finalizeRun`
(terminal) and `refreshLeaderboard` (live, mid-run), so any value that reads the live template makes
the live board jump on a template edit and lets the live and final boards drift.

The `fixed_points_speed` preset violates this. Its speed bonus needs an "expected total minutes" for
the route, and `scoreFixedPointsSpeed` (`packages/shared/src/scoringPresets.ts:76-82`) builds that
total by reducing over the **live template** —
`game.stages[].tasks[].expectedDurationMinutes ?? estimatedMinutes` — on every recompute. So editing
any task's `expectedDurationMinutes` mid-run **retroactively re-scores teams that already finished**,
with no gameplay event.

The excludedMs speed-bonus term was already fixed this way for pause-clock tasks (that term is summed
from server-stamped `RunTaskRecord.excludedMs`, `packages/shared/src/pausedClock.ts`), and the
`team.finishedAt ?? now` phantom-decay bug was fixed for the same term. But the **expected-total
route minutes** — the other input to the very same `speedBonus()` call — is still read live. This is
the last remaining template-drift vector inside the `fixed_points_speed` speed bonus.

### The concrete drift scenario

1. A run uses `fixed_points_speed`. Team A completes every task and **finishes**.
2. Between Team A's finish and `finalizeRun`, the creator calls `updateGame` (or re-imports the game
   file) **lowering** a task's `expectedDurationMinutes`.
3. The next `refreshLeaderboard` recompute lowers the route's `expectedTotal`, so
   `speedBonus(expectedTotal, actualTotal)` shrinks — Team A's score drops **with no play event**.
4. The live board jumps and, because `SPEED_BONUS_PER_MINUTE = 10` and the bonus is clamped to
   `[0, 200]`, the drop is nonlinear near the cap and can **flip the order** of two close finished
   teams.

The drift window is **finish → finalize** only. Once `finalizeRun` freezes the board, later
recomputes do not re-run scoring, so a finalized board is already immune. This change closes the
window that is still open.

## What Changes

Mirror the `excludedMs` treatment. The server **stamps** the resolved per-task expected duration onto
each `RunTaskRecord` when the record reaches a terminal state (the same whole-object stage rewrite in
`completeTaskForTeam` that already stamps `excludedMs`), and `buildRankings`/`scoreFixedPointsSpeed`
**sum the stored stamps** for the team's completed/skipped records instead of reducing over
`game.stages`. A finished team's `expectedTotal` — and therefore its speed bonus — becomes immutable
against later template edits.

- **New stored field** `RunTaskRecord.expectedDurationMinutesAtCompletion` (see design.md for the
  exact name and shape), stamped once, server-side, from the same resolved value the template reduce
  reads today (`expectedDurationMinutes ?? estimatedMinutes`, with the same finite-and-`> 0` guard).
- **`scoreFixedPointsSpeed` sums the stamps** over the team's completed/skipped task records rather
  than reducing over the current template.
- **Legacy fallback:** a record that carries no stamp (every pre-change record; any in-flight run
  that started before this ships) falls back to that task's resolved template value, so old runs keep
  scoring and nothing throws.

## What does NOT change

- **No score change for any run whose template is not edited mid-run** (the common case): at
  completion the stamped value equals the template value, so the summed total is identical to today's
  template reduce and every such run scores byte-for-byte the same.
- **No other preset is affected.** `time_only` scores 0; `smart_weighted` already scores each task
  from the stored `earnedScore` (stamped at completion) and never reads the route-level expected
  total. Only `fixed_points_speed`'s route expected-total is re-sourced.
- **Frozen boards are already immune** — `finalizeRun` does not re-score a finalized run, so this
  change only affects the still-open finish→finalize window; the fix does not touch finalized data.
- **No new callable.** `completeTaskForTeam` is internal (not a callable and not a trigger), so the
  callable-coverage guard needs no new scenario for a new callable. The `RunTaskRecord` shape gains
  one server-written numeric field (see the sanitizer note in design.md).

## Related observation (NOT fixed here) — the `estimatedMinutes === 0` footgun

A separate, lower-severity item the same bug-hunt flagged, recorded here so it is not lost:
`gameStructureProblems` (`packages/shared/src/validation.ts:163-165`) only rejects a **negative**
`estimatedMinutes` (`!(task.estimatedMinutes >= 0)`), so `estimatedMinutes === 0` passes validation.
Under `smart_weighted`, `taskScoreSmart` returns **0** for any task with `estimatedMinutes <= 0`
(`scoringPresets.ts:116`), so a zero-estimate task silently scores nothing. This looks like a
by-design guard (a 0-minute estimate is degenerate and the score guard is deliberately total), and it
is a **different preset and a different mechanism** from the drift fixed here. It is out of scope for
this change and is captured only as a related-but-separate observation.

## Impact

- Affected specs: `leaderboard-parity` (new capability delta authored by this change)
- Affected code:
  - `packages/shared/src/types/index.ts` — new `RunTaskRecord.expectedDurationMinutesAtCompletion`
    field + doc comment.
  - `packages/shared/src/scoringPresets.ts` — `scoreFixedPointsSpeed` sums stored stamps with a
    template fallback (new pure helper for the per-team expected total).
  - `functions/src/runs/index.ts` — `completeTaskForTeam` stamps the field alongside `excludedMs`;
    the same stamp on the skip/auto-skip transitions; `buildRankings` call site unchanged in shape.
  - Tests: a pure unit test (`functions/src/runs/buildRankings.test.ts` or a
    co-located `scoringPresets.test.ts` / `scripts/test-*.ts`) — see design.md.
- Surfaces touched: shared types + shared scoring + functions. No client change, no rules change.
