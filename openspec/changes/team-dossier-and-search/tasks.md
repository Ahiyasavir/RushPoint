# Tasks: team-dossier-and-search

## 1. RED

- [x] 1.1 Vitest `teamDossier.test.ts` + `teamSearch.test.ts` against the not-yet-existing modules. Confirm RED.
- [x] 1.2 e2e ledger assertions (design, test strategy), including the sanitizer exclusion. Confirm RED.

## 2. GREEN

- [x] 2.1 `RunTeam.scoreLedger` type; append in `adjustTeamScore`, `requestTaskHint`, `skipTaskForTeam`,
      `skipStage`, the approval reversal, all inside their existing transactions, capped at 100. 1.2 → green.
- [x] 2.2 `lib/teamSearch.ts`; search box + filter chips + sort above the teams list. 1.1 (search) → green.
      (Phone names / team code are matched when the row carries them; `listRunTeams` rows do
      not yet, so today the box finds team and member names. Not checked in a browser yet:
      the seeded demo run has no teams.)
- [x] 2.3 Keep full team docs in the console's teams listener; derive the existing projections from them.
- [ ] 2.4 Lift the `teamLocations` stream so the live map and the team page share it.
      (NOT DONE: the team page has no location section yet.)
- [x] 2.5 `lib/teamDossier.ts`. 1.1 → green.
- [x] 2.6 `components/TeamPage.tsx`: drawer/sheet, `?team=` routing, sections from the view-model, actions
      wired to the console's existing handlers (design D5).
      (Built: current mission + time, people and phones, media with approve/reject/undo, the score
      ledger, the timeline with answers; actions: score, skip mission, send back. NOT built: the
      chat with the team inside the page, and location.)
- [x] 2.7 Rows become buttons that open the page (the team NAME is the button; the overflow menu stays).
- [x] 2.8 i18n he/en.

## 3. REFACTOR

- [ ] 3.1 Photo review and media gallery panels render their items with the same media card the team page uses.

## 4. Verify

- [x] 4.1 Preview flows (design, test strategy), screenshots at both sizes.
      (1400 and 375: open from a row, `?team=` survives a reload, Esc closes and clears it, `/`
      focuses search, an empty search says so, a +20 adjustment from inside the page appears live
      in the ledger with its translated reason. Found and fixed on the way: the site header was
      drawn over the drawer (portal), and preset reasons showed as raw codes.)
- [ ] 4.2 `npm run verify`, `npm run e2e` green, exit codes to a file.
