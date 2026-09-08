# gps-error-ux Specification

## Purpose
TBD - created by archiving change prelaunch-critical-fixes. Update Purpose after archive.
## Requirements
### Requirement: withLocation notifies caller on GPS denial or unavailability
`withLocation` in `apps/play-web/src/components/TaskRunner.tsx` SHALL accept an optional
second argument `onDenied?: () => void`. When `navigator.geolocation.getCurrentPosition`
calls its error callback (for any `GeolocationPositionError` code: PERMISSION_DENIED,
POSITION_UNAVAILABLE, or TIMEOUT), `withLocation` SHALL call `onDenied()` instead of
calling `cb(0, 0)`. The fallback `cb(0, 0)` path SHALL be removed entirely.
When `navigator.geolocation` is absent (SSR or old browser), `withLocation` SHALL call
`onDenied()` rather than `cb(0, 0)`.

#### Scenario: GPS permission denied — onDenied called, cb not called
- **WHEN** `withLocation(cb, onDenied)` is called and `getCurrentPosition` fires its error callback
- **THEN** `onDenied()` is called exactly once
- **THEN** `cb` is NOT called

#### Scenario: geolocation API absent — onDenied called
- **WHEN** `withLocation(cb, onDenied)` is called in an environment without `navigator.geolocation`
- **THEN** `onDenied()` is called exactly once
- **THEN** `cb` is NOT called

#### Scenario: GPS success — cb called with real coordinates, onDenied not called
- **WHEN** `withLocation(cb, onDenied)` is called and `getCurrentPosition` succeeds with lat=32.08, lng=34.78
- **THEN** `cb(32.08, 34.78)` is called
- **THEN** `onDenied` is NOT called

#### Scenario: No onDenied provided, GPS error — no crash
- **WHEN** `withLocation(cb)` is called (no second argument) and `getCurrentPosition` fires its error callback
- **THEN** the function returns without throwing
- **THEN** `cb` is NOT called

### Requirement: TaskRunner routing useEffect handles requestNextTask failure
The `useEffect` in `TaskRunner` that calls `requestNextTask` SHALL catch errors and display a
localized error message with a "Try again" button (`t.task.retryRouting`) to retrieve the next
assigned task. While the request is in-flight the component SHALL show a localized loading label
(`t.task.routing`). On success, the existing `onChanged()` call SHALL clear the error state.

#### Scenario: requestNextTask succeeds — no error shown
- **WHEN** `requestNextTask` resolves successfully
- **THEN** `onChanged()` is called
- **THEN** no error message or retry button is visible

#### Scenario: requestNextTask fails — localized error and retry visible
- **WHEN** `requestNextTask` rejects with an error
- **THEN** a localized error message is shown (from `t.task.routingError`)
- **THEN** a "Try again" button (`t.task.retryRouting`) is visible
- **THEN** the infinite loading state is not shown

#### Scenario: Retry button triggers requestNextTask again
- **WHEN** the user taps the "Try again" button after a routing failure
- **THEN** `requestNextTask` is called again with the same context
- **THEN** while in-flight, the loading label is shown

### Requirement: field / self_report task — GPS denial shows warning, submission still possible

A GPS denial on a check-in SHALL NEVER permanently block the participant client-side; the response
depends on whether the task needs a location. When the participant taps the check-in control and
`withLocation` invokes `onDenied` (GPS denied, unavailable, or timed out):

- For a `self_report` task, or any task marked `locationless`, the app SHALL submit the completion
  WITHOUT coordinates (via `completeTask` with the coordinates omitted). These task types need no
  location and the server does not enforce proximity for them, so a participant who declined the
  location prompt can still complete a "mark complete from anywhere" task.
- For a genuinely located `field` task (coordinates placed, not `locationless`), the app SHALL display
  the localized warning `t.task.gpsWarning` and SHALL NOT submit blind, because the server needs
  proximity coordinates. The button SHALL remain active so the participant can tap again once GPS is
  available.

The decision of whether a task may be completed without a location fix SHALL be a pure, fail-open
predicate (`canCompleteWithoutLocation` in `apps/play-web/src/lib/stuckGuards.ts`) that returns true
only for `self_report` and `locationless` tasks and defaults to false for every other or unknown task
shape. The server remains the only authority on whether a completion is allowed.

#### Scenario: GPS denied on a self_report task — completion submitted without coordinates

- **WHEN** the participant taps "Mark complete" on a `self_report` task and GPS is denied
- **THEN** `completeTask` is called with the coordinates omitted
- **THEN** no terminal GPS warning traps the participant on the task

#### Scenario: GPS denied on a locationless field task — completion submitted without coordinates

- **WHEN** the participant taps the check-in control on a `locationless` task and GPS is denied
- **THEN** `completeTask` is called with the coordinates omitted

#### Scenario: GPS denied on a located field task — warning shown, button remains enabled

- **WHEN** the participant taps "I'm here" on a located `field` task and GPS is denied
- **THEN** `t.task.gpsWarning` is displayed
- **THEN** the check-in button is re-enabled (not permanently disabled) and no blind submission is sent

#### Scenario: GPS succeeds on retry — warning cleared, task submitted with coordinates

- **WHEN** the participant taps the check-in control again after granting GPS
- **THEN** the GPS warning is cleared
- **THEN** `completeTask` is called with real coordinates

### Requirement: GeofenceAuto shows error state when GPS is unavailable
`GeofenceAuto` in `TaskRunner.tsx` SHALL handle `watchPosition` errors. When the error
callback fires (any code), the component SHALL replace the "Finding your location…" spinner
with a localized error message (`t.task.gpsUnavailable`) and a "Contact host" suggestion
(`t.task.gpsContactHost`). The `watchPosition` watcher SHALL be cleared and not retried
automatically.

#### Scenario: GPS denied before watchPosition fires — error state shown
- **WHEN** `watchPosition` calls its error callback
- **THEN** `t.task.gpsUnavailable` is displayed
- **THEN** `t.task.gpsContactHost` is displayed
- **THEN** the infinite "Finding your location…" text is NOT shown
- **THEN** no auto-check-in attempt is made

#### Scenario: GPS succeeds — distance shown, auto check-in unchanged
- **WHEN** `watchPosition` fires a successful position within radius
- **THEN** the check-in logic fires exactly once (existing `fired.current` guard preserved)
- **THEN** no error state is displayed

### Requirement: DistanceBadge updates live as participant moves
`DistanceBadge` SHALL use `navigator.geolocation.watchPosition` instead of
`getCurrentPosition`. The watcher SHALL be cleared via `clearWatch` in the `useEffect`
cleanup. The displayed distance SHALL update on each new position event.

#### Scenario: Position update received — distance refreshes
- **WHEN** `watchPosition` fires a second position closer to the task
- **THEN** the displayed distance decreases accordingly

#### Scenario: Component unmounts — watcher is cleared
- **WHEN** the component unmounts
- **THEN** `clearWatch` is called with the watcher ID

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

