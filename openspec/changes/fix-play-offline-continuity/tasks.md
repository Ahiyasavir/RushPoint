# Tasks: fix-play-offline-continuity

## 1. RED
- [x] Add `scripts/test-sync-error.ts` asserting `isFatalSyncError` is true for not-found /
      permission-denied / unauthenticated and false for unavailable / internal / deadline-exceeded /
      undefined / ''. Confirmed RED (module did not exist).

## 2. GREEN
- [x] Add `apps/play-web/src/lib/syncError.ts` with `isFatalSyncError`.
- [x] `PlayScreen`: add `reconnecting` state + `hasState` ref; classify errors (fatal → error screen,
      transient → keep state + reconnecting pill); add `online`/`offline` listeners + short retry while
      reconnecting; render the non-blocking `ReconnectingPill`.
- [x] Add `play.reconnecting` to `i18n.ts` (HE + EN).
- [x] Pure test passes GREEN (8/8).

## 3. Verify (gates)
- [x] `npm run typecheck` green.
- [x] `npm test` green.
- [x] `npm run lint` green.
- [x] `npm run creator:build` green.
- [x] `npm run play:build` green.
- [x] `npm run i18n:check` clean.
- [~] Preview: both apps render clean (0 console errors); interactive offline-pill screenshot deferred (low risk — logic unit-tested, wiring smoke-verified).
      (screenshot).
