# Tasks: route-team-to-mission

Source: `docs/field-report-2026-09-27.md` items 5, 5b. Builds on `send-team-back`, `staff-capabilities`.

## 1. RED

- [x] 1.1 `scripts/test-route-blockers.ts` against the not-yet-existing `routeBlockers` (design test
      strategy). Confirm RED.
- [x] 1.2 e2e scenario "route team" (a)-(f). Confirm RED.

## 2. GREEN

- [x] 2.1 `packages/shared/src/routeBlockers.ts` + export; `RunTeam.queuedRoute`,
      `RunTaskRecord.routedByOperator`. 1.1 → green.
- [x] 2.2 `claimSpecificTask(waive)`; `forceAssignTask` accept/when/cross-stage (D2, D3); keep
      `override: true` compatible.
- [x] 2.3 `completeTaskForTeam` visited-record exception (D3); `assignNextInActiveStage` consumes
      `queuedRoute` (D4). 1.2 → green.
- [ ] 2.4 creator-web `RoutePicker` + `routeTeam` action + wrapper + i18n; staff console picker uses
      `routeBlockers`.

## 3. Verify

- [x] 3.1 Preview: now + after, cross-stage visit, the X/Y case.
- [ ] 3.2 `npm run verify`, `npm run e2e`, exit codes to a file.

## Progress (2026-09-28)

Implemented 2026-09-28. Console picker verified in the browser (states, exact blocker list, routing notice on the phone). Staff app: migrated. `forceAssignTask({dryRun:true})` returns the blockers (hard ones reported, not thrown) since the staff app cannot read the game; `StaffRoutePanel` lists every mission (pure `lib/staffRouteList.ts`, `scripts/test-staff-route-list.ts`, RED confirmed first), shows the exact list, now / after. The old per-mission "override lock" button is gone. The e2e dry-run assertions were written in the same step as the server code (RED not separately confirmed). Staff panel browser-verified on the dev stack: dry run named exactly "another stage", "after" queued it (`queuedRoute.waived = [otherStage]` read back from the emulator). Also fixed: the old override handed out a locked mission that completion then refused.

## Overnight additions (2026-09-29, found by playing)
- [x] The phone shows a VISIT: `TaskRunner` found the assigned record only in the active stage, so a
      team sent to a mission in another stage sat on "מאתרים את היעד הבא" with no mission. Pure
      `currentAssignedRec` (`scripts/test-current-mission.ts`); the map treats the visit as current.
- [x] Load sim: 3 concurrent "after this mission" routes to one station, all completed.
