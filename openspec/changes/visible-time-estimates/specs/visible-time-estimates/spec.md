## ADDED Requirements

### Requirement: The visible task estimate covers travel to the stop as well as the interaction
The platform SHALL provide a pure function that derives a task's visible estimated minutes as the
sum of that task's interaction duration and a transit allowance for reaching it.

The interaction half SHALL be the already-defined per-interaction duration for that task, and SHALL
NOT be restated by this function.

The derived value SHALL be a finite whole number of at least 1 minute and at most 60 minutes for
every possible input, including a `null` task, a task with no coordinates, a task with non-finite or
out-of-range coordinates, and a sibling list that is absent or not an array. The function SHALL
never return `NaN`, zero or a negative number.

#### Scenario: Every interaction type derives a usable estimate
- **WHEN** the estimate is derived for a `geofence`, `field`, `self_report`, `numeric`, `photo`,
  `smart_station`, `quiz`, `survey` and `sequence` task
- **THEN** each returns a finite whole number between 1 and 60 minutes
- **AND** each result is at least the interaction duration derived for that same task

#### Scenario: A malformed task still yields a safe number
- **WHEN** the estimate is derived for a `null` task, a task with an unknown type, and a task whose
  sibling list is not an array
- **THEN** a finite whole number between 1 and 60 minutes is returned in every case

### Requirement: The transit allowance is the median leg within the stage, and is zero for a locationless task
The transit allowance SHALL be derived from the same walking model the routing engine uses, namely
great-circle distance at 12 minutes per kilometre.

A task that is locationless SHALL receive a transit allowance of exactly zero.

A task whose own coordinates are unusable, and a task for which no other task in its stage has
usable coordinates, SHALL each receive the same constant allowance the routing engine applies when
coordinates are unavailable. Coordinates SHALL be treated as unusable when they are absent,
non-finite, outside valid latitude or longitude range, or on the builder's unplaced `0,0` sentinel.

Otherwise the allowance SHALL be the median walking time from this task to the other tasks of its
stage that have usable coordinates, clamped to a minimum and a maximum allowance.

#### Scenario: A locationless task is charged no travel
- **WHEN** the estimate is derived for a locationless task that has distant siblings
- **THEN** the transit allowance is zero
- **AND** the estimate equals the task's interaction duration rounded to a whole minute

#### Scenario: An unplaced task is charged the unknown-leg constant
- **WHEN** the estimate is derived for a located task sitting on the `0,0` sentinel, and for a
  located task whose coordinates are non-finite or out of range
- **THEN** each is charged the unknown-leg constant rather than throwing or yielding zero

#### Scenario: A single-stop stage is charged the unknown-leg constant
- **WHEN** the estimate is derived for a placed task whose stage contains no other placed task
- **THEN** the transit allowance is the unknown-leg constant, not zero

#### Scenario: The median leg is used, not the mean
- **WHEN** a placed task has three placed siblings at roughly 100 m, 120 m and 4 km
- **THEN** the transit allowance is derived from the 120 m leg
- **AND** the single distant sibling does not raise the allowance

#### Scenario: A far-flung stage is clamped
- **WHEN** every sibling of a placed task is many kilometres away
- **THEN** the transit allowance is the maximum allowance, and the estimate stays at or below 60
  minutes

### Requirement: An authored estimate always wins over the derived default
An explicit `estimatedMinutes` SHALL be used whenever it is a finite number greater than zero, and
the derived default SHALL only fill the gap when no usable authored value is present.

An authored value that is not finite, is zero, or is negative SHALL NOT be used; the derived default
SHALL apply instead. An authored value that is finite but larger than the maximum SHALL be clamped
to the maximum.

#### Scenario: An explicit value wins
- **WHEN** a task declares an estimate of 22 minutes
- **THEN** the effective estimate is 22 minutes, not the derived default

#### Scenario: A malformed explicit value falls back
- **WHEN** a task declares an estimate of `NaN`, `Infinity`, zero or a negative number
- **THEN** the effective estimate is the derived default for that task, finite and positive

### Requirement: No stored game, in-flight run or finalised run is re-scored
Deriving a default estimate SHALL NOT write to any stored game, run, team or leaderboard document,
and SHALL NOT be invoked by any scoring, ranking or routing path.

The default SHALL reach stored data only at authoring time: when a brand new task is created, and
when a creator explicitly applies the suggestion in the task editor.

#### Scenario: Scoring keeps reading the authored field
- **WHEN** a team completes a task in a run under any scoring preset
- **THEN** the score is computed from the task's authored `estimatedMinutes` exactly as before
- **AND** no derived default is consulted

#### Scenario: An existing game is untouched
- **WHEN** a game saved before this change is opened, listed, launched or finalised
- **THEN** none of its tasks' `estimatedMinutes` values change

### Requirement: The task editor surfaces the derived estimate with a one-tap apply and an override
The creator's task editor SHALL display the derived estimate for the task as currently authored,
SHALL offer to apply it in a single action when it differs from the task's current estimate, and
SHALL keep an explicit numeric override.

The suggestion SHALL never be applied on its own, so a creator who typed their own number keeps it.
All copy SHALL be available in both Hebrew and English through the shared dictionary.

#### Scenario: The suggestion is offered and applied by the creator
- **WHEN** a creator opens a task whose estimate differs from the derived estimate
- **THEN** the derived estimate is shown with a control that applies it
- **AND** nothing is written until the creator activates that control

#### Scenario: The suggestion follows the task as it is authored
- **WHEN** a creator changes the task's interaction type or drops its map pin
- **THEN** the displayed derived estimate is recomputed from the task's new state
