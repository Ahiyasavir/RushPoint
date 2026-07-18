# Proposal: fix-public-game-minutes-nan

## Why

Both public-gallery write paths in `functions/src/games/index.ts` compute the denormalized
`estimatedTotalMinutes` with a bare `allTasks.reduce((s, t) => s + t.estimatedMinutes, 0)` — the
resync on `updateGame` (public game edits) and `publishGame`. If any task omits `estimatedMinutes`,
the sum becomes `NaN`, and that `NaN` is written to `publicGames/{id}`, breaking gallery
sort/filter/display for that game.

## What Changes

- A pure shared helper `sumEstimatedMinutes(tasks)` sums `estimatedMinutes` treating a missing or
  non-finite value (undefined / NaN / Infinity) as 0 and clamping negatives to 0, so the total is
  always a finite, non-negative number.
- Both reduce sites in `functions/src/games/index.ts` use the helper.

## Non-goals

- No change to task validation or to the `Task.estimatedMinutes` type (still `number`).
- No backfill of existing `publicGames` docs; only future writes are guaranteed clean.
- No change to how `estimatedTotalMinutes` is displayed.

## Capabilities

### New Capabilities
- `public-game-stats-integrity`: the denormalized `estimatedTotalMinutes` written to the public
  gallery is always a finite number, regardless of missing per-task estimates.

## Impact

- **Surfaces touched:** shared (`packages/shared/src/gameStats.ts`, exported from the shared index),
  functions (`games/index.ts` two sites). No client change.
- **Callables affected (behavior, not signature):** `updateGame` (public resync) and `publishGame`.
- **Tests:** pure-logic assertion (`scripts/test-game-stats.ts`, auto-run by `npm test`) covering
  all-present, one-undefined, all-undefined, NaN/Infinity/negative inputs → always finite.
