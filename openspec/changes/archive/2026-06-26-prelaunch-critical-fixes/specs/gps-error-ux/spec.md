## ADDED Requirements

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
A field / self_report task SHALL display a localized warning message (`t.task.gpsWarning`) when
a participant taps "I'm here" / "Mark complete" and `withLocation` calls `onDenied`, explaining
that GPS is unavailable and location cannot be recorded. The button SHALL remain active so
the participant can tap again to retry once GPS is enabled. The submission SHALL NOT be
blocked client-side (the server decides based on trigger mode).

#### Scenario: GPS denied on field task — warning shown, button remains enabled
- **WHEN** the participant taps "I'm here" and GPS is denied
- **THEN** `t.task.gpsWarning` message is displayed
- **THEN** the "I'm here" button is re-enabled (not permanently disabled)

#### Scenario: GPS succeeds on retry — warning cleared, task submitted
- **WHEN** the participant taps "I'm here" again after granting GPS
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
