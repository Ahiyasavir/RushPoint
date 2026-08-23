## ADDED Requirements

### Requirement: New game starts with a guided wizard, not a template list

Pressing "+ New game" SHALL open a guided wizard instead of the bare template picker. The
wizard SHALL ask for the game's NAME before anything else, so that every creator begins with
a named game rather than an untitled one, on every path.

A blank name MUST NOT block progress: the creator SHALL be able to continue, and the game is
then created with the existing untitled-game fallback title. The wizard exists to remove
friction, so no question in it may become a dead end.

#### Scenario: The name is the first thing asked

- **WHEN** a creator opens the new-game wizard
- **THEN** the first screen asks for the game's name
- **AND** the name is asked before any question about the game's content or format

#### Scenario: A named game reaches the Builder already titled

- **WHEN** a creator types a name and completes either path
- **THEN** the created game's title is the name they typed
- **AND** the Builder opens on a game that is not called "Untitled game"

#### Scenario: A blank name never blocks the creator

- **WHEN** a creator leaves the name empty and continues
- **THEN** the wizard proceeds
- **AND** the game is created with the existing untitled-game fallback title

### Requirement: Two equally prominent paths — from scratch, or built for me

After the name, the wizard SHALL offer exactly two paths, rendered with equal visual weight:
**start from scratch** and **build it for me**. Neither path may be visually subordinate to
the other, and the scratch path MUST NOT be nested inside, or reachable only after, the
guided path.

The scratch path SHALL behave exactly as today's blank-page creation does, with no added
questions.

#### Scenario: Scratch and guided are offered side by side

- **WHEN** the creator reaches the path choice
- **THEN** both "start from scratch" and "build it for me" are presented as equally
  prominent primary choices
- **AND** neither is rendered as a secondary, text-only or nested option

#### Scenario: Scratch skips every personalization question

- **WHEN** the creator chooses "start from scratch"
- **THEN** the wizard asks no further questions
- **AND** a blank game is created exactly as the pre-existing blank-page path created it

### Requirement: The guided path asks four personalization questions

Only after choosing "build it for me" SHALL the wizard ask: game type (story or missions),
group size, duration, and participant age. Answers are collected before any game is created.

Every question SHALL have a sane default so that the creator can advance without answering
it, and no combination of answers may produce a state where the wizard cannot continue.

#### Scenario: Personalization questions are asked only on the guided path

- **WHEN** the creator chooses "start from scratch"
- **THEN** they are never asked about type, group size, duration or age

#### Scenario: Every question can be skipped

- **WHEN** the creator advances without answering a question
- **THEN** that question's documented default is used
- **AND** the wizard continues to the next step

#### Scenario: Game type selects between the available templates

- **WHEN** the creator answers "story"
- **THEN** the story template is the one instantiated
- **WHEN** the creator answers "missions"
- **THEN** the missions template is the one instantiated

### Requirement: Abandoning the wizard creates nothing

The game SHALL be created only once, at the end of the guided path, from the collected
answers. Closing, cancelling or navigating away from the wizard before that point MUST NOT
create a game, and MUST NOT leave a partial or untitled game in the creator's dashboard.

#### Scenario: Cancelling mid-wizard leaves no game behind

- **WHEN** a creator answers two questions and then closes the wizard
- **THEN** no game document is created
- **AND** the creator's game list is unchanged

### Requirement: The guided path hands off into Quick Setup

On completing the guided path, the creator SHALL be taken into the existing Quick Setup flow
for the newly created game, driven by the `wizardSteps` carried over from the template. The
wizard MUST NOT reimplement, duplicate or bypass Quick Setup.

#### Scenario: Quick Setup opens on the personalized game

- **WHEN** the guided path completes and the template carried setup steps
- **THEN** the creator lands in Quick Setup for the new game
- **AND** the steps shown are the ones remapped onto the new game's own stage and task ids

#### Scenario: A template with no setup steps still lands in the Builder

- **WHEN** the guided path completes and the copied game carries no setup steps
- **THEN** the creator lands in the Builder on the personalized game rather than an error

### Requirement: Every wizard screen is usable at phone width

Each screen of the wizard SHALL be designed and verified at a 390px-wide viewport before the
change is considered done. Controls MUST NOT overflow horizontally, and no step indicator,
question or action button may be clipped or overlap another element at that width.

#### Scenario: The wizard fits a 390px viewport

- **WHEN** any wizard screen is rendered at 390px wide
- **THEN** no element overflows the viewport horizontally
- **AND** every question, option and primary action remains fully visible and tappable
