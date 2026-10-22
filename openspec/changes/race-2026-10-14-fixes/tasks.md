# Tasks: race-2026-10-14-fixes

## 1. RED
- [x] 1.1 e2e "race 14.10: no team stuck in silence": run against the production server code, 7 of
      13 checks fail with the race's own errors ("Too far from the spot (334m away)", "This stage
      is not active yet", a restored team with no mission, "not-controller").
- [x] 1.2 `scripts/test-run-history-badge.ts` D07, `liveRunsPolling.test.ts` and `creatorNav.test.ts`
      D08, `liveRunGuard.test.ts` D06: fail first.
- [x] 1.3 `scripts/test-targeted-announcements.ts` D27: fails with "+20 · reasonCreativity".
- [x] 1.4 e2e "renameTeam": written before the callable.

## 2. GREEN
- [x] 2.1 Server: `arrivalLatched`, `routedHereByOperator`, restore assigns, viewer may request.
- [x] 2.2 play-web: check-in without a fix is sent; viewers ask for routing.
- [x] 2.3 creator-web: `liveRunGuard` in Builder + Dashboard; activity-based `isPlayingNow`,
      `compareRunsForFocus`; `updatedAt` + `isTestDrive` on the live and history listings.
- [x] 2.4 `formatScoreNotice` resolves preset reason ids.
- [x] 2.5 `renameTeam` + console action + HE/EN copy + hardening declaration.

## 3. Verify
- [x] 3.1 `npm run verify` (all but origin:check, which needs the .env files a worktree lacks), full `npm run e2e`.
- [x] 3.2 Played in the browser (local emulator), 21.10: pause then a stuck team moves on; GPS-less let-in check-in; no let-in stays sealed; preset reason label; rename; Builder launch over a live run (open, cancel twice); run bar + game card after an empty duplicate; viewer phone routes a stranded team.
