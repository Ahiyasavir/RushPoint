## Why

`withLocation` (`apps/play-web/src/utils/withLocation.ts:19-23`) requests a one-shot fix with
`{ enableHighAccuracy: true, timeout: 5000 }` and NO `maximumAge`. `maximumAge` defaults to `0`, which
forces the browser to acquire a brand-new fix on every call and forbids reusing a cached one. So each
manual check-in ("I'm here"), hidden-location arrival, and presence-gated answer can stall the submit
for up to 5 seconds even when the phone already has a perfectly good fix from seconds ago (the
`PlayScreen` position watcher and the `DistanceBadge` watcher are continuously producing fixes the
whole time). To the participant the button spins and nothing visibly happens: it reads as a freeze on a
real field check-in.

## What Changes

- `withLocation` SHALL pass a conservative `maximumAge` (10000 ms) to `getCurrentPosition`, so a
  position fix up to ten seconds old is reused instead of forcing a fresh acquisition. `timeout`,
  `enableHighAccuracy`, and the `onDenied` contract are unchanged.
- 10000 ms matches the `maximumAge` the `PlayScreen` live watcher already uses
  (`PlayScreen.tsx:201`), keeping the two location paths consistent.

## What does NOT change

- The safety-critical safe-zone verdict is NOT fed by `withLocation` and is untouched (see design for
  the audit): the out-of-bounds decision (`evaluateSafeZoneStatus`, which requires a FRESH fix) is fed
  by the `PlayScreen` watcher and `GeofenceAuto`, both of which have their OWN `watchPosition` and are
  not modified.
- `withLocation`'s `onDenied` behavior, `enableHighAccuracy`, and `timeout: 5000` stay exactly as they
  are. No proximity gate is weakened: the server re-validates every check-in.
- No i18n change.

## Impact

- Affected specs: `gps-error-ux` (one requirement ADDED).
- Affected code: `apps/play-web/src/utils/withLocation.ts` (one option added),
  `scripts/test-gps-error-ux.ts` (assert the option is present).
- NOT touched: `PlayScreen`'s watcher, `GeofenceAuto`, `DistanceBadge`, the server, and the
  dictionaries.
