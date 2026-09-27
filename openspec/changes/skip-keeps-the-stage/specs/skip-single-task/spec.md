## ADDED Requirements

### Requirement: An operator's single-mission skip keeps the missions that depend on it
When an organizer or run-scoped staff member skips ONE mission for ONE team, that mission SHALL count
as satisfied for the unlock conditions of the other missions in the same stage, for that team only.
The skip SHALL NOT retire those dependent missions and SHALL NOT, by itself, end the stage while a
dependent mission remains playable.

Every skipped task record SHALL carry the cause of the skip. Only an operator's single-mission skip
SHALL satisfy an unlock condition. A mission lost to an exclusive-group choice, closed by expiry,
auto-skipped or retired SHALL keep its current meaning for its dependents. A skipped record with no
recorded cause SHALL be treated as not satisfying.

#### Scenario: Skipping the head of a chain keeps the stage
- **GIVEN** a stage of three missions A, B (unlocks after A) and C (unlocks after A and B)
- **AND** a team holding A
- **WHEN** an organizer skips A for that team
- **THEN** A is recorded as skipped by an operator
- **AND** the team's stage is still active
- **AND** B can be assigned to the team next

#### Scenario: An exclusive-group loss still closes its dependents
- **GIVEN** a stage where A1 and A2 are alternatives and B unlocks after A1
- **WHEN** the team completes A2
- **THEN** A1 is skipped with the exclusive cause
- **AND** B is retired as unreachable, as before

### Requirement: The skip confirmation states its consequence
The single-mission skip operation SHALL accept a dry-run flag that returns what the skip would do
(which mission is skipped, which missions it opens, whether the stage would end, whether the stage
requirement is lowered) without writing anything. Both operator consoles SHALL show that
consequence in the confirmation before the skip is applied, and SHALL fall back to a generic
confirmation when the preview cannot be obtained.

#### Scenario: The dry run writes nothing
- **WHEN** an organizer requests a dry-run skip for a team
- **THEN** the team document is unchanged
- **AND** no audit record is written
