# Tasks: fix-leaderboard-flag-race

## 1. RED — pin the invariant
- [x] Add a `leaderboardRefreshFields` describe block to
      `functions/src/runs/leaderboardThrottle.test.ts` asserting the payload writes only
      `leaderboard.rankings` + `leaderboard.updatedAt` + `updatedAt` and never the organizer flags.
      Confirm it fails (helper does not exist yet).

## 2. GREEN — minimum implementation
- [x] Add the pure `leaderboardRefreshFields<T>(rankings, nowIso)` helper to
      `functions/src/runs/leaderboardThrottle.ts`.
- [x] In `maybeRefreshLeaderboardSnapshot`, commit via `db.runTransaction` that re-reads the run,
      returns early when now-frozen, and `tx.update(runRef, leaderboardRefreshFields(rankings, now))`.
- [x] Confirm the vitest block passes.

## 3. REFACTOR / verify
- [x] `npm run typecheck` green.
- [x] `npm test` green (throttle + field-path tests).
- [ ] `npm run e2e` — leaderboard invariant + live/final parity scenarios stay green.
