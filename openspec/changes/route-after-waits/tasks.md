# Tasks: route-after-waits

## 1. RED
- [x] 1.1 `scripts/test-route-blockers.ts`: `queuedRouteVerdict` route / wait / drop. Failed (no export).
- [x] 1.2 `scripts/e2e-verify.mjs` "route after: a full station waits for its slot, never vanishes".

## 2. GREEN
- [x] 2.1 The verdict; `consumeQueuedRoute` waits (both paths); the station wait is stamped.
- [x] 2.2 `queuedRouteTaskId` on the console row; the two badges (HE/EN).

## 3. Verify
- [x] 3.1 `npm run verify` (all but origin:check, no .env in a worktree), `npm run e2e` (142/142).
- [x] 3.2 The 8 team load sim, five runs: every routed team did its station, 0 drops.
