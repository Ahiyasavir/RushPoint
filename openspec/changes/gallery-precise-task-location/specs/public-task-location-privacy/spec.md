## MODIFIED Requirements

### Requirement: The public task library publishes an approximate area, never an exact point

An ordinary usably-placed task SHALL publish its EXACT authored coordinate as its `approxLocation` in
the world-readable public task library. The gallery and mission-library maps exist so a creator can
see and copy where another creator placed a task — an authored point of interest, not a person's
location — so the published pin SHALL be precise.

A `hideLocation` task is the ONE exception: its spot is a deliberate puzzle withheld from players, and
the public document is world-readable, so it SHALL publish a coarsened `approxLocation` (the centre of
the documented ~1 km grid cell) and SHALL NOT publish its exact point.

The deprecated exact `coordinates` field SHALL NOT be written for any task. A `locationless` task, and
a task whose coordinates are absent, non-finite, out of range or the null-island placeholder `(0, 0)`,
SHALL publish no `approxLocation` and no `coordinates`, whether hidden or not.

#### Scenario: Publishing an ordinary placed task

- **WHEN** a creator publishes a game whose stage contains an ordinary (non-hidden) task at valid
  coordinates
- **THEN** the task's `publicTasks` document has an `approxLocation` equal to the authored coordinate
- **AND** the document has no `coordinates` field

#### Scenario: Publishing a hidden-location task

- **WHEN** a creator publishes a game whose stage contains a `hideLocation` task at valid coordinates
- **THEN** the task's `publicTasks` document has an `approxLocation` that differs from the authored
  coordinate and lies within the coarsening cell's half-width of it
- **AND** the document has no `coordinates` field

#### Scenario: Re-publishing is deterministic for both

- **WHEN** a game is published repeatedly without its coordinates changing
- **THEN** every publish writes the identical `approxLocation` for each task, exact for ordinary tasks
  and coarse for hidden ones

### Requirement: A hidden-location task publishes an area like any other task

A task with `hideLocation` set SHALL have a coarsened `approxLocation` published into the public task
library — the documented ~1 km cell rule, with the same determinism, which the writer now applies to a
hidden task ALONE, since every ordinary task publishes its exact point. This keeps a creator's own
hidden-location missions visible on the creator-facing library and gallery maps without disclosing the
exact point that is the puzzle's answer.

Publishing an area SHALL NOT change what a participant receives. The participant-facing task payload
SHALL continue to withhold a hidden-location task's exact coordinates, its geofence radius and any
station coordinates, and SHALL continue to seal the task until the server has confirmed the team's
arrival. The published area SHALL NOT be forwarded to a participant in place of the withheld
coordinate.

#### Scenario: A hidden-location task's published area is genuinely coarse

- **WHEN** a `hideLocation` task at valid coordinates is published
- **THEN** its `publicTasks` `approxLocation` is not equal to the authored coordinate
- **AND** it lies within the coarsening cell's half-width of the authored coordinate

#### Scenario: A participant is served a hidden-location task

- **WHEN** the participant-facing payload for a `hideLocation` task is built, whether before or after
  the server has confirmed arrival
- **THEN** it contains no exact coordinates, no geofence radius, no station coordinates and no
  published area
- **AND** before arrival is confirmed it contains only the sealed stub

### Requirement: A published task with no area is repaired to have one

The maintenance sweep that repairs `publicTasks` documents SHALL, for an ordinary task, write the EXACT
authored point, and for a `hideLocation` task, write the coarse ~1 km cell. It SHALL repair a document
that still carries a deprecated exact `coordinates` field, and a document that carries no usable
published area when the authored task can supply one. A document whose stored area is absent,
non-finite, out of range or the null-island placeholder SHALL be treated as having no usable area.

The sweep SHALL remain idempotent: a document already carrying the correct location, and a document
whose authored task can supply none, SHALL be left untouched and SHALL NOT be counted as repaired. When
the authored task cannot be resolved, the sweep SHALL NOT invent a location; it SHALL strip any
deprecated exact coordinate and publish no area.

#### Scenario: Repairing an ordinary legacy document

- **WHEN** the sweep runs over a `publicTasks` document that carries a deprecated `coordinates` field,
  whose authored task is a placed ordinary task
- **THEN** the deprecated field is deleted and `approxLocation` is set to the exact authored point

#### Scenario: Repairing a hidden legacy document

- **WHEN** the sweep runs over such a document whose authored task is a placed `hideLocation` task
- **THEN** the deprecated field is deleted and `approxLocation` is set to the coarse ~1 km cell, never
  the exact point

#### Scenario: The sweep is run twice

- **WHEN** the sweep is run a second time immediately after a complete first pass
- **THEN** it reports no documents repaired
