## ADDED Requirements

### Requirement: A placed composed game asks for at most one invented pin per stage

The composer SHALL site at most one play-anywhere mission per stage of a placed game,
and SHALL site none in a stage that already holds a mission sited by nature. Every
other play-anywhere mission SHALL stay playable from anywhere and SHALL NOT produce a
location setup step.

#### Scenario: A stage of four play-anywhere missions
- **WHEN** a placed game's stage holds four missions that can be played anywhere
- **THEN** exactly one of them is given a pin and a location setup step

#### Scenario: A stage that already has a located mission
- **WHEN** a stage holds a mission that is tied to a place by nature
- **THEN** no play-anywhere mission in that stage is given a pin

### Requirement: A mission that gains nothing from a place is never sited

The composer SHALL NOT site a bank mission whose `siting` is `never`, and SHALL prefer,
among the possible anchors of a stage, one that declares a spot kind.

#### Scenario: A conversation mission
- **WHEN** the only play-anywhere missions in a stage are marked `never`
- **THEN** the stage invents no pin

### Requirement: The prep question shows what it costs

The questionnaire SHALL show, beside the prep answer, how many points the creator will
place on the map and roughly how long it takes, derived from the planned stage count,
whenever the answer asks for placed missions.

#### Scenario: Prep level 2
- **WHEN** the creator chooses "just locations" and the plan has four stages
- **THEN** the line reads that they will place about 4 points

### Requirement: The pin count drops to about one per stage

The composer SHALL ask, over its answer space at prep level 2, for a mean of at most 5
location setup steps per game.

#### Scenario: Measured over the answer space
- **WHEN** the composer runs over a fixed sample of answers at prep level 2
- **THEN** the mean number of location steps per game is at most 5
