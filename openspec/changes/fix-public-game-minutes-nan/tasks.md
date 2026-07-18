# Tasks: fix-public-game-minutes-nan

## 1. RED
- [x] Add `scripts/test-game-stats.ts` asserting `sumEstimatedMinutes` is always finite (one-undefined,
      all-undefined, NaN/Infinity/negative). Confirm it fails (helper does not exist).

## 2. GREEN
- [x] Add `packages/shared/src/gameStats.ts` with `sumEstimatedMinutes`; export from the shared index.
- [x] Replace both reduce sites in `functions/src/games/index.ts` with `sumEstimatedMinutes(allTasks)`.
- [x] `npm run shared:build`; confirm the test passes.

## 3. REFACTOR / verify
- [x] `npm run typecheck` green.
- [x] `npm test` green.
- [x] `npm run creator:build` green.
