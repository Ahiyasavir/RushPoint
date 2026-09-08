## MODIFIED Requirements

### Requirement: Server gates completion by trigger mode
`completeTask` SHALL enforce the task's trigger mode using `evaluateTrigger` so proximity rules cannot
be spoofed by calling the callable directly. When the task's location is hidden
(`hideLocation === true`), the rejection message on an out-of-range check-in SHALL NOT include the
measured distance or any directional figure — it SHALL be a generic "keep following the clue"
message — so a participant cannot triangulate the hidden spot by repeatedly polling `completeTask`.

#### Scenario: Radius mode accepts within range
- **WHEN** a `radius` task with radius 40m receives a check-in 30m away
- **THEN** `evaluateTrigger('radius', 30, 40).ok` is `true` and completion proceeds

#### Scenario: Radius mode rejects out of range
- **WHEN** a `radius` task with radius 40m receives a check-in 60m away
- **THEN** completion is rejected with `failed-precondition` and a distance message

#### Scenario: Exact mode requires precise arrival
- **WHEN** an `exact` task with radius 4m receives a check-in 3m away it is accepted; at 10m away it
  is rejected with `failed-precondition`

#### Scenario: Instant mode needs no GPS
- **WHEN** an `instant` task receives a `completeTask` call with no coordinates
- **THEN** completion proceeds (no proximity gate)

#### Scenario: Locationless mode needs no GPS
- **WHEN** a `locationless` task receives a `completeTask` call with no coordinates
- **THEN** completion proceeds and routing treats its transit as zero

#### Scenario: Hidden task rejection does not leak distance
- **WHEN** a hidden-location `radius`/`exact` task receives an out-of-range check-in
- **THEN** completion is rejected with `failed-precondition` and a generic non-leaking message that
  contains no distance value or direction
