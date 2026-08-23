## ADDED Requirements

### Requirement: withLocation reuses a recent position fix for manual check-in

`withLocation` (`apps/play-web/src/utils/withLocation.ts`) SHALL pass `maximumAge: 10000` to
`navigator.geolocation.getCurrentPosition`, so a position fix up to ten seconds old is reused instead
of forcing a fresh acquisition on every manual check-in, arrival, presence, or routing action. The
`enableHighAccuracy: true` and `timeout: 5000` options and the `onDenied` contract SHALL be unchanged.

This SHALL NOT affect any safety verdict: the safe-zone / out-of-bounds decision is fed by the
`PlayScreen` position watcher (which keeps its own `watchPosition`) and not by `withLocation`, so its
freshness requirement is untouched.

#### Scenario: A recent fix is reused instead of re-acquired

- **WHEN** `withLocation` requests a position and a fix from within the last ten seconds is available
- **THEN** `getCurrentPosition` is invoked with `maximumAge: 10000` so the recent fix may be reused

#### Scenario: The denial and success contracts are unchanged

- **WHEN** `getCurrentPosition` succeeds
- **THEN** `cb` is called with the fix coordinates
- **WHEN** `getCurrentPosition` fires its error callback or the geolocation API is absent
- **THEN** `onDenied` is called and `cb` is not
