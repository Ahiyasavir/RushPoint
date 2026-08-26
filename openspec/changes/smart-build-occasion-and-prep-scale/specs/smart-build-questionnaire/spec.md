## ADDED Requirements

### Requirement: The questionnaire asks the occasion first
The smart-build questionnaire SHALL ask what kind of event this is as its FIRST question, before
it asks who is playing. The offered occasions SHALL be birthday, bar/bat mitzvah, wedding,
team-building day, youth-movement activity, and a neutral "something else / not sure". The
questionnaire SHALL continue to ask who is playing as a separate question, and the occasion answer
SHALL NOT overwrite, hide or pre-empt that answer.

#### Scenario: Occasion is the first question
- **WHEN** a creator opens the smart-build path
- **THEN** the first question asked is the occasion
- **AND** the progress indicator reads "question 1 of 8"

#### Scenario: Occasion does not decide the audience
- **WHEN** a creator picks "bar/bat mitzvah" and then picks the audience "adults"
- **THEN** the composer payload carries the bar/bat-mitzvah occasion AND the adults audience
- **AND** neither answer is silently rewritten to agree with the other

#### Scenario: Skipping the occasion still yields a game
- **WHEN** a creator taps straight through without choosing an occasion
- **THEN** the occasion defaults to the neutral "something else / not sure"
- **AND** the composer produces a game from that default

#### Scenario: Backing out of the occasion question leaves the questionnaire
- **WHEN** a creator presses Back on the occasion question
- **THEN** the flow signals that the creator left the questionnaire
- **AND** returns to the path fork rather than trapping them

### Requirement: Preparation is one cumulative 1–5 scale
The questionnaire SHALL collect how much the creator will prepare as a SINGLE rating from 1 to 5,
where each level includes everything every lower level covers:

1. no preparation at all
2. the creator will pin missions to real spots on the map
3. level 2 plus preparing things themselves at home
4. level 3 plus going to the site beforehand and setting up there
5. level 4 plus coordinating with an outside party

The scale SHALL default to a level that requires no outside party. An unrecognised or
out-of-range stored value SHALL be coerced into the scale rather than throwing.

#### Scenario: Every level is offered and selectable
- **WHEN** the creator reaches the preparation question
- **THEN** all five levels are offered as an ordered rating, each with its own explanation
- **AND** the currently selected level's explanation is shown

#### Scenario: Default requires no outside party
- **WHEN** a creator taps through the preparation question without answering
- **THEN** the level defaults to a value strictly below 5
- **AND** the composer is never handed a tolerance that admits outside-party missions

#### Scenario: A malformed level is coerced, not thrown on
- **WHEN** the reducer receives a preparation level of `0`, `9`, `"full"` or `null`
- **THEN** it yields a usable state carrying a level within 1–5
- **AND** no error is raised

### Requirement: Pinning missions to real spots is derived from the prep level
Whether play-from-anywhere missions are pinned to real spots SHALL be DERIVED from the
preparation level — true at level 2 and above, false at level 1 — and SHALL NOT be collected as
its own answer.

#### Scenario: The separate yes/no chip is gone
- **WHEN** a creator reaches the "where does it happen" question
- **THEN** no question is asked about pinning missions to real spots
- **AND** the question collects only the kinds of place the event has

#### Scenario: Level 1 leaves missions playable from anywhere
- **WHEN** the preparation level is 1
- **THEN** the composer payload requests no pinned missions

#### Scenario: Level 2 and above pins missions
- **WHEN** the preparation level is 2, 3, 4 or 5
- **THEN** the composer payload requests pinned missions

### Requirement: A home is one of the kinds of place on offer
The "where does it happen" question SHALL offer a home among the kinds of place, and a home SHALL
be classified as an indoor setting.

#### Scenario: Home is offered
- **WHEN** a creator reaches the "where does it happen" question
- **THEN** a home is among the selectable kinds of place, with a Hebrew and an English label

#### Scenario: A home-only answer composes an indoor game
- **WHEN** a creator picks a home and nothing else
- **THEN** the composer payload's setting is indoor

### Requirement: The questionnaire remains total and every answer keeps a default
Every question SHALL have a default answer, answers SHALL survive navigating backwards and
forwards, and the reducer SHALL yield a usable state for any unrecognised action or malformed
state rather than throwing. Nothing SHALL be created until the questionnaire finishes.

#### Scenario: Answers survive navigation
- **WHEN** a creator answers all eight questions, walks back to the first and forward again
- **THEN** every answer they gave is still selected

#### Scenario: Every default composes
- **WHEN** the default answer of every question is fed to the composer
- **THEN** a complete game is produced

#### Scenario: An unknown action is inert
- **WHEN** the reducer receives an action it does not recognise
- **THEN** it returns the state unchanged
