## MODIFIED Requirements

### Requirement: A hidden-location task publishes an area like any other task

A task with `hideLocation` set SHALL have a coarsened `approxLocation` published into the public task
library on exactly the same terms as any other task, so a creator's own hidden-location missions are
visible on the creator-facing library and gallery maps.

The exact authored coordinate of a hidden-location task SHALL NOT be written into any
world-readable document, and the coarsening SHALL be the same documented ~1 km cell rule, with the
same determinism, that applies to every other published task.

Publishing an area SHALL NOT change what a participant receives. The participant-facing task payload
SHALL continue to withhold a hidden-location task's exact coordinates, its geofence radius and any
station coordinates, and SHALL continue to seal the task until the server has confirmed the team's
arrival. The published area SHALL NOT be forwarded to a participant in place of the withheld
coordinate.

#### Scenario: Publishing a game containing a hidden-location task

- **WHEN** a creator publishes a game whose stage contains a `hideLocation` task at valid coordinates
- **THEN** the task's `publicTasks` document has an `approxLocation` whose latitude and longitude each
  differ from the authored value by at most the coarsening cell's half-width
- **AND** the document has no `coordinates` field
- **AND** the task is still present in the library with its title, type, difficulty and points

#### Scenario: A hidden-location task with no usable coordinates

- **WHEN** a creator publishes a `hideLocation` task that is `locationless`, or whose coordinates are
  absent, non-finite, out of range, or the null-island placeholder `(0, 0)`
- **THEN** the resulting `publicTasks` document carries no `approxLocation` and no `coordinates`

#### Scenario: Re-publishing a hidden-location task does not narrow its area

- **WHEN** a game containing a `hideLocation` task is published repeatedly without its coordinates
  changing
- **THEN** every publish writes the identical `approxLocation`

#### Scenario: A participant is served a hidden-location task

- **WHEN** the participant-facing payload for a `hideLocation` task is built, whether before or after
  the server has confirmed arrival is required
- **THEN** it contains no exact coordinates, no geofence radius, no station coordinates and no
  published area
- **AND** before arrival is confirmed it contains only the sealed stub: the identifier, the location
  clue, the paid-hint affordance and non-revealing card chrome

### Requirement: A published task with no area is repaired to have one

The maintenance sweep that repairs `publicTasks` documents SHALL repair a document that carries no
usable published area when the authored task it came from can supply one, in addition to repairing a
document that still carries a deprecated exact coordinate. A document whose stored area is absent,
non-finite, out of range or the null-island placeholder SHALL be treated as having no usable area.

The sweep SHALL remain idempotent: a document that already carries a usable area, and a document
whose authored task can supply none, SHALL be left untouched and SHALL NOT be counted as repaired.

When the authored task cannot be resolved, the sweep SHALL NOT invent a location; it SHALL strip any
deprecated exact coordinate and publish no area.

#### Scenario: A hidden-location task published under the previous rule

- **WHEN** the sweep runs over a `publicTasks` document that has neither a deprecated `coordinates`
  field nor an `approxLocation`, and whose authored task is a placed `hideLocation` task
- **THEN** the document is repaired to carry the coarsened area for that task

#### Scenario: A document that legitimately has no location

- **WHEN** the sweep runs over a document with no area whose authored task is locationless or unplaced
- **THEN** the document is left untouched and is not counted as repaired

#### Scenario: The sweep is run twice

- **WHEN** the sweep is run a second time immediately after a complete first pass
- **THEN** it reports no documents repaired
