## ADDED Requirements

### Requirement: A sealed hidden mission is shown on the participant map as a search area

A hidden-location task that the server has not yet unsealed SHALL carry, in its participant-facing
payload, a coarse search area consisting of a centre coordinate and a radius in metres, and the
participant map SHALL draw that area as a region rather than as a point.

The search area SHALL be derived server-side from the task's real coordinate and SHALL be guaranteed
to contain that coordinate: the distance from the area's centre to the real coordinate SHALL never
exceed the area's radius, at any latitude.

The area's centre SHALL NOT equal the task's real coordinate, and SHALL be a pure function of that
coordinate, so that repeated reads of the same task always return the identical area and no number
of observations narrows it.

Two distinct real coordinates that fall in the same coarsening cell SHALL produce the identical
search area, so the area cannot be inverted to a point.

#### Scenario: A sealed hidden mission is served to a player

- **WHEN** the participant payload is built for a placed hidden-location task whose arrival the
  server has not confirmed
- **THEN** the payload contains a search area with a finite centre and a positive radius
- **AND** the centre differs from the task's authored coordinate on at least one axis
- **AND** the distance from the centre to the authored coordinate is at most the radius

#### Scenario: The area cannot be sharpened by repeated reads

- **WHEN** the participant payload for the same sealed hidden task is built many times
- **THEN** every payload carries the identical search area centre and radius

#### Scenario: Two nearby hidden spots share one area

- **WHEN** two hidden tasks are placed at distinct coordinates that fall inside the same coarsening
  cell
- **THEN** both derive the identical search area

#### Scenario: A hidden mission with no usable location

- **WHEN** the participant payload is built for a hidden-location task that is locationless, or whose
  coordinates are absent, non-finite, out of range or the null-island placeholder
- **THEN** the payload carries no search area
- **AND** the map behaves exactly as it did before this capability existed

### Requirement: The search area does not weaken the seal

Shipping a search area SHALL NOT change anything else about a sealed hidden-location task.

The sealed participant payload SHALL continue to withhold the exact coordinates, the geofence radius,
any station coordinates, the whole station configuration object, the title, the type and every answer
key, and SHALL continue to be built from an explicit allowlist so that a task field added later
defaults to withheld.

Arrival SHALL continue to be decided solely by the server's own verdict on the team's reported GPS.
Being inside the search area SHALL NOT unseal the task.

A refusal to check in at a hidden-location task SHALL continue to carry no distance figure.

Once the server has confirmed arrival, the payload SHALL carry the real coordinates and SHALL NOT
carry a search area, so the map never shows two contradictory answers for one mission.

A task that is not hidden SHALL never carry a search area.

#### Scenario: Everything else stays sealed

- **WHEN** the participant payload for a sealed hidden-location task is inspected
- **THEN** it has no exact coordinates, no geofence radius, no station configuration, no title and no
  type
- **AND** it carries only the identifier, the sealed-state flags, the clue, the paid-hint affordance,
  the non-revealing card chrome and the search area

#### Scenario: A revealed hidden mission

- **WHEN** the server has confirmed the team's arrival at a hidden-location task
- **THEN** the payload carries the real coordinates
- **AND** it carries no search area

#### Scenario: An ordinary task is unaffected

- **WHEN** the participant payload is built for a task that is not hidden
- **THEN** it carries no search area and is otherwise unchanged

### Requirement: The participant map renders only well-formed search areas

The participant map SHALL derive the circles it draws from the served payload through a single pure
selector that is total: it SHALL return an empty list rather than throwing for a missing list, a
non-list, null entries, or entries of any shape.

A search area SHALL be drawn only when it belongs to a task the server has flagged as still sealed,
its centre is a valid coordinate that is not the null-island placeholder, and its radius is finite
and positive. A radius outside the supported display range SHALL be clamped rather than drawn as
given, and a malformed radius SHALL cause the area to be dropped rather than drawn.

Areas SHALL be de-duplicated by task identifier and SHALL preserve the served order, so the map does
not churn between polls.

The drawn area SHALL be visually distinct from a task pin, and the map SHALL remain present whenever
at least one search area is drawable.

#### Scenario: A malformed payload does not break the map

- **WHEN** the selector is given a missing list, a non-list, or a list containing null, numeric and
  string entries
- **THEN** it returns an empty list and does not throw

#### Scenario: Only sealed missions contribute a circle

- **WHEN** the served list contains one sealed task carrying a valid area and one revealed task
  carrying an area
- **THEN** exactly one circle is produced, for the sealed task

#### Scenario: Unusable areas are dropped and extreme radii are clamped

- **WHEN** the served areas include an out-of-range centre, a null-island centre, a non-finite
  radius, a zero radius and a negative radius
- **THEN** none of them produces a circle
- **AND** an implausibly large radius is clamped to the maximum supported display radius
