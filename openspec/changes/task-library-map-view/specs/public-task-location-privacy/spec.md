## ADDED Requirements

### Requirement: The public task library publishes an approximate area, never an exact point

The `publicTasks` projection SHALL NOT carry the authored `Task.coordinates` of any task. Where a
task's location is published at all, it SHALL be published as an `approxLocation` derived from the
authored coordinate by a documented coarsening whose output identifies a geographic cell of roughly
one kilometre, not a point.

The coarsening SHALL be a pure function of the input coordinate alone. It SHALL NOT consult a clock,
a random source, or any per-publish state.

#### Scenario: Publishing an ordinary located task

- **WHEN** a creator publishes a game containing a task with valid coordinates and `hideLocation`
  unset
- **THEN** the resulting `publicTasks` document has an `approxLocation` whose latitude and longitude
  each differ from the authored value by at most the coarsening cell's half-width
- **AND** the document has no `coordinates` field

#### Scenario: Re-publishing does not narrow the area

- **WHEN** the same game is published repeatedly without the task's coordinates changing
- **THEN** every publish writes the identical `approxLocation`
- **AND** an observer collecting the results of every publish cannot average them toward a value
  closer to the authored coordinate than a single observation already was

#### Scenario: Publishing a task with no usable coordinates

- **WHEN** a creator publishes a game containing a task whose coordinates are absent, non-finite,
  out of range, or the null-island placeholder `(0, 0)`
- **THEN** the resulting `publicTasks` document carries no `approxLocation` and no `coordinates`
- **AND** publishing succeeds — an unplaceable task is still listed in the library, just without a
  location

### Requirement: A hidden-location task publishes no location

A task with `hideLocation` set SHALL have neither its exact coordinate nor any coarsened derivative
written into the public task library. The exclusion SHALL be applied where the public document is
written, so that no world-readable document ever contains the value. A renderer-side or
client-side filter SHALL NOT be relied upon as the control.

#### Scenario: Publishing a game containing a hidden-location task

- **WHEN** a creator publishes a game whose stage contains a `hideLocation` task at valid coordinates
- **THEN** the task's `publicTasks` document contains no `approxLocation` and no `coordinates`
- **AND** the task is still present in the library with its title, type, difficulty and points

#### Scenario: A task becomes hidden after it was published

- **WHEN** a creator edits an already-published task to set `hideLocation`, then re-publishes
- **THEN** the rewritten `publicTasks` document no longer carries any location field

### Requirement: The library search response never returns an exact task coordinate

`searchTaskLibrary` SHALL NOT return a `coordinates` field on any task, including tasks whose stored
document still carries one from before this contract existed.

#### Scenario: A legacy document is returned by search

- **WHEN** `searchTaskLibrary` returns a task whose stored document still has a `coordinates` field
  written by an earlier version of the publish path
- **THEN** the returned task object has no `coordinates` field

### Requirement: Copying a library task transfers only the approximate area

Inserting a public task into a game under construction SHALL seed the new task from the public
document's `approxLocation` when present, and SHALL leave the new task unplaced when it is absent.
It SHALL NOT be possible to recover an authored coordinate by copying a task.

#### Scenario: Copying a located library task

- **WHEN** a creator inserts a public task that carries an `approxLocation` into their game
- **THEN** the created task's coordinates are that approximate area
- **AND** the task is subject to the Builder's normal placement rules, so the creator can move the
  pin to the real spot they intend

#### Scenario: Copying a hidden-location or unplaced library task

- **WHEN** a creator inserts a public task that carries no location
- **THEN** the created task is unplaced and the Builder treats it as a task still needing placement
