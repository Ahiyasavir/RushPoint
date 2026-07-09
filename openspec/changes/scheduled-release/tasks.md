## 1. Shared predicate — RED then GREEN (pure logic, TDD)

- [x] 1.1 RED: `scripts/test-schedule.ts` asserting `isReleased` (absent/null/empty/zero → released; past/future/exact `releaseAt`; unparseable → locked; `releaseAfterMinutes` vs run start incl. no-start & t=0; both-set AND semantics) and `releaseInstantMs` (none/releaseAt/after/no-start/both). Confirm it fails.
- [x] 1.2 GREEN: implement `isReleased` + `releaseInstantMs` + `ReleaseGate` in `packages/shared/src/schedule.ts`; export from `@rushpoint/shared`. `npm test` → 1.1 passes (23 assertions).

## 2. Shared types
- [x] 2.1 Add `releaseAt?` / `releaseAfterMinutes?` to `Task` and `Stage` (doc comments). `npm run typecheck`.

## 3. Server enforcement (functions)
- [x] 3.1 `routing/assignNextTask.ts`: `getRunRouting` returns `launchedAt`; both candidate filters drop `!isReleased(task, launchedAt, now)`.
- [x] 3.2 `runs/index.ts` `completeTaskForTeam`: gate the next-stage unlock with `isReleased(nextGameStage, launchedAt, now)`.
- [x] 3.3 `runs/index.ts` `computeStageUnlock` + poll re-check in `assignNextInActiveStage` and `getMyTeamState` (full-array write).
- [x] 3.4 `runs/index.ts` `completeTask`: refuse a not-yet-released task (`failed-precondition`).
- [x] 3.5 `getMyTeamState` returns `run.launchedAt` + `nextStageReleaseAt`. `npm run typecheck`.

## 4. e2e — allowlist + scenario
- [x] 4.1 Add `releaseAt` / `releaseAfterMinutes` to `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs`.
- [x] 4.2 Add the `scheduled release` scenario (task-level future gate skipped+refused+sanitizer-passthrough; stage-level future gate → between-stages countdown; stage-level past gate → unlocks + finishes).
- [ ] 4.3 `npm run e2e` — green (batch gate).

## 5. creator-web — Builder authoring
- [x] 5.1 Stage editor release control (`BuilderPage.tsx`), shown for non-first stages; writes `stage.releaseAfterMinutes`.
- [x] 5.2 creator-web i18n keys (`releaseLead`, `releaseAfterUnit`) EN + HE.

## 6. play-web — countdown
- [x] 6.1 `MyTeamState.nextStageReleaseAt` + `run.launchedAt` in `services/calls.ts`.
- [x] 6.2 `StageDropCountdown` in `PlayScreen.tsx` (ticking; polls on zero).
- [x] 6.3 play-web i18n keys (`nextDropTitle`, `nextDropHint`) EN + HE.

## 7. Gates
- [x] 7.1 `npm run typecheck`
- [ ] 7.2 `npm run lint`
- [x] 7.3 `npm test` (schedule pure test green)
- [ ] 7.4 `npm run creator:build` + `npm run play:build`
- [ ] 7.5 `npm run e2e`
- [x] 7.6 `npm run i18n:check` (clean)
