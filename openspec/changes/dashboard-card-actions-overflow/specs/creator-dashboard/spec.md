## ADDED Requirements

### Requirement: A dashboard game card exposes two primary actions and an overflow menu
Each game card on the creator Dashboard SHALL present Edit and Launch as primary inline actions, and
SHALL collapse its remaining actions — test run, publish or unpublish, share, and delete — into a
single overflow menu on the card. The live "Open run" control for a running game SHALL remain inline.

Every action available on the card today SHALL remain available: the two primary actions inline, and
each of the four secondary actions one click away inside the overflow menu, each invoking the same
behavior it invokes today.

#### Scenario: The secondary actions are reachable from the overflow menu
- **WHEN** a creator opens a game card's overflow menu
- **THEN** test run, publish or unpublish, share, and delete are all listed
- **AND** selecting any one of them performs the same action it performed as a flat button

#### Scenario: The primary actions stay inline
- **WHEN** a game card renders
- **THEN** Edit and Launch are shown as inline controls, not inside the overflow menu

#### Scenario: Delete still confirms before removing
- **WHEN** a creator selects Delete from the overflow menu
- **THEN** the existing delete confirmation is shown before anything is removed

### Requirement: The inline versus overflow split is a pure, total decision
The split between inline and overflow actions SHALL be produced by a pure function of the game, so it
is testable without rendering. Edit and Launch SHALL always be inline. The overflow list SHALL always
be test run, then publish or unpublish, then share, then delete, with delete last as the destructive
action. Whether the toggle reads publish or unpublish SHALL be resolved from the game's visibility.

The function SHALL be total: a null or malformed game SHALL yield a well formed split rather than
throwing, and no action SHALL ever be dropped from the combined set.

#### Scenario: A public game shows an unpublish action
- **WHEN** the split is computed for a game whose visibility is public
- **THEN** the overflow list contains an unpublish action in the publish slot

#### Scenario: A private game shows a publish action
- **WHEN** the split is computed for a game that is not public
- **THEN** the overflow list contains a publish action in the publish slot

#### Scenario: Delete is always the final overflow action
- **WHEN** the split is computed for any game
- **THEN** delete is the last entry in the overflow list

#### Scenario: No action is ever lost
- **WHEN** the split is computed for any game
- **THEN** each of edit, launch, test run, publish or unpublish, share and delete appears exactly once
  across the inline and overflow lists

#### Scenario: A malformed game does not break the split
- **WHEN** the split is computed from a null, a non object, a number or a string
- **THEN** the computation does not throw and returns a well formed split

### Requirement: The card and the run console share one overflow menu primitive
The overflow menu used by the dashboard card SHALL be the same component the run console uses for its
team row overflow, exposing an accessible menu with a labelled trigger, so the two surfaces behave
consistently. Extracting that component SHALL NOT change the run console's team row behavior.

#### Scenario: The run console team menu is unchanged after extraction
- **WHEN** a creator opens a team row overflow menu in the run console
- **THEN** it behaves exactly as before the dashboard reused the same menu component

#### Scenario: The card menu trigger has an accessible name
- **WHEN** the card overflow trigger renders
- **THEN** it carries an accessible label drawn from the translation maps in both Hebrew and English
