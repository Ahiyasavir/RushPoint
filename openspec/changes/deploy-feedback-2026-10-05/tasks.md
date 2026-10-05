## 1. RED → GREEN, per item (each test written first and seen failing)

- [x] 1.1 Host sheet map context: `scripts/test-print-map.ts` (zoom cap 16, retina URL, overview three
  levels out with the detail frame centred) → `printOverviewLayout`, `hostSheet.overview`, the page.
- [x] 1.2 Section index: `scripts/test-section-index.ts` → `sectionIndexPanels`, the index in the
  section pane, "שיתוף וצוות".
- [x] 1.3 Team picker: `scripts/test-followed-picker.ts` → FollowedStrip picker, its own query.
- [x] 1.4 Skip without points: e2e "skip without points" → `skipStage({ noPoints })`, `dialog.choose`.
- [x] 1.5 Standings reach phones: e2e "publishing stamps the team document" → `boardPublishedAt`.
- [x] 1.6 Contributions: `scripts/test-test-mode.ts` (projection) + `scripts/test-team-participation.ts`
  (`contributionView`) + e2e "a one-phone team completes without tapping" → projection, completeTask,
  TaskRunner.
- [x] 1.7 Bug fixes: test-print-css, test-overlay-order, test-active-flag-marker.

## 2. Verify

- [x] 2.1 `npm run verify` and the emulator e2e: green (commits 8eb4d79, 1199081).
- [x] 2.2 Browser, local stack: host sheet maps, section index, team picker, send-back picker above the
  team page, skip without points (score 0, no ledger line). Logged in docs/OVERNIGHT-2026-10-05.md.
