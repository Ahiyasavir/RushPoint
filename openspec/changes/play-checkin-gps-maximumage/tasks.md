## 1. RED — failing test first

- [x] 1.1 In `scripts/test-gps-error-ux.ts`, extend the `withLocation` success case to assert the
      options passed to `getCurrentPosition` include `maximumAge: 10000` (alongside
      `enableHighAccuracy: true` and `timeout: 5000`), using the file's existing geolocation stub.
- [x] 1.2 Run `npx tsx scripts/test-gps-error-ux.ts` and confirm it FAILS on the missing `maximumAge`.
      Record the failure verbatim.

## 2. GREEN — add the option

- [x] 2.1 In `apps/play-web/src/utils/withLocation.ts`, add `maximumAge: 10_000` to the
      `getCurrentPosition` options object. Leave `enableHighAccuracy`, `timeout`, and the `onDenied`
      contract untouched.
- [x] 2.2 Re-run `npx tsx scripts/test-gps-error-ux.ts` and confirm GREEN, including the unchanged
      success / denial / absent-API scenarios.

## 3. REFACTOR + gates

- [x] 3.1 Re-confirm the safety audit holds in the current tree: `withLocation` is imported only by
      `TaskRunner.tsx`, and neither `PlayScreen`'s watcher nor `GeofenceAuto` uses it (both keep their
      own `watchPosition`), so no safe-zone verdict is affected.
- [x] 3.2 `npm run typecheck` — green.
- [x] 3.3 `npm run lint` — 0 errors.
- [x] 3.4 `npm test` — green (includes the extended `test-gps-error-ux.ts`).
- [x] 3.5 `npm run i18n:check:strict` — clean (no dictionary change).
- [x] 3.6 `npm run play:build` and `npm run creator:build` — green.
- [x] 3.7 Flag the manual follow-up: on a real device, confirm a check-in with a recent fix submits
      without the multi-second stall (on-device timing is not measured here).
