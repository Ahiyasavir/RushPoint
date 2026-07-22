## ADDED Requirements

### Requirement: One action, one name

Each creator-facing action SHALL be named identically everywhere it appears, in every supported
language. Ending a run SHALL use one verb across the floating run bar and the run console.

#### Scenario: Ending a run reads the same in both places

- **WHEN** the floating run bar and the run console both offer the action that ends a run
- **THEN** both use the same label in English
- **AND** both use the same label in Hebrew

#### Scenario: No orphaned synonym remains

- **WHEN** the translation maps are inspected for the run-ending action
- **THEN** exactly one label exists per language for it

### Requirement: No affordance leads nowhere

Every navigational affordance the creator console presents SHALL lead to a destination different
from the screen the creator is currently on.

#### Scenario: The builder quick card opens a builder

- **WHEN** a creator on the dashboard activates the quick card that offers to open the builder
- **THEN** they are taken to a builder
- **AND** they are not left on the dashboard

#### Scenario: Quick cards are consistent with their targets

- **WHEN** the dashboard's quick cards are rendered
- **THEN** every card's label describes the destination it actually navigates to

### Requirement: Live-run chrome represents only the run on screen

The floating live-run bar SHALL NOT be displayed on a run console. Its controls SHALL never act on a
run other than the one it names.

#### Scenario: Two live runs, viewing the second one

- **WHEN** a creator has two live runs and opens the console of the run that is not the featured one
- **THEN** the floating run bar is not displayed

#### Scenario: Bar still returns the creator to their run elsewhere

- **WHEN** a creator with a live run is on any screen that is not a run console or the live-runs
  overview
- **THEN** the floating run bar is displayed and names that run

### Requirement: Primary navigation carries only primary destinations

The creator console's primary navigation SHALL be produced by a single rule shared by the desktop
navigation and the mobile drawer, and SHALL NOT offer the live-runs overview as a top-level
destination. The live-runs overview SHALL remain a registered, directly reachable route.

#### Scenario: Live runs is not a nav destination

- **WHEN** the primary navigation destinations are computed for a signed-in creator
- **THEN** the live-runs overview is not among them

#### Scenario: Desktop and mobile agree

- **WHEN** the desktop navigation and the mobile drawer are rendered
- **THEN** both render the same destinations from the same rule

#### Scenario: Payment-gated destination still respected

- **WHEN** payments are disabled
- **THEN** the wallet destination is absent from the primary navigation
- **AND** when payments are enabled it is present

#### Scenario: The route still resolves

- **WHEN** a creator opens the live-runs overview by direct link or bookmark
- **THEN** the overview renders
- **AND** it does not produce a not-found result

#### Scenario: The multi-run link still works

- **WHEN** a creator has more than one live run and activates the floating bar's "more runs" link
- **THEN** they are taken to the live-runs overview

### Requirement: Live runs are reached from the game they belong to

A game that has a run in progress SHALL offer, from its entry in the creator's game library, a
direct way to open that run. The floating live-run bar SHALL remain available as the always-present
way back to a run in progress.

#### Scenario: Game card exposes its live run

- **WHEN** a creator views a game that currently has a run in progress
- **THEN** that game's card offers an action that opens the run's console

#### Scenario: Game without a live run is unchanged

- **WHEN** a game has no run in progress
- **THEN** its card offers no open-the-run action

#### Scenario: Returning to a run remains one tap away

- **WHEN** a creator with a run in progress is on any screen that is not a run console or the
  live-runs overview
- **THEN** the floating bar offers to return to that run

### Requirement: One empty-state pattern

Every "nothing here yet" state in the creator console SHALL use the shared empty-state presentation:
a title, an optional explanatory body, and an action where one is meaningful.

#### Scenario: Dashboard with no games

- **WHEN** a creator with zero games views the dashboard
- **THEN** the empty state uses the shared presentation with a title, a body and a create action

#### Scenario: Live-runs overview with no runs

- **WHEN** a creator with no live runs opens the live-runs overview
- **THEN** the empty state uses the shared presentation rather than a bare line of text

#### Scenario: Run console with no teams

- **WHEN** a run has no teams joined yet
- **THEN** the team list shows the shared empty-state presentation explaining how teams join

### Requirement: Creator vocabulary, not engine vocabulary

Creator-facing copy SHALL describe the product in the creator's terms. Internal engine vocabulary
SHALL NOT appear in a label, hint, warning or error unless it is defined in place.

#### Scenario: Task completion is described, not "fired"

- **WHEN** the task editor asks how a task is completed
- **THEN** the wording describes what a player does
- **AND** it does not use the engine's trigger vocabulary

#### Scenario: A map-pinless task is described plainly

- **WHEN** copy refers to a task that has no map pin
- **THEN** it says so in plain words rather than using the internal field name

#### Scenario: Answer tolerance is described plainly

- **WHEN** a numeric task's tolerance field is labelled
- **THEN** the label states how close an answer must be, without a bare symbol standing in for the
  explanation

#### Scenario: A contradictory schedule is explained

- **WHEN** a task is configured to expire before it is released
- **THEN** the message states the contradiction in plain words

#### Scenario: An undefined term is not used

- **WHEN** copy would refer to how the system chooses a team's next task
- **THEN** it either explains the behavior in place or does not name it

#### Scenario: All reworded copy stays localized

- **WHEN** any label, hint, warning or error changed by this capability is rendered
- **THEN** its text is read from the translation maps in both Hebrew and English
- **AND** the Hebrew value contains no English and the English value contains no Hebrew
