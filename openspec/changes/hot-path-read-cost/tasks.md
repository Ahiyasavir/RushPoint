## 1. The leaderboard refresh stops reading the whole field

- [ ] 1.1 RED: extend `scripts/test-transaction-retry.ts`'s sibling idiom with a new
      `scripts/test-hot-path-reads.ts` that DECLARES the hot-path reads which must be cached —
      the leaderboard refresh's team-collection read, and the game-document read in each hot
      participant callable — and fails while any of them is uncached. Run it; confirm it fails
      naming the real sites.
- [ ] 1.2 GREEN: route `maybeRefreshLeaderboardSnapshot`'s team read through
      `cachedGetCollection` and its game read through `cachedGetDoc`.
- [ ] 1.3 GREEN: route the game-document read through `cachedGetDoc` in the hot participant
      callables (`submitTaskAnswer`, `completeTask`, `reportArrival`, `submitSequenceStep`,
      `requestTaskHint`, `getRecommendedTasks`, `revealTaskAnswer`, `assignNextInActiveStage`,
      `completeTaskForTeam`). Leave one-off and organizer-side paths alone.
- [ ] 1.4 Confirm the doc-cache suites are still green — this widens reliance on the cache, so
      `scripts/test-doc-cache.ts` and `scripts/test-doc-cache-interception.ts` are load-bearing.

## 2. The organizer board stops re-reading locations at interaction speed

- [ ] 2.1 RED: add assertions that the `teamLocations` read in `listRunTeams` is refreshed on its
      own interval rather than on every call, and that a row in between carries the last known
      freshness value rather than null.
- [ ] 2.2 GREEN: implement the throttle with the interval named as a declared constant and the
      reasoning beside it — specifically that this value never gates a safety decision.

## 3. The participant poll follows the corrected budget

- [ ] 3.1 Raise the fallback poll from 45 s to 60 s and update the comment's arithmetic to the
      corrected figures, so the number in the code matches the number in this change.

## 4. Prove it

- [ ] 4.1 `npm run verify` green (UI touched ⇒ zero new i18n PART B findings).
- [ ] 4.2 `npm run verify:emulator` green. Scoring and leaderboard paths changed, so the
      leaderboard invariant oracle and live/final parity assertions are the ones that matter.
- [ ] 4.3 Re-measure per-callable reads against production and record them beside the projection.
- [ ] 4.4 Re-run the production simulation at 120 teams after the daily quota resets, and record
      measured reads against the 50,000 ceiling. Report honestly if it still misses.
