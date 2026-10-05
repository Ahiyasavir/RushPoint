## REMOVED Requirements

### Requirement: A placed composed game asks for at most one invented pin per stage
**Reason**: Ahiya (2026-10-04): choosing a location level on the prep scale is choosing to place locations.
**Migration**: Replaced by "A placed game asks for a pin for every mission a place can help".

### Requirement: The pin count drops to about one per stage
**Reason**: Follows from the removal above.
**Migration**: None; the cost line shows the real count instead.

## ADDED Requirements

### Requirement: A placed game asks for a pin for every mission a place can help

When the creator's prep answer asks for placed missions (level 2 and up), the composer SHALL give
every play-anywhere mission whose siting is `possible` a pin and a location setup step. At prep
level 1 it SHALL give none.

#### Scenario: A stage of four play-anywhere riddles at prep level 2
- **WHEN** a placed game's stage holds four riddles that can be played anywhere
- **THEN** all four are given a pin and a location setup step

#### Scenario: Prep level 1
- **WHEN** the creator chooses "בלי כלום"
- **THEN** no mission is given a pin

### Requirement: Riddles and trivia can be placed

Riddle and trivia missions SHALL have siting `possible`. Conversations, team agreements, personal
and household missions SHALL keep siting `never`.

#### Scenario: A trivia question in a walking race
- **WHEN** a placed game draws a trivia question
- **THEN** it is given a pin like any other play-anywhere mission

## MODIFIED Requirements

### Requirement: The prep question shows what it costs

The questionnaire SHALL show, beside the prep answer, how many points the creator will place on
the map and roughly how long it takes, derived from the planned missions a place can help,
whenever the answer asks for placed missions.

#### Scenario: Prep level 2
- **WHEN** the creator chooses "רק מיקומים" and the plan holds nine missions a place can help
- **THEN** the line reads that they will place about 9 points
