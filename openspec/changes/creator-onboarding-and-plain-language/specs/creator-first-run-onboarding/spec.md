## ADDED Requirements

### Requirement: First-run checklist

The creator console SHALL present a first-run checklist that guides a creator from an empty account
to a live run. The checklist SHALL contain, in order: create a game, add a task, preview the game,
do a test run, launch the game for real.

#### Scenario: New account sees the checklist

- **WHEN** a creator with zero games opens the dashboard
- **THEN** the checklist is displayed with all five steps and none of them marked done

#### Scenario: Checklist is ordered and complete

- **WHEN** the checklist is computed for any account state
- **THEN** it contains exactly the five steps in the defined order
- **AND** each step carries a title and a description read from the translation maps

### Requirement: Checklist state is derived from real data

Every checklist step's completion SHALL be derived from the creator's actual games and runs. The
system SHALL NOT mark a step done from a separately stored flag, and SHALL NOT offer a manual
"mark as done" control.

#### Scenario: Creating a game ticks the first step

- **WHEN** a creator's account contains at least one game
- **THEN** the "create a game" step is marked done

#### Scenario: A game with no tasks does not tick the task step

- **WHEN** every game in the account has zero tasks across all its stages
- **THEN** the "add a task" step is not marked done

#### Scenario: A test run does not satisfy the launch step

- **WHEN** the creator's only run was launched as a test run
- **THEN** the "do a test run" step is marked done
- **AND** the "launch for real" step is not marked done

#### Scenario: A real launch satisfies both run steps

- **WHEN** the creator has launched at least one non-test run
- **THEN** both the "do a test run" and the "launch for real" steps are marked done

#### Scenario: Progress is monotonic in the data

- **WHEN** step state is recomputed from the same games and runs
- **THEN** it yields the same result every time and depends on no stored progress flag

### Requirement: Checklist retires itself

The checklist SHALL stop appearing once its steps are all complete or the creator dismisses it, and
SHALL NOT appear for an account that is already established.

#### Scenario: Dismissal is respected

- **WHEN** a creator dismisses the checklist and returns to the dashboard
- **THEN** the checklist is not displayed

#### Scenario: Completion retires it

- **WHEN** all five steps are complete
- **THEN** the checklist is not displayed even if it was never dismissed

#### Scenario: Established account never sees it

- **WHEN** a creator already has a game and a completed real run before the checklist ever existed
- **THEN** the checklist is not displayed

### Requirement: Loading state matches reality

The dashboard's loading placeholder SHALL NOT imply content the creator does not have.

#### Scenario: Empty account does not see a populated skeleton

- **WHEN** a creator with zero games loads the dashboard
- **THEN** the loading placeholder does not render a grid of game-card placeholders that then
  collapses into an empty state

### Requirement: Template names are localized

Every game template SHALL expose its name and description through the translation maps, in Hebrew
and in English. No template name or description SHALL be a hardcoded literal in a component or in
the template module.

#### Scenario: English creator sees English template names

- **WHEN** a creator using the English interface opens the template picker
- **THEN** every template's name and description is in English

#### Scenario: Hebrew creator sees Hebrew template names

- **WHEN** a creator using the Hebrew interface opens the template picker
- **THEN** every template's name and description is in Hebrew

#### Scenario: The new game's title follows the interface language

- **WHEN** a creator creates a game from a named template
- **THEN** the new game's title is the template's name in the creator's current interface language

### Requirement: Template settings are visible before creation

The play mode and the scoring style a template carries SHALL be shown to the creator, in creator
vocabulary, at the moment of creation, and SHALL be changeable there before the game is created.
The system SHALL NOT assign either setting without displaying it.

#### Scenario: Settings are disclosed in the picker

- **WHEN** a creator selects a template
- **THEN** the play mode and the scoring style that template carries are displayed in plain language
  before the game is created

#### Scenario: Settings can be overridden at creation

- **WHEN** a creator changes the displayed scoring style before confirming
- **THEN** the created game uses the chosen scoring style rather than the template's default

#### Scenario: Defaults still apply untouched

- **WHEN** a creator confirms without changing anything
- **THEN** the created game uses the template's own play mode and scoring style
