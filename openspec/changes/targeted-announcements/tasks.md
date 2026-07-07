## 1. Shared helpers — RED then GREEN (pure logic, TDD)

- [x] 1.1 RED: `scripts/test-targeted-announcements.ts` asserting `announcementVisibleTo` (no `teamId` ⇒ visible; empty-string `teamId` ⇒ global/visible; own team ⇒ visible; other team ⇒ hidden) and `formatScoreNotice` (`+50` / `-25` sign rendering, with & without reason, EN output English / HE output Hebrew). Confirm it fails.
- [x] 1.2 GREEN: implement both in `packages/shared/src/announcements.ts`; export from `@rushpoint/shared`. `npm test` → 1.1 passes.

## 2. Shared types
- [x] 2.1 Add `teamId?` / `kind?` / `delta?` to `Announcement` with doc comments (incl. the "client-side filter, non-secret" note). `npm run typecheck`.

## 3. Server (functions/src/index.ts)
- [x] 3.1 `pushAnnouncement`: accept optional `teamId`; validate + verify the team doc exists (`not-found` on a bogus id); persist `teamId` + `kind:'announcement'`; prefix the team name in the `mirrorToChat` mirror.
- [x] 3.2 `adjustTeamScore`: after the existing transaction + audit log (both UNCHANGED), create a `kind:'score'` announcement doc (`teamId`, `delta`, bilingual `formatScoreNotice` messages, `active:true`). Plain create, outside the transaction, best-effort.
- [x] 3.3 Rules comment under `match /announcements` documenting client-side `teamId` filtering. `npm run typecheck`.

## 4. e2e — extend existing flows (no new callable)
- [x] 4.1 Lifecycle scenario in `scripts/e2e-verify.mjs`: targeted announcement persists `teamId`+`kind`; bogus `teamId` ⇒ `not-found`; untargeted doc carries no `teamId`.
- [x] 4.2 Adjust-score assertions: existing `bonusPenalty`/audit checks stay green AND the run now has a `kind:'score'` announcement with the right `teamId`, `delta`, and bilingual messages.
- [x] 4.3 `npm run e2e` — green (coverage-guard list unchanged; batch gate).

## 5. creator-web — composer team picker
- [x] 5.1 `services/calls.ts`: `pushAnnouncement` wrapper gains optional `teamId`.
- [x] 5.2 `RunConsolePage.tsx`: team `<select>` on the composer (default "All teams", options from the loaded team list); pass `teamId` only when a team is chosen.
- [x] 5.3 creator-web i18n keys (`announceAllTeams`, `announceToTeam`) EN + HE.

## 6. play-web — filter + score toast
- [x] 6.1 `LiveOps.tsx`: filter announcements through `announcementVisibleTo(a, myTeamId)`.
- [x] 6.2 `kind:'score'` toast rendering (sign-aware delta, reason, `dir="auto"`, dismissible, auto-hide after 10 min via the existing `now` tick).
- [x] 6.3 play-web i18n keys (`scoreBonusToast`, `scorePenaltyToast`) EN + HE.

## 7. Gates
- [x] 7.1 `npm run typecheck`
- [x] 7.2 `npm run lint`
- [x] 7.3 `npm test`
- [x] 7.4 `npm run creator:build` + `npm run play:build`
- [ ] 7.5 `npm run e2e` (NOT run per instruction — emulator e2e skipped; assertions authored)
- [x] 7.6 `npm run i18n:check` (clean)
