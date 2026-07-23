## ADDED Requirements

### Requirement: A published game carries a map area

When a game is published, or when a published game is edited, the system SHALL write a coarse map
area onto its world-readable gallery entry so that the game can be plotted on the gallery map
without the creator having to author a coordinate.

An area authored on the game SHALL take precedence and be written unchanged, including its label.
When no usable area is authored, the system SHALL derive one from the game's own tasks.

#### Scenario: Derived area on publish

- **WHEN** a game with at least one publicly locatable task is published and has no authored area
- **THEN** its gallery entry carries a derived area and the game appears on the gallery map

#### Scenario: Authored area wins

- **WHEN** a game with an authored area is published
- **THEN** its gallery entry carries the authored area, including its label

#### Scenario: Area follows edits

- **WHEN** a published game's tasks are moved and the game is saved
- **THEN** its gallery entry's derived area is recomputed from the tasks as saved

### Requirement: A derived game area discloses no more than the task library

A derived game area SHALL be computed only from tasks that are themselves allowed to publish a
location, using the same rule the public task library uses. A task that hides its location, a task
with no location, and a task that has not been placed SHALL contribute nothing.

A derived game area SHALL be coarsened to the same public location grid as a published task area,
and SHALL be a deterministic function of its inputs, so that repeated publishes of the same game
yield the identical value and cannot be averaged into a finer point.

When no task of the game may publish a location, the system SHALL write no area at all rather than a
placeholder or a partially derived point.

#### Scenario: Hidden-location tasks contribute nothing

- **WHEN** a game's only located tasks hide their locations
- **THEN** no area is derived and the gallery entry carries no area

#### Scenario: A mixed game derives from its visible tasks only

- **WHEN** a game has one visible located task and several hidden-location tasks
- **THEN** the derived area is the coarsened area of the visible task alone

#### Scenario: Unplaced tasks contribute nothing

- **WHEN** a game's tasks are unplaced or carry out-of-range coordinates
- **THEN** those tasks are excluded from the derivation

#### Scenario: Repeated publishing is not a leak

- **WHEN** the same game is published repeatedly with unchanged tasks
- **THEN** every publish writes the identical area
