## ADDED Requirements

### Requirement: Finishing the questionnaire opens a reveal
When the creator finishes the smart-build questionnaire and a game is composed, the flow SHALL
show a full-screen reveal before handing off to the Builder, rather than opening the Builder
directly.

#### Scenario: The reveal precedes the Builder
- **WHEN** a creator answers the last question and the composer produces a game
- **THEN** the reveal is shown
- **AND** the Builder is opened only after the creator leaves the reveal

#### Scenario: The reveal can always be left
- **WHEN** the reveal is showing
- **THEN** the creator can proceed to the Builder at any point without waiting for the animation
  to finish

### Requirement: The reveal fills the shape the creator watched being built
The reveal SHALL fill the mission slots the panel showed during the questionnaire, one at a time,
with the missions the composer actually chose. The stages and slot counts revealed SHALL be the
ones the panel displayed.

#### Scenario: Slots fill with real missions
- **WHEN** the reveal plays
- **THEN** each placeholder slot is replaced by the title of the mission the composer chose for it

#### Scenario: The revealed shape matches the watched shape
- **WHEN** the reveal finishes
- **THEN** the stage count, stage order and per-stage mission count are the ones the panel showed

### Requirement: The reveal proposes a name and celebrates
The reveal SHALL present the composed game's proposed name and SHALL fire the application's
existing celebration effect. Neither SHALL block the creator from continuing.

#### Scenario: The name is shown
- **WHEN** the reveal plays
- **THEN** the composed game's proposed name is displayed

#### Scenario: Celebration is not a gate
- **WHEN** the celebration effect cannot run
- **THEN** the reveal still shows the game and the creator can still continue to the Builder

### Requirement: The reveal offers a share card
The reveal SHALL offer the creator a share card for the game they just built, using the existing
sharing surface. Declining to share SHALL be a normal exit.

#### Scenario: Sharing is offered
- **WHEN** the reveal is showing
- **THEN** an action to share the composed game is available

#### Scenario: Sharing is optional
- **WHEN** a creator continues to the Builder without sharing
- **THEN** the game is opened in the Builder unchanged

### Requirement: A failed composition skips the reveal and says so
When the composer cannot produce a game from the creator's answers, the flow SHALL NOT show the
reveal. It SHALL tell the creator what happened and fall back to the existing blank-game path.

#### Scenario: No game means no reveal
- **WHEN** the composer returns no game
- **THEN** the reveal is not shown
- **AND** the creator is told the game could not be composed

#### Scenario: The fallback still creates something
- **WHEN** the composer returns no game
- **THEN** the creator is offered the blank-game path rather than being left on a dead end

### Requirement: The reveal is accessible and translatable
The reveal SHALL respect a reduced-motion preference, SHALL be operable by keyboard, and every
string it shows SHALL come from the translation maps.

#### Scenario: Reduced motion shows the result immediately
- **WHEN** the operating system requests reduced motion
- **THEN** the reveal presents the finished game without the filling animation

#### Scenario: The reveal is keyboard-operable
- **WHEN** a creator navigates the reveal by keyboard
- **THEN** every action, including continuing to the Builder, is reachable and has an accessible
  name

#### Scenario: Reveal text switches language
- **WHEN** the console language is switched between Hebrew and English
- **THEN** every word in the reveal switches with it
