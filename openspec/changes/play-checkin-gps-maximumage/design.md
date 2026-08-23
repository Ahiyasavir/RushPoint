## Context

`withLocation` (`apps/play-web/src/utils/withLocation.ts`) is a one-shot geolocation helper. Grepping
the play-web source, it is imported ONLY by `apps/play-web/src/components/TaskRunner.tsx`, with five
call sites:

- `:187` — routing (`requestRouting`): fetch the participant's position to bias the next-task request.
- `:480` — `field()`: manual check-in for `field` / `self_report`.
- `:499` — `geofenceTestCheckIn()`: the test-drive-only "I'm here" for geofence tasks.
- `:522` — `checkArrival()`: manual hidden-location arrival probe.
- `:593` — `submitWithOptionalPresence()`: presence-gated quiz / numeric answers.

Every one of these is a MANUAL, one-shot action whose result the SERVER re-validates for proximity
(`completeTask`, `reportArrival`, `submitTaskAnswer` all re-check). None of them produces a safety
verdict.

### The safety audit (why a blanket `maximumAge` is safe here)

The safe-zone / out-of-bounds verdict is `evaluateSafeZoneStatus` (`packages/shared/src/safeZone.ts`),
which by design requires a FRESH fix ("absent, stale, malformed, low-accuracy ... ⇒ not a violation;
only a fresh fix ... counts"). Its input is NOT `withLocation`:

- The verdict is fed by `updateLocation`, called from the `PlayScreen` position watcher
  (`PlayScreen.tsx:171-204`). That watcher is a SEPARATE `navigator.geolocation.watchPosition` and
  already uses `{ enableHighAccuracy: true, maximumAge: 10_000 }` (`:201`) and forwards the fix's own
  `accuracyMeters` so the server can judge freshness/confidence itself.
- `GeofenceAuto` auto check-in (`TaskRunner.tsx:1219-1234`) is ALSO its own `watchPosition`, not
  `withLocation`.

So `withLocation` never touches the safe-zone verdict path. Adding `maximumAge: 10_000` to it changes
only the five manual, server-re-validated check-in / arrival / presence / routing flows. A blanket
value is therefore correct; a per-caller `maximumAge` would add API surface for no safety benefit,
since no caller feeds a safety verdict.

### Why 10 seconds specifically

- It equals the `PlayScreen` watcher's existing `maximumAge`, so the two location paths agree.
- Ten seconds of walking is well under a geofence radius (server default 40 m; a person covers roughly
  10 to 15 m in ten seconds), so a reused fix cannot place a far-away participant inside the radius in
  a way the server would not itself accept on re-validation.

## Goals / Non-Goals

**Goals:**
- A manual check-in reuses a recent fix so it feels instant instead of stalling up to 5 seconds.

**Non-Goals:**
- Changing `timeout`, `enableHighAccuracy`, or the `onDenied` contract.
- Touching any `watchPosition`-based path (safe-zone, geofence auto, distance badge).
- Any per-caller option plumbing (unnecessary; see the audit).

## Decisions

### D1 — Add `maximumAge: 10_000` to `withLocation`'s single `getCurrentPosition` options

```ts
navigator.geolocation.getCurrentPosition(
  (p) => cb(p.coords.latitude, p.coords.longitude),
  () => onDenied?.(),
  { enableHighAccuracy: true, timeout: 5000, maximumAge: 10_000 },
);
```

## Risks / Trade-offs

- **A reused fix is up to 10 s stale.** Bounded and server-re-validated: the server rejects a
  check-in that is actually too far, and 10 s of movement is inside the proximity tolerance. This is
  the same staleness the `PlayScreen` watcher already accepts.
- **On-device "feels instant" is not measured here.** Flagged as the manual follow-up; the change
  itself is one option and is asserted by the unit test.

## Test Strategy

Lane: `scripts/test-gps-error-ux.ts` (the existing pure test for `withLocation`, run by `npm test`).

1. Extend it to assert that when `getCurrentPosition` is invoked, the options object carries
   `maximumAge: 10000` (alongside the existing `enableHighAccuracy: true` and `timeout: 5000`), using
   the file's existing `navigator.geolocation` stub. RED before the option is added.
2. Confirm the existing `withLocation` scenarios (success calls `cb`, error calls `onDenied`, absent
   API calls `onDenied`) still pass unchanged.

Gates (no emulator): `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
`npm run creator:build`. No i18n key added; `i18n:check:strict` still run because a `.ts` in play-web
was touched.

## RTL / i18n notes

No UI string and no dictionary change. Nothing rendered; nothing to localize.
