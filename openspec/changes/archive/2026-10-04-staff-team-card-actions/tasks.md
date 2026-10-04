## 1. RED

- [x] 1.1 `scripts/test-staff-team-actions.ts`: `hasMoreActions` true with score or routing, false with neither; source assertions: the score steps and the routing buttons render only when the actions are open (`showMore`), hold does not depend on it, the toggle has `aria-expanded`, an open panel forces `showMore`. Run it and watch it fail.

## 2. GREEN

- [x] 2.1 `hasMoreActions` in `lib/staffTeamActions.ts`.
- [x] 2.2 `TeamOpsCard`: `actionsOpen` + `showMore = actionsOpen || openPanel !== null`; score steps, custom amount, assign, skip and send back inside it; hold, clear out of bounds and let in outside it; the "פעולות" toggle.
- [x] 2.3 i18n HE + EN.

## 3. Verify

- [x] 3.1 Browser at 375px: the staff app's team list has no score or routing buttons until "פעולות"; hold is one tap; a custom amount panel stays open. (Measured: 7 teams, 31 buttons on the screen, each card name, score, hold, "פעולות". While the amount panel is open the toggle hides; cancel brings it back with the actions still open. Design note: the toggle is hidden while a panel is open rather than kept, so it can neither drop input nor do nothing.)
- [x] 3.2 Gates: `npm run verify` green, `npm run i18n:check:strict` clean.
