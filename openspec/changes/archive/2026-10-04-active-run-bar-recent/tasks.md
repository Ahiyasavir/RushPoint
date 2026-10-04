## 1. RED

- [x] 1.1 `liveRunsPolling.test.ts`: `recentLiveRuns` keeps a run launched an hour ago, drops one from last month, keeps one with no launch time, is total on junk.
- [x] 1.2 `test-run-history-badge.ts`: `isPlayingNow` agrees with the badge. Run both and watch them fail.

## 2. GREEN

- [x] 2.1 `isPlayingNow` in `lib/runHistoryBadge.ts`; the badge reads it.
- [x] 2.2 `recentLiveRuns` in `hooks/liveRunsPolling.ts`.
- [x] 2.3 `ActiveRunBar` features and counts `recentLiveRuns(runs, now)`.

## 3. Verify

- [x] 3.1 Browser: with only old open runs, no bar on the dashboard; with a fresh run, the bar shows it. (Checked against the REAL local data: 7 live runs, all with `launchedAt`, and only the run launched today passes `isPlayingNow`. The pane could not be drawn this time, the window was behind another one and `visibilityState` was `hidden`, which pauses the poll by design, so the visual check of the bar itself is still owed.)
- [x] 3.2 Gates: `npm run verify` green, `npm run i18n:check:strict` clean.
