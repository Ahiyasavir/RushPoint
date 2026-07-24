## ADDED Requirements

### Requirement: Participant share cards render in the player's language

The branded story and podium share cards SHALL render their labels in the player's current language
(Hebrew or English). The story card's headline, score/hero label, chip labels (rank, time, stages),
and CTA tagline, and the podium card's title, SHALL be supplied as localized strings by the caller.

Each card field SHALL default to its current English literal when the caller omits it, so an omitted
override never regresses an existing card. The brand stamp (logo, human URL, scannable QR) and the
native-share → download → clipboard fallback ladder SHALL be unchanged. English cards for English
players SHALL be identical to today.

The localized label set SHALL be produced by a single pure function of the language dictionary and the
scoring preset, with no hardcoded per-language branching in the callers.

#### Scenario: A Hebrew player shares a Hebrew image

- **WHEN** a player whose app language is Hebrew shares their story or podium card
- **THEN** the card's headline, labels, CTA tagline and podium title are rendered in Hebrew
- **AND** the brand stamp and share fallback ladder are unchanged

#### Scenario: An English player's card is unchanged

- **WHEN** a player whose app language is English shares their card
- **THEN** the card is identical to the prior English-only rendering

### Requirement: The story card hero matches the scoring preset

For a `time_only` game the story card's hero value SHALL be the finish TIME with a time-style
(localized) label, not the points integer labeled with the points label. For a points-based preset the
card SHALL keep the points value as the hero with the points label.

The preset-to-label decision SHALL live in the single pure label helper (not duplicated in callers).

#### Scenario: A time_only result shares as a time, not points

- **WHEN** a player finishes a `time_only` game and shares the story card
- **THEN** the card's hero is the finish time with a localized TIME-style label
- **AND** the card does NOT show the completion-bonus integer labeled as points

#### Scenario: A points-based result shares as points

- **WHEN** a player finishes a points-based game and shares the story card
- **THEN** the card's hero is the points total with the localized points label

### Requirement: Share-card localization keeps the cards lazy

The label helper SHALL be dependency-free and SHALL NOT import the canvas card modules, so the story
and podium card code stays behind the existing dynamic import and the play-web first-load bundle
budget is not exceeded.

#### Scenario: The bundle budget still passes

- **WHEN** the play-web bundle budget check runs after a production build
- **THEN** the canvas card modules remain absent from the entry chunk and the budget passes
