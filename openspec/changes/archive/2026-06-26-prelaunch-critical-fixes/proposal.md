## Why

A comprehensive pre-launch audit of the `topographic-maps` branch identified 3 run-breaking
critical bugs and 8 major UX/security issues that must be resolved before the platform goes
live. Left unfixed, these cause teams to get permanently stuck mid-race, submit corrupted
location data silently, and experience the core play loop entirely in English — unacceptable
for a Hebrew-first product targeting the Israeli market.

## What Changes

- **GPS error UX (C1, C2, C3):** `withLocation`, `GeofenceAuto`, and the routing `useEffect`
  in `TaskRunner` currently swallow all GPS/network errors silently. After this change:
  - `requestNextTask` failure shows a localized error message with a retry button instead of
    an infinite spinner.
  - GPS denial/unavailability in `withLocation` produces a user-visible, localized warning
    instead of silently falling back to (0, 0).
  - `GeofenceAuto` shows a localized "GPS required" error state with a fallback "Contact host"
    option instead of freezing forever.

- **TaskRunner i18n (M1):** All ~20 hardcoded English strings in `TaskRunner.tsx` and its
  sub-components (`CodeEntry`, `QuizEntry`, `NumericEntry`, `PhotoEntry`, `GeofenceAuto`,
  `SequenceRunner`, `DistanceBadge`) are replaced with `useT()` keys, matching the pattern
  already established in `JoinScreen` and `GamePromoScreen`.

- **FinalScreen i18n (M2):** All hardcoded English strings in `FinalScreen.tsx` are replaced
  with `useT()` keys. The share text (currently hardcoded Hebrew) is rewritten to use the
  active language from `useT()` so English users share English text.

- **Photo URL server validation (M3):** `submitStationPhoto` in `functions/src/runs/index.ts`
  rejects any `photoUrl` that does not begin with the project's Firebase Storage origin
  (`https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/`). The
  callable returns `INVALID_ARGUMENT` for URLs from any other origin.

- **PhotoEntry memory leak fix (M4):** `PhotoEntry` in `TaskRunner.tsx` revokes the object
  URL returned by `URL.createObjectURL` via a `useEffect` cleanup function. No functional
  change — pure memory hygiene.

- **Required field client-side validation (M5):** `JoinScreen.submit()` validates all
  `field.required === true` registration fields before calling `joinRun`. Empty required
  fields are highlighted with an inline error so participants know exactly which fields to
  fill in, without waiting for a cold server error.

- **BuilderPage error state (M6):** `BuilderPage` wraps `getGame` in a try/catch and renders
  a localized error card with a retry button when loading fails (404, permission denied,
  offline). The infinite spinner is no longer the terminal state.

- **DistanceBadge live GPS (M7):** `DistanceBadge` switches from `getCurrentPosition` (one
  shot) to `watchPosition` with proper cleanup on unmount, so the displayed distance updates
  as the participant walks toward the task.

- **Nominatim production warning (M8):** `LocationPicker` logs a `console.warn` and renders a
  visible amber banner in the map when `VITE_MAPTILER_KEY` is not set, stating that the public
  Nominatim fallback must not be used in production. `DEPLOY.md` is updated to mark
  `VITE_MAPTILER_KEY` as a required production variable.

## Capabilities

### New Capabilities
- `gps-error-ux`: Graceful GPS denial and network-error handling across `TaskRunner`,
  `withLocation`, and `GeofenceAuto` — localized error states and recovery paths.
- `taskrunner-i18n`: Full Hebrew/English i18n of the TaskRunner component and all its
  sub-components, wired into the existing `play-web` i18n system.
- `finalscreen-i18n`: Full Hebrew/English i18n of the FinalScreen component including
  language-aware share text generation.
- `photo-url-validation`: Server-side enforcement that `submitStationPhoto` only accepts
  Firebase Storage URLs, rejecting arbitrary external photo URLs.

### Modified Capabilities
- `play-web-i18n-hebrew`: New `task` and `final` namespaces added to both `HE` and `EN`
  translation maps; `typeof HE` enforcement ensures compile-time parity.

## Impact

- **play-web:** `apps/play-web/src/components/TaskRunner.tsx`,
  `apps/play-web/src/screens/FinalScreen.tsx`, `apps/play-web/src/i18n.ts`
- **creator-web:** `apps/creator-web/src/pages/BuilderPage.tsx`,
  `apps/creator-web/src/components/LocationPicker.tsx`
- **functions:** `functions/src/runs/index.ts` (`submitStationPhoto` callable — server-side
  URL validation, **changes callable behavior**)
- **docs:** `DEPLOY.md` (VITE_MAPTILER_KEY marked required)
- **tests:** new `scripts/test-photo-url-validation.ts`, new `scripts/test-gps-error-ux.ts`,
  e2e assertions in `scripts/e2e-verify.mjs` for photo URL rejection

No new Firestore documents, indexes, or security-rule changes. No new env vars (the
`VITE_MAPTILER_KEY` warning uses the existing var; it just becomes documented as required).
