# Tasks: run-console-tabs-up-front

## 1. RED

- [ ] 1.1 In `lib/__tests__/runConsole.test.ts`: the new `PANEL_GROUP` rows, the conditional pinning of
      `alerts` and `startTeams`, signals jump targets for moved panels, `sectionHasNew`. Confirm RED.

## 2. GREEN

- [ ] 2.1 `runConsoleLayout.ts`: regroup `joinShare`, `broadcast`, `liveMap`; conditional pinning (design D2). 1.1 → green.
- [ ] 2.2 `components/ConsoleTabs.tsx`: desktop sticky bar + phone bottom bar with icons, short names,
      badges on every size (design D1, D3).
- [ ] 2.3 `RunConsolePage`: new render order; bottom padding under the phone bar; the rail component removed.
- [ ] 2.4 "New since you looked" dots (design D3) and keyboard shortcuts (D4).
- [ ] 2.5 i18n he/en: short section names, shortcut titles.

## 3. REFACTOR

- [ ] 3.1 Delete the rail-specific comments and `activeSectionTabRef` scroll-into-view logic that the
      always-visible bar makes unnecessary.

## 4. Verify

- [ ] 4.1 Re-run the 2026-09-25 measurement at 375×812 and 1400×860 (design, acceptance); record the
      numbers here next to the old ones; screenshots.
- [ ] 4.2 `npm run verify`, `npm run e2e` green, exit codes to a file.
