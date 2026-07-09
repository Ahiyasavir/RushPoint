## 1. Shared predicates — RED then GREEN (pure logic, TDD)

- [x] 1.1 RED: extend `scripts/test-schedule.ts` with `isExpired` (absent/zero/negative/non-finite → never expired; before/at/after the instant; fractional minutes; no run start → not expired), `expiryInstantMs` (none/set/no-start), `validateAvailabilityWindow` (expiry>release ok; expiry==release + expiry<release errors; `releaseAt`+expiry → null), and a combined released-but-expired ⇒ unavailable case. Run `npm test`, confirm the new assertions fail for the right reason.
- [x] 1.2 GREEN: implement `isExpired` + `expiryInstantMs` + `validateAvailabilityWindow` (+ `ExpiryGate`) in `packages/shared/src/schedule.ts`; export from `@rushpoint/shared`. `npm test` → 1.1 passes.

## 2. Shared types
- [x] 2.1 Add `expiresAfterMinutes?: number` to `Task` (doc comment: relative to run `launchedAt`, fractional honored, not secret). `npm run typecheck`.

## 3. Server enforcement (functions)
- [x] 3.1 `routing/assignNextTask.ts`: drop `isExpired(t, launchedAt, nowMs)` candidates in BOTH `buildRecommendations` and the `assignTask` transaction filter.
- [x] 3.2 `runs/index.ts` `completeTask`: extend the scheduled-release gate block to also refuse an expired task (`failed-precondition` "This task has expired"); add the same guard to `submitTaskAnswer` and `submitSequenceStep`.
- [x] 3.3 `runs/index.ts`: `sweepExpiredInFlight` helper (skip expired assigned task; complete stage + release-gated next-stage unlock when all terminal; full-array write) wired into `assignNextInActiveStage` (before the in-flight early-return, with `releaseTask` + `activeTaskId: null`) and `getMyTeamState` (beside `computeStageUnlock`).
- [x] 3.4 `games/index.ts` `updateGame`: reject an empty availability window via `validateAvailabilityWindow` (`invalid-argument`). `npm run typecheck`.

## 4. e2e — allowlist + scenario
- [x] 4.1 Add `expiresAfterMinutes` to `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs`.
- [x] 4.2 Add the `task expiry` scenario: fractional-expiry task assigned → sleep → `completeTask` refused `failed-precondition` → `requestNextTask` reroutes + station slot freed; generous-expiry task passes the sanitizer allowlist; empty-window `updateGame` → `invalid-argument`.
- [ ] 4.3 `npm run e2e` — green (batch gate).

## 5. creator-web — Builder authoring
- [x] 5.1 `TaskWizard.tsx`: "expires N minutes after start" input (0/empty ⇒ undefined) + inline empty-window error and `releaseAt`-combo warning.
- [x] 5.2 creator-web i18n keys (`expiryLead`, `expiryAfterUnit`, `expiryWindowError`, `expiryReleaseAtWarn`) EN + HE.

## 6. play-web — countdown
- [x] 6.1 `TaskRunner.tsx`: ticking "expires in mm:ss" badge when < 10 min remain (from `expiryInstantMs(task, run.launchedAt)`); refresh on zero.
- [x] 6.2 play-web i18n keys (`expiresInLabel`, `taskExpiredNotice`) EN + HE.

## 7. Gates
- [x] 7.1 `npm run typecheck`
- [x] 7.2 `npm run lint`
- [x] 7.3 `npm test` (schedule pure tests green)
- [x] 7.4 `npm run creator:build` + `npm run play:build`
- [ ] 7.5 `npm run e2e`
- [x] 7.6 `npm run i18n:check` (clean; `i18n:check:strict` adds zero new findings)
