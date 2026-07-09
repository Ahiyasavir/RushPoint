# safe-zone Specification

## Purpose
TBD - created by archiving change safe-zone-boundary. Update Purpose after archive.
## Requirements
### Requirement: Organizer defines a safe-zone boundary
A creator SHALL be able to define a safe zone (center + radius) for a game/run. When no safe zone is
configured, behavior is unchanged.

#### Scenario: Safe zone is configured on the game
- **WHEN** the creator sets a safe-zone center and radius in the Builder
- **THEN** the run carries the safe-zone configuration

### Requirement: Breaches are detected server-side and auto-alert the organizer
The location-update path SHALL compute breaches with `isOutsideSafeZone` server-side. On a new breach
it MUST raise an alert to the organizer (reusing the existing alert surface) and set the team's
`outOfBounds` flag; on return inside, the flag MUST be cleared.

#### Scenario: Out-of-zone location raises an alert
- **WHEN** a team reports a location outside the safe zone for the first time
- **THEN** an alert is created for the organizer and the team is flagged out-of-bounds

#### Scenario: Returning inside clears the flag
- **WHEN** the team reports a location back inside the safe zone
- **THEN** the out-of-bounds flag is cleared

#### Scenario: Breach predicate boundary behavior
- **WHEN** `isOutsideSafeZone` is given coords exactly on the radius
- **THEN** it returns false (on-boundary is inside)
- **WHEN** given coords beyond the radius
- **THEN** it returns true

### Requirement: An out-of-bounds team is soft-paused and warned
While a team is out of bounds, the participant app SHALL show a "head back to the play area" warning
and the system MUST NOT assign new tasks until the team returns inside.

#### Scenario: No new task while out of bounds
- **WHEN** a team is flagged out-of-bounds
- **THEN** the participant sees the warning and no new task is assigned until they return inside

