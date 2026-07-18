# Design: fix-public-game-minutes-nan

## Files touched

- `packages/shared/src/gameStats.ts` (new) — `sumEstimatedMinutes(tasks)`:
  `tasks.reduce((sum, t) => sum + (Number.isFinite(t?.estimatedMinutes) && t.estimatedMinutes > 0 ? t.estimatedMinutes : 0), 0)`.
- `packages/shared/src/index.ts` — `export * from './gameStats'`.
- `functions/src/games/index.ts` — import `sumEstimatedMinutes`; replace both
  `allTasks.reduce((s, t) => s + t.estimatedMinutes, 0)` sites (public resync in `updateGame`, and
  `publishGame`) with `sumEstimatedMinutes(allTasks)`.

## Test strategy

- **Pure logic (`scripts/test-game-stats.ts`, tsx, no emulator, auto-run by `npm test`):** assert
  all-present sums correctly; a single `undefined` yields a finite total (not NaN); all-undefined → 0;
  `NaN` / `Infinity` / negative inputs are treated as 0; and no junk combination returns a non-finite
  value. RED before the helper exists, GREEN after.
- Rebuild shared (`npm run shared:build`) so functions can import the helper.

## Gates

`npm run typecheck` · `npm test` · `npm run creator:build`.
