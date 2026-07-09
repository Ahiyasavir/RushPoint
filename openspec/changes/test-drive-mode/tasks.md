## 1. Pure billing seam — RED then GREEN (TDD)

- [ ] 1.1 RED: vitest/tsx cases for `resolveLaunchBilling(…, { testDrive: true })` (co-locate with the existing freeMode/billing tests): returns `{ ok: true, billingType: 'test', maxParticipants: 2, consume: 'none' }` for payments-off + empty wallet, payments-on + zero-credit wallet, AND payments-on + active-pro wallet (wallet-independent); `testDrive` absent/false leaves every existing decision unchanged. Confirm failure (branch missing).
- [ ] 1.2 GREEN: add `TEST_DRIVE_MAX_PARTICIPANTS = 2` + the testDrive short-circuit (first branch) in `packages/shared/src/freeMode.ts`; extend the decision's `billingType` union with `'test'`. `npm test` → 1.1 passes.

## 2. Shared types
- [ ] 2.1 `Run.isTestDrive?: boolean` + `Run.billingType` union gains `'test'` in `packages/shared/src/types/index.ts` (doc comment: free rehearsal run, cap 2, excluded from cross-run aggregates). `npm run typecheck`.

## 3. Server (functions/src/runs/index.ts)
- [ ] 3.1 `launchRun` accepts `testDrive?: boolean`; testDrive branch (both payment modes) runs a transaction that (a) queries the game's runs `where('isTestDrive','==',true)`, status-filters in code, throws `failed-precondition` ("finalize the live test run first") if any is not `finished`; (b) writes run (`isTestDrive: true`, `billingType 'test'`, `maxParticipants 2`) + access code. No wallet read/write, no wallet transaction doc; skip the `game.playCount` increment for test launches.
- [ ] 3.2 `getJoinInfo` returns `isTestDrive: run?.isTestDrive ?? false`; `joinRun` full-run error copy for `billingType === 'test'` (2-person test run, don't suggest credits/Pro).
- [ ] 3.3 `finalizeRun`: gate the player-profile fold and the platform-benchmark contribution on `!run.isTestDrive` (rankings/leaderboard computed normally); `getRunAnalytics` / `getRunRecap` / `getPublicLeaderboard` return `isTestDrive` for labeling. `npm run typecheck`.

## 4. e2e — test-drive scenario (no new callable)
- [ ] 4.1 New `test-drive` scenario in `scripts/e2e-verify.mjs`: wallet snapshot → test launch → wallet byte-unchanged (credits, free-run counter, no tx doc); `getJoinInfo` shows `isTestDrive: true`; 2 joins OK, 3rd join `resource-exhausted`; second live test launch for the same game `failed-precondition` while a normal launch still succeeds; `finalizeRun` green with `benchmarks/*` and `players/*` untouched; a fresh test launch then succeeds.
- [ ] 4.2 `npm run e2e` — green (coverage guard unchanged at the current callable count).

## 5. creator-web
- [ ] 5.1 `services/calls.ts`: `launchRun` wrapper accepts `testDrive?: boolean`; secondary "Launch test run" action beside the launch button in `BuilderPage.tsx` (via `saveAndLaunch`) and on the `DashboardPage.tsx` game card (via `launch`).
- [ ] 5.2 `RunConsolePage.tsx`: `'test'` case in the billing badge (amber, `t.runConsole.testRun`).
- [ ] 5.3 i18n keys (`launchTestRun`, `testRun`, hint) EN + HE.

## 6. play-web
- [ ] 6.1 `services/calls.ts` `getJoinInfo` type gains `isTestDrive`; persist on the session at join (`store.ts`).
- [ ] 6.2 `PlayScreen.tsx`: persistent "TEST RUN" chip-banner while `isTestDrive` (viewer-banner pattern, static Tailwind, `dir="auto"`).
- [ ] 6.3 i18n key (`testRunBanner`) EN + HE.

## 7. Gates
- [ ] 7.1 `npm run typecheck`
- [ ] 7.2 `npm run lint`
- [ ] 7.3 `npm test`
- [ ] 7.4 `npm run creator:build` + `npm run play:build`
- [ ] 7.5 `npm run e2e`
- [ ] 7.6 `npm run i18n:check` (clean; zero new PART B warnings via `i18n:check:strict`)
