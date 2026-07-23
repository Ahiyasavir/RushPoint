## ADDED Requirements

### Requirement: Every writer of a public task applies the published-location rule

Every code path that writes a public task document SHALL derive that document's location with the
shared published-location rule — including seed and fixture scripts, not only the publish callable
— and SHALL write no exact authored coordinate into the world-readable public task collection.

A public task written by a seed path SHALL therefore be indistinguishable in location shape from
one written by publishing a game: a coarse published area when the authored task is placed and its
location is not hidden, and no location field at all otherwise.

#### Scenario: Seeded placed mission

- **WHEN** a seed path writes a public task for an authored mission that is placed and does not
  hide its location
- **THEN** the document carries a coarse published area derived by the shared rule
- **AND** the document carries no exact authored coordinate

#### Scenario: Seeded hidden, locationless or unplaced mission

- **WHEN** a seed path writes a public task for an authored mission that hides its location, is
  locationless, or is not placed
- **THEN** the document carries no location field of any kind

#### Scenario: A hand-rolled public-task write is rejected

- **WHEN** a public-task write is introduced that sets an exact coordinate instead of deriving the
  published area from the shared rule
- **THEN** the pure-logic test lane fails
