## ADDED Requirements

### Requirement: A team knows how many of its people are still not connected

The platform SHALL compare the number of people a team declared against the number of
devices actually attached to it, and SHALL make that difference visible to the team and
to the organizer.

The comparison SHALL be total and SHALL never invent a shortfall: a team that declared no
headcount, or whose headcount cannot be read, SHALL be reported as having no known gap
rather than as fully attached or as entirely missing.

#### Scenario: A team sharing one phone is visible as such

- **WHEN** a team of six has one device attached
- **THEN** the team is reported as having five people not yet connected

#### Scenario: A fully attached team reports no gap

- **WHEN** every declared member has a device attached
- **THEN** no shortfall is reported

#### Scenario: More devices than declared members is not a shortfall

- **WHEN** more devices are attached than the team declared members
- **THEN** no shortfall is reported and nothing is treated as an error

#### Scenario: An unknown headcount is not a shortfall

- **WHEN** a team declared no member count, or it cannot be read
- **THEN** the shortfall is reported as unknown rather than as a number

### Requirement: A game may require every member on their own device

A game SHALL offer a setting, off by default, requiring that every declared member of a
team has a device attached before that team plays.

Where the setting is off, or the team's headcount is unknown, the requirement SHALL NOT
apply. A team SHALL never be blocked on the basis of a headcount the platform cannot
read.

#### Scenario: Off by default

- **WHEN** a game has never set the option
- **THEN** teams play exactly as they do today

#### Scenario: A short team is held when the game requires it

- **WHEN** the option is on and a team has fewer devices than declared members
- **THEN** the team is held, and told how many people are still missing

#### Scenario: An unknown headcount never blocks

- **WHEN** the option is on and the team's headcount cannot be read
- **THEN** the team is not held

### Requirement: A mission may require several people to act

A mission SHALL be able to require that a number of distinct devices each contribute to
it before it can be completed.

A contribution SHALL be recorded against the device that made it, and the same device
contributing twice SHALL count once. The requirement SHALL be satisfied by distinct
devices only.

Where a mission requires more contributors than the team has devices attached, the
requirement SHALL fall back to what the team can actually achieve rather than making the
mission impossible.

#### Scenario: A mission requiring three contributors waits for three devices

- **WHEN** a mission requires three contributors and two distinct devices have contributed
- **THEN** the mission cannot yet be completed

#### Scenario: The same device cannot contribute twice

- **WHEN** one device contributes twice to the same mission
- **THEN** it counts as one contributor

#### Scenario: A requirement larger than the team is reduced

- **WHEN** a mission requires four contributors and the team has two devices attached
- **THEN** the requirement is treated as two

#### Scenario: A mission with no requirement is unaffected

- **WHEN** a mission declares no contributor requirement
- **THEN** it completes exactly as it does today, with no contribution needed
