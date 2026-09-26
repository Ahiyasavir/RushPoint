# Tasks: team-dossier-and-search

## 1. RED

- [ ] 1.1 Vitest `teamDossier.test.ts` + `teamSearch.test.ts` against the not-yet-existing modules. Confirm RED.
- [ ] 1.2 e2e ledger assertions (design, test strategy), including the sanitizer exclusion. Confirm RED.

## 2. GREEN

- [ ] 2.1 `RunTeam.scoreLedger` type; append in `adjustTeamScore`, `requestTaskHint`, `skipTaskForTeam`,
      `skipStage`, the approval reversal, all inside their existing transactions, capped at 100. 1.2 → green.
- [ ] 2.2 `lib/teamSearch.ts`; search box + filter chips + sort above the teams list. 1.1 (search) → green.
- [ ] 2.3 Keep full team docs in the console's teams listener; derive the existing projections from them.
- [ ] 2.4 Lift the `teamLocations` stream so the live map and the team page share it.
- [ ] 2.5 `lib/teamDossier.ts`. 1.1 → green.
- [ ] 2.6 `components/TeamPage.tsx`: drawer/sheet, `?team=` routing, sections from the view-model, actions
      wired to the console's existing handlers (design D5).
- [ ] 2.7 Rows become buttons that open the page (whole row is the target; the overflow menu stays).
- [ ] 2.8 i18n he/en.

## 3. REFACTOR

- [ ] 3.1 Photo review and media gallery panels render their items with the same media card the team page uses.

## 4. Verify

- [ ] 4.1 Preview flows (design, test strategy), screenshots at both sizes.
- [ ] 4.2 `npm run verify`, `npm run e2e` green, exit codes to a file.
