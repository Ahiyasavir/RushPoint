# Tasks: quick-dial-and-actions

Depends on: `team-dossier-and-search` (team page), `staff-capabilities` (`contactTeams`, capability filter),
`run-console-tabs-up-front` (where the bar sits).

## 1. RED

- [x] 1.1 `scripts/test-phone-link.ts`, `scripts/test-quick-actions.ts`. Confirm RED.
- [x] 1.2 e2e for `setRunContacts` and contacts delivery (design, test strategy). Confirm RED.

## 2. GREEN

- [x] 2.1 `phoneLink.ts`, `quickActions.ts`, `Run.contacts` type. 1.1 → green.
- [x] 2.2 `setRunContacts` callable + export + `PRIVILEGED_CALLABLES` + rate limit + wrappers; contacts in
      `getMyTeamState` and the staff bootstrap. 1.2 → green.
- [x] 2.3 Console contacts editor (in "share and screens" or the run header menu).
- [x] 2.4 Player: "call the organizer" in the SOS sheet and the mission help menu.
      (Built as a call button beside SOS in the play header + the numbers on the waiting screen.)
- [x] 2.5 Team page + staff app: call/WhatsApp for team phone fields; `contactTeams` capability.
      (Team page and staff app share `teamCallTargets` (shared/runContacts.ts). `getRunOutline` returns the
      game's phone fields; the staff team card shows 📞/💬 only with `contactTeams` (now also in the
      "judge" preset). `staffSignIn` and `refreshStaffSession` return the STAFF-visible contacts, shown
      as "טלפונים של האירוע" at the top of the staff app. e2e: run contacts scenario.)
- [x] 2.6 Quick-actions bar + customiser (console), saved to `users/{uid}.consolePrefs`; staff bar in localStorage.
      (Reorder is ▲/▼ buttons (`moveQuickAction`), not a drag: a drag is fiddly on a phone and invisible to
      a screen reader. Staff bar: `StaffQuickBar`, shortcuts to the staff console's own sections, filtered
      by the code's capabilities (`readStaffQuickActions`), per device; checked in the browser across a
      reload.)
- [x] 2.7 i18n he/en, both apps.

## 3. REFACTOR

- [ ] 3.1 (Open: the console bar already maps ids to the console's own handlers; a single shared map with the panels is a refactor for later.) The console's existing action handlers are referenced by id from one map used by both the panels
      and the bar (no duplicated handler code).

## 4. Verify

- [~] 4.1 Preview flows; a real phone taps a `tel:` and a WhatsApp link.
      (Preview: contacts editor, the player's call link, the bar and the team picker checked.
      A real phone tapping the links: still owed.)
- [ ] 4.2 `npm run verify`, `npm run e2e` green, exit codes to a file.
