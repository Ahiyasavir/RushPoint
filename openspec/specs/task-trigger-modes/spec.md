# task-trigger-modes Specification

## Purpose
TBD - created by archiving change task-trigger-modes. Update Purpose after archive.
## Requirements
### Requirement: A task has one of four explicit trigger modes
Every task SHALL have a `triggerMode` of `radius`, `exact`, `instant`, or `locationless` (default
`radius`). The mode determines whether and how proximity gates completion.

#### Scenario: Default mode is radius
- **WHEN** a task is created without an explicit `triggerMode`
- **THEN** `normalizeTriggerMode(task)` returns `radius`

#### Scenario: Legacy geofence type maps to radius
- **WHEN** `normalizeTriggerMode` is called on a task with `type === 'geofence'` and no `triggerMode`
- **THEN** it returns `radius`

#### Scenario: Locationless invariant holds
- **WHEN** a task's `triggerMode` is `locationless`
- **THEN** its `locationless` flag is `true`, and vice versa

---

### Requirement: Default trigger radii
`defaultRadiusFor` SHALL return 40 metres for `radius`, 4 metres for `exact`, and 0 for `instant` and
`locationless`. The `radius` value is creator-editable for `radius`/`exact`.

#### Scenario: Radius and exact defaults
- **WHEN** `defaultRadiusFor('radius')` and `defaultRadiusFor('exact')` are called
- **THEN** they return `40` and `4` respectively

---

### Requirement: Server gates completion by trigger mode
`completeTask` SHALL enforce the task's trigger mode using `evaluateTrigger` so proximity rules cannot
be spoofed by calling the callable directly.

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

---

### Requirement: Wizard Step 1 presents the four trigger modes
Wizard Step 1 SHALL present a selector for the four trigger modes (replacing the binary locationless
toggle), with a radius input shown only for `radius` and `exact`.

#### Scenario: Selecting locationless hides the map
- **WHEN** a creator selects `locationless` on Step 1
- **THEN** `task.triggerMode` is `locationless`, `task.locationless` is `true`, and the map is hidden

#### Scenario: Radius input visible only for radius/exact
- **WHEN** a creator selects `radius` or `exact`
- **THEN** a radius (metres) input is shown, defaulting to 40 or 4 respectively; for `instant` and
  `locationless` no radius input is shown

