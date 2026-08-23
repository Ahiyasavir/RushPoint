## ADDED Requirements

### Requirement: The mission library serves each mission's location from stored coordinates at read time
`searchTaskLibrary` SHALL resolve every returned mission's public location on each read, using the
same shared rule the publish path uses, so that a mission published before the location contract
existed plots at its true spot with no re-publish and no data migration.

A mission document that carries an exact authored coordinate but no published area SHALL be served a
published area computed from that coordinate. A mission document that already carries a published
area and no coordinate SHALL be served that stored area unchanged. In every case the deprecated
exact coordinate field SHALL be dropped from the served payload.

#### Scenario: A legacy coordinate-only mission becomes plottable
- **WHEN** the library serves a mission whose only stored location is an exact coordinate and which
  has no published area
- **THEN** the served mission carries a published area equal to that exact authored point
- **AND** the served mission does not carry the deprecated exact coordinate field

#### Scenario: An ordinary mission is served its exact point, not a coarse area
- **WHEN** the library serves an ordinary (non-hidden) mission that stores an exact coordinate
- **THEN** the served published area is the exact authored point, not the coarse ~1 km area

#### Scenario: A new-style mission is served its stored area unchanged
- **WHEN** the library serves a mission that already stores a published area and no exact coordinate
- **THEN** the served published area equals the stored area

#### Scenario: A locationless mission is served no area
- **WHEN** the library serves a mission that is locationless
- **THEN** the served mission carries no published area

### Requirement: A hidden-location mission is never served its exact point
A mission the author marked hidden-location SHALL be served only the coarse ~1 km area, never its
exact authored point, so that a world-readable read of the library cannot hand a player the answer
to a hidden-location puzzle.

#### Scenario: A hidden-location mission is coarsened at read time
- **WHEN** the library serves a mission whose document is flagged hidden-location and carries an
  exact coordinate
- **THEN** the served published area is the coarse ~1 km area, not the exact point

### Requirement: The read-path resolution is a total pure function
Resolving one mission's served location SHALL be a pure function of the stored document that never
throws for any input, so the library search can never fail on a sparse or malformed document.

#### Scenario: A mission with neither a coordinate nor an area does not throw
- **WHEN** the library serves a mission that stores neither an exact coordinate nor a published area
- **THEN** the resolution does not throw
- **AND** the served mission carries no published area
