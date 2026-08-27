## ADDED Requirements

### Requirement: The questionnaire shows a live panel of the game's shape
While a creator answers the smart-build questionnaire, the flow SHALL display a panel showing the
shape of the game their answers currently describe: one card per stage, each card showing its
position in the game and one slot per mission that stage will hold. The panel SHALL update as each
answer is given, without the creator asking for it.

Stage cards SHALL be labelled by position ("stage 1", "stage 2", …). They SHALL NOT show the
composed stage names, which are drawn after every mission is chosen and are therefore unknowable
before the game is composed; the composed names are part of the reveal.

#### Scenario: The panel is present from the first question
- **WHEN** a creator opens the smart-build path
- **THEN** the shape panel is visible alongside the first question
- **AND** it shows the shape produced by the questionnaire's default answers

#### Scenario: Stage cards are labelled by position, not by composed name
- **WHEN** the panel renders a three-stage shape
- **THEN** the cards read as stage 1, stage 2 and stage 3
- **AND** no composed stage name is shown before the reveal

#### Scenario: Answering updates the shape
- **WHEN** a creator changes an answer that affects how long or how large the game is
- **THEN** the panel's stage cards and slot counts update to match the new answers

#### Scenario: The panel never blocks the questionnaire
- **WHEN** the shape cannot be derived for the current answers
- **THEN** the questionnaire remains fully usable and the creator can still finish
- **AND** no error screen is shown

### Requirement: The panel shows shape, never mission content
Every mission slot in the panel SHALL render as an unfilled placeholder. The panel SHALL NOT
display any mission's title, description, type, media or location before the reveal, whether or
not the composer has already chosen them.

#### Scenario: Slots are placeholders
- **WHEN** the panel renders a stage holding three missions
- **THEN** three placeholder slots are shown
- **AND** none of them carries a mission title, description or type

#### Scenario: No mission is chosen while answering
- **WHEN** a creator answers every question, walking backwards and forwards between them
- **THEN** no mission has been selected at any point before the questionnaire finishes

### Requirement: The shape is derived without selecting missions
The shape SHALL be produced by a function of the questionnaire's answers and a seed, which selects
no missions. It SHALL reproduce only the composer's stage-planning decisions — the mission budget,
which blueprint shapes the game, and how that budget is spread across stages — and SHALL stop
before any mission is chosen.

#### Scenario: Deriving the shape is deterministic for a seed
- **WHEN** the same answers and the same seed are passed to the shape function twice
- **THEN** both calls return an identical shape

#### Scenario: No mission is selected
- **WHEN** the shape function runs
- **THEN** no mission is drawn from the mission bank
- **AND** the returned shape carries no mission identity of any kind

### Requirement: The shape and the composed game share one seed
The questionnaire SHALL hold a single seed for the game being built, and SHALL pass that same seed
to both the shape function and the composer. The seed SHALL be fixed when the questionnaire opens
and SHALL NOT change while answers are edited.

#### Scenario: The seed survives editing
- **WHEN** a creator changes answers, walks backwards and forwards, and finishes
- **THEN** the composer receives the same seed the shape function was given throughout

#### Scenario: A new questionnaire gets a new seed
- **WHEN** a creator starts the smart-build path a second time
- **THEN** a new seed is drawn, so the same answers can yield a different game

### Requirement: The predicted shape matches the composed game's plan
For the same answers and the same seed, the shape SHALL agree with the game the composer builds:
the same number of stages, in the same order, each planning the same number of missions.

#### Scenario: Shape and composed game agree
- **WHEN** any set of answers and a seed are passed to both the shape function and the composer
- **THEN** the stage count, the stage order and the per-stage planned mission count match

#### Scenario: An exhausted pool is reconciled at the reveal, not mispredicted
- **WHEN** the composer drops a planned slot because no mission remained eligible for it
- **THEN** the reveal shows the stage without that slot
- **AND** the missing slot is retired visibly rather than left as a placeholder that never fills

#### Scenario: A game that cannot be composed shows no shape
- **WHEN** the answers are ones the composer would refuse
- **THEN** the shape function reports that there is no shape
- **AND** the panel shows its empty state rather than a shape the creator will not receive

### Requirement: The shape function is total
The shape function SHALL return a usable result for every input, including the questionnaire's
defaults, partially answered state, malformed or out-of-range values, and a missing or malformed
seed. It SHALL NOT throw.

#### Scenario: Defaults yield a shape
- **WHEN** the questionnaire's default answers are passed to the shape function
- **THEN** a shape is returned

#### Scenario: Malformed answers do not throw
- **WHEN** the shape function receives answers containing missing, null or out-of-range values
- **THEN** it returns either a shape or the no-shape result
- **AND** no error is raised

### Requirement: The panel carries no copy of its own
All text in the panel SHALL arrive through the application's translation maps. The shape function
SHALL contain no user-facing copy in any language.

#### Scenario: The shape function is language-free
- **WHEN** the shape function's output is inspected
- **THEN** it carries no Hebrew or English user-facing text

#### Scenario: Panel text switches language
- **WHEN** the console language is switched between Hebrew and English
- **THEN** every word in the panel switches with it
