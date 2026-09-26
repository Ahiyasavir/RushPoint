# Tasks: quick-dial-and-actions

Depends on: `team-dossier-and-search` (team page), `staff-capabilities` (`contactTeams`, capability filter),
`run-console-tabs-up-front` (where the bar sits).

## 1. RED

- [ ] 1.1 `scripts/test-phone-link.ts`, `scripts/test-quick-actions.ts`. Confirm RED.
- [ ] 1.2 e2e for `setRunContacts` and contacts delivery (design, test strategy). Confirm RED.

## 2. GREEN

- [ ] 2.1 `phoneLink.ts`, `quickActions.ts`, `Run.contacts` type. 1.1 → green.
- [ ] 2.2 `setRunContacts` callable + export + `PRIVILEGED_CALLABLES` + rate limit + wrappers; contacts in
      `getMyTeamState` and the staff bootstrap. 1.2 → green.
- [ ] 2.3 Console contacts editor (in "share and screens" or the run header menu).
- [ ] 2.4 Player: "call the organizer" in the SOS sheet and the mission help menu.
- [ ] 2.5 Team page + staff app: call/WhatsApp for team phone fields; `contactTeams` capability.
- [ ] 2.6 Quick-actions bar + customiser (console), saved to `users/{uid}.consolePrefs`; staff bar in localStorage.
- [ ] 2.7 i18n he/en, both apps.

## 3. REFACTOR

- [ ] 3.1 The console's existing action handlers are referenced by id from one map used by both the panels
      and the bar (no duplicated handler code).

## 4. Verify

- [ ] 4.1 Preview flows; a real phone taps a `tel:` and a WhatsApp link.
- [ ] 4.2 `npm run verify`, `npm run e2e` green, exit codes to a file.
