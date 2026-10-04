## Decisions

### D1. One predicate
`isPlayingNow(run, now)` lives in `lib/runHistoryBadge.ts` beside the badge that already
used the same 24-hour window, and `runHistoryBadge` is rewritten on top of it. Two surfaces
asking "is this run happening" must get one answer.

### D2. Filter before featuring
`recentLiveRuns(runs, now)` (pure, in `hooks/liveRunsPolling.ts`) runs before
`selectFeaturedRun`. The bar's "עוד N ריצות" counts the same filtered list, so it never
counts a run it would not show.

### D3. Unknown time is "playing"
A run with no parseable `launchedAt` is kept. Hiding a real event because one field is
missing is worse than showing a stale bar.

### D4. No new surface
No dashboard nudge in this change: `/live` and the history already list open runs, and the
history now labels them "עדיין פתוחה". A nudge can follow if forgotten runs turn out to matter.

## Risks

- An event longer than 24 hours loses its bar after a day. Acceptable: the product's runs
  are hours long, and the console, `/live` and the history still reach it.
