## ADDED Requirements

### Requirement: An untouched Quick Setup state is not a decision

The Builder SHALL treat a stored Quick Setup record as a creator's decision only when
it records something the creator did: a status other than `idle`, a deferred step,
or progress past the first step. An untouched `idle` state SHALL NOT be persisted,
and a stored untouched `idle` record SHALL be read as if no record existed.

#### Scenario: The first visit after the new-game wizard

- **WHEN** a creator lands in the Builder straight from the new-game wizard
- **THEN** the Quick Setup invitation is deferred
- **AND** no Quick Setup record is written for that game

#### Scenario: The next visit after the deferral

- **WHEN** the same creator opens the same game again and it has outstanding setup steps
- **THEN** the Quick Setup invitation is offered

#### Scenario: A creator who already carries a stale idle record

- **WHEN** the stored record for a game is `idle` with nothing deferred and no progress
- **THEN** it is read as no record, and the invitation is offered as for a first visit

#### Scenario: A real decision is still respected

- **WHEN** the stored record is `closed`, `done`, or `idle` with a deferred step
- **THEN** the invitation is not offered automatically

### Requirement: Quick Setup is reachable on a phone

On a phone-width Builder, the header overflow menu SHALL contain a Quick Setup entry
whenever the game has at least one setup step, and choosing it SHALL open the flow.

#### Scenario: A composed game on a phone

- **WHEN** a creator opens the overflow menu of a game that has setup steps at phone width
- **THEN** the menu contains a Quick Setup entry showing how many steps remain

#### Scenario: A game with no setup steps

- **WHEN** the game has no setup steps
- **THEN** the menu contains no Quick Setup entry

### Requirement: Readiness groups identical problems

The readiness list SHALL show one row per problem kind, with a count, instead of one
row per offending mission. Activating a grouped row SHALL open the first offending
mission or stage. The order of rows SHALL follow the first appearance of each kind.

#### Scenario: Six missions without a spot

- **WHEN** six missions have no spot on the map
- **THEN** the readiness list shows one row stating that six missions have no spot

#### Scenario: A single problem keeps its specific location

- **WHEN** a problem kind occurs exactly once
- **THEN** its row still names the stage and mission where it occurs

### Requirement: The reveal states what is left before launch

The "your game is ready" reveal SHALL state, in grouped words, what must still be
done before the game can launch, and SHALL say nothing about it when nothing is left.

#### Scenario: A composed game that needs pins

- **WHEN** a composed game has six missions with no spot on the map
- **THEN** the reveal shows a line saying six spots must be placed before launch

#### Scenario: A composed game that is launch-ready

- **WHEN** the composed game has no readiness problems
- **THEN** the reveal shows no "left before launch" line

### Requirement: Path cards and questionnaire chips have accessible names

Every new-game path card and every questionnaire choice SHALL expose an accessible
name equal to its visible label.

#### Scenario: A screen reader on the path step

- **WHEN** a screen reader reaches the three path cards
- **THEN** each is announced by its label, not as an unnamed button
