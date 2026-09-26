# Tasks: send-team-back

Depends on: `skip-keeps-the-stage` (skip causes), `team-dossier-and-search` (the entry point and the ledger).

## 1. RED

- [x] 1.1 `scripts/test-team-rewind.ts` against the not-yet-existing `planTeamRewind` (design, test strategy). Confirm RED.
- [x] 1.2 e2e scenario "send team back" + authz matrix row. Confirm RED (unknown callable).

## 2. GREEN

- [x] 2.1 `packages/shared/src/teamRewind.ts`; export. 1.1 → green.
- [x] 2.2 `returnTeamTo` callable (design D1–D6): one transaction, whole-array stage rewrite, slot claim/release,
      ledger, audit (`team_returned`), targeted announcement, forced leaderboard refresh, `dryRun`.
- [x] 2.3 Re-export in `functions/src/index.ts`; `PRIVILEGED_CALLABLES` entry; rate limit in
      `packages/shared/src/rateLimit.ts`; typed wrappers in both apps. 1.2 → green.
- [x] 2.4 Console team row: `sendBack` action in `runConsoleActions.ts` (consequence entry, confirm with the
      dry-run preview) + `SendBackPicker` dialog listing stages → missions with status. Works WITHOUT the
      team page. Test: `runConsole.test.ts` asserts every team row offers `sendBack`.
- [ ] 2.4b Team page timeline (when `team-dossier-and-search` lands): "return here" on skipped/completed missions and on completed stages, with the
      dry-run preview in the confirm. i18n he/en.
- [x] 2.5 Staff console: the same picker in the team actions; behind `route` once `staff-capabilities` lands.

## 3. REFACTOR

- [ ] 3.1 Share the capacity-checked claim between `forceAssignTask` and `returnTeamTo` (one helper).
- [x] 3.2 Close `approval-can-be-undone` task 8.1 with a pointer to this change.

## 4. Verify

- [ ] 4.1 Preview: reopen a skipped mission and a completed stage; player tab shows the notice.
- [ ] 4.2 `npm run verify`, `npm run e2e` green (incl. callable coverage), exit codes to a file.

## Progress notes (2026-09-25)

- Verified in the running app: the console's "החזרת הקבוצה" (team row menu) → picker → the server's
  dry-run preview in the confirm → the team is on the chosen mission, later stages wait with their
  completed missions kept, the held mission released; the player's phone shows "המארגנים החזירו
  אתכם אל: …" and the mission. Same flow from the staff app (inline panel), with the button naming
  its action.
- Found while verifying, fixed with a test first: the score LEDGER recorded the stored award (-10)
  while the score only moved by what the zero clamp allowed (0). Entries now sum to the real delta.
- Found while verifying: the staff app had NO access to mission names (games are owner-read only),
  so its force-assign menu, the photo queue and the new send-back panel showed raw ids. New read-only
  callable `getRunOutline` (names only, owner or run staff, e2e: names back, nothing secret,
  participant refused) now feeds all three.
- Honesty: the e2e scenario was written after the callable, so it was not observed RED; RED was
  proven in the pure lane (scripts/test-team-rewind.ts) and for getRunOutline (not-found first).
- Investigated and DISPROVED: a "session expired" banner after switching a page from player to staff
  suggested that a reloaded staff console loses its SOS listener. A real reload + a written SOS showed
  the alert within 3 s; the banner came only from switching identity mid-page in the test.
- 2.4b (team page timeline) waits for team-dossier-and-search.
