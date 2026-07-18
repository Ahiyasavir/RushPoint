# Design: fix-leaderboard-flag-race

## Files touched

- `functions/src/runs/leaderboardThrottle.ts` — add a pure, transport-free helper
  `leaderboardRefreshFields<T>(rankings, nowIso): Record<string, unknown>` returning exactly
  `{ 'leaderboard.rankings': rankings, 'leaderboard.updatedAt': nowIso, updatedAt: nowIso }`.
  Dotted field paths update only those nested fields; `published`/`frozen` are left untouched.
  (`leaderboard.rankings` is set as a whole array value — the "never dotted-update an array
  *element*" footgun is about `arr.0.field` paths, not this.)
- `functions/src/runs/index.ts` — in `maybeRefreshLeaderboardSnapshot`, replace the plain
  `runRef.update({ leaderboard: { rankings, frozen:false, published: <stale>, updatedAt } })` with a
  `db.runTransaction` that re-reads the run doc, returns early if it is now frozen, and
  `tx.update(runRef, leaderboardRefreshFields(rankings, now))`.

## Behavior

- The early frozen/throttle guards on the first (plain) read stay as a cheap fast-path.
- The transaction's re-read is the correctness boundary: a publish landing mid-refresh cannot be
  clobbered because the write never includes `published`; a freeze landing mid-refresh is caught by
  the in-transaction `frozen` re-check and the write is skipped.

## Test strategy

- **Pure logic (vitest, no emulator):** extend `functions/src/runs/leaderboardThrottle.test.ts` with
  a `leaderboardRefreshFields` block asserting: the payload keys are exactly
  `['leaderboard.rankings','leaderboard.updatedAt','updatedAt']`; it does NOT have
  `leaderboard.published`, `leaderboard.frozen`, or a full `leaderboard` object key; and it carries
  the rankings + stamps both timestamps. This is RED before the helper exists, GREEN after.
- The transactional re-read is verified by the existing e2e lifecycle (leaderboard invariant oracle +
  live/final parity) staying green; a deterministic unit test of the field-path payload is the guard
  against a regression back to a full-object write.

## Gates

`npm run typecheck` · `npm test` · `npm run e2e` (leaderboard scenarios) — all green.
