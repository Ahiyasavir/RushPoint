## 1. RED — failing test first

- [x] 1.1 In `scripts/test-stuck-player-guards.ts`, import `canCompleteWithoutLocation` from
      `../apps/play-web/src/lib/stuckGuards` and add cases: `self_report` → true; `field` +
      `locationless:true` → true; located `field` → false; `geofence`/`quiz`/`photo`/unknown/empty →
      false; missing `type` and missing `locationless` → false (default closed).
- [x] 1.2 Add a wiring guard over `apps/play-web/src/components/TaskRunner.tsx` source asserting
      `field()`'s denial path references `canCompleteWithoutLocation(`.
- [x] 1.3 Run `npx tsx scripts/test-stuck-player-guards.ts` and confirm it FAILS (the export does not
      exist and the component is not wired). Record the failure verbatim.

## 2. GREEN — pure predicate

- [x] 2.1 Add `canCompleteWithoutLocation` to `apps/play-web/src/lib/stuckGuards.ts` per design D1
      (no React, no clock, no storage; fail open).
- [x] 2.2 Re-run the test; the unit cases go GREEN and only the wiring guard remains red.

## 3. GREEN — component wiring

- [x] 3.1 In `TaskRunner.tsx` `field()`'s `onDenied`, after the `session.isTestDrive` branch, submit
      via `submitCheckIn()` (no coords) when `canCompleteWithoutLocation(task)` is true; otherwise keep
      `showError(t.task.gpsWarning); end();`.
- [x] 3.2 Re-run `npx tsx scripts/test-stuck-player-guards.ts` and confirm fully GREEN.

## 4. REFACTOR + gates

- [x] 4.1 Re-read the changed region of `TaskRunner.tsx` (a concurrently-edited file) and confirm the
      located-`field` path and the test-drive path are byte-for-byte unchanged.
- [x] 4.2 `npm run typecheck` — green.
- [x] 4.3 `npm run lint` — 0 errors.
- [x] 4.4 `npm test` — green (includes the new cases via `run-unit-tests.mjs`).
- [x] 4.5 `npm run i18n:check:strict` — zero new PART B warnings (no dictionary change).
- [x] 4.6 `npm run play:build` and `npm run creator:build` — green.
- [x] 4.7 Flag the manual follow-up: on a real device, deny location and confirm a `self_report` /
      `locationless` task completes (emulator-bound and on-device checks are not run here).
