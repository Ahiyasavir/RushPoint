# Tasks: run-console-tabs-up-front

## 1. RED

- [x] 1.1 In `lib/__tests__/runConsole.test.ts`: the new `PANEL_GROUP` rows, the conditional pinning of
      `alerts` and `startTeams`, signals jump targets for moved panels, `sectionHasNew`. Confirm RED.

## 2. GREEN

- [x] 2.1 `runConsoleLayout.ts`: regroup `joinShare`, `broadcast`, `liveMap`; conditional pinning (design D2). 1.1 → green.
- [x] 2.2 `components/ConsoleTabs.tsx`: desktop sticky bar + phone bottom bar with icons, short names,
      badges on every size (design D1, D3).
- [x] 2.3 `RunConsolePage`: new render order; bottom padding under the phone bar; the rail component removed.
- [x] 2.4 "New since you looked" dots (design D3) and keyboard shortcuts (D4).
- [x] 2.5 i18n he/en: short section names, shortcut titles.

## 3. REFACTOR

- [x] 3.1 Delete the rail-specific comments and `activeSectionTabRef` scroll-into-view logic that the
      always-visible bar makes unnecessary.

## 4. Verify

- [x] 4.1 Re-run the 2026-09-25 measurement at 375×812 and 1400×860 (design, acceptance); record the
      numbers here next to the old ones; screenshots.
      Measured 2026-09-26, seeded demo run (emulator), `getBoundingClientRect` on the nav:
      | Viewport | Before (tabs top · fully visible) | After |
      |---|---|---|
      | 375×812 | 1,665 px · 2 of 5 | fixed bottom bar, 755–812 px at scroll 0 · **5 of 5**, no sideways scroll |
      | 1400×860 | 885 px · 5 of 5 | **224 px** · 5 of 5 |
      Desktop misses the design's ≤ 200 px target by 24 px: what sits above is only the run
      header and the "needs you now" row, which stays above the tabs on purpose. Tapping a tab
      and the `5` shortcut both switch the section; no page errors.
- [ ] 4.2 `npm run verify`, `npm run e2e` green, exit codes to a file.
