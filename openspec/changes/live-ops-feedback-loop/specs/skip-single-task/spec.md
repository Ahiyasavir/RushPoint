## ADDED Requirements

### Requirement: Skipping one mission pays the same consolation as skipping a stage

A mission skipped for one team by an organizer or run-scoped staff member SHALL earn
the scoring preset's skip consolation — the same value `skipStage` pays for a task it
removes — rather than zero.

This SHALL be resolved from the game's scoring preset and the mission's own template
task at the moment of the skip, and SHALL be stamped onto the team's task record. A
mission that cannot be resolved in the template SHALL earn zero rather than failing
the skip.

Runs that have already finished SHALL NOT move, and runs in flight SHALL keep whatever
their already-skipped missions were stamped with: the earned value is stored per
record and rankings are summed from stored records, never re-derived.

#### Scenario: A skipped mission earns the on-target value under smart weighting

- **WHEN** a mission is skipped for a team in a `smart_weighted` game
- **THEN** its record earns the on-target sigmoid score for that mission
- **AND** the team's total moves by exactly that amount

#### Scenario: A time-ranked game awards nothing

- **WHEN** a mission is skipped in a `time_only` game
- **THEN** its record earns zero, because that preset has no points to award

#### Scenario: A points game awards the mission's point value

- **WHEN** a mission is skipped in a `fixed_points_speed` game
- **THEN** its record earns that mission's point value

#### Scenario: A finished run is unaffected

- **WHEN** this change is deployed
- **THEN** every mission skipped before it keeps the value it was stamped with
