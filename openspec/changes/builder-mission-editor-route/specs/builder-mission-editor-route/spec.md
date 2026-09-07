# builder-mission-editor-route Specification

## ADDED Requirements

### Requirement: The open mission is addressed by the URL

The Builder SHALL represent "which mission is currently being edited" in the URL of the existing
`/build/:gameId` route, as a search parameter carrying the task id. Opening a mission SHALL be a
navigation that adds a history entry; closing it SHALL remove that entry.

The Builder page component SHALL NOT unmount when a mission is opened or closed, so its undo/redo
history, its debounced autosave timer and its unsaved-changes guard are unaffected by editing a
mission.

#### Scenario: Opening a mission is addressable

- **WHEN** a creator opens a mission for editing from any entry point (a mission tile, a readiness
  entry, a הקמה מהירה step, or the stage rail)
- **THEN** the URL carries that mission's task id
- **AND** the Builder page component is not remounted

#### Scenario: The game's unsaved work survives opening a mission

- **WHEN** a creator has unsaved edits pending and opens a mission
- **THEN** the pending autosave, the undo/redo stack and the dirty state are all preserved

#### Scenario: Switching directly between two missions

- **WHEN** the editor is open on mission A and the creator opens mission B without closing A first
- **THEN** the URL addresses mission B
- **AND** exactly one history entry is held for the editor, so a single back dismisses it

---

### Requirement: Back dismisses the editor rather than leaving the Builder

While the mission editor is open, the platform back affordance (the phone's back gesture or button,
and the browser's back control) SHALL close the editor and return the creator to the Builder with
the game intact. It SHALL NOT navigate away from the Builder.

Closing the editor by any other affordance (the ✕ control, the Escape key, or finishing the wizard)
SHALL leave the history in the same state as a back dismissal, so that the two paths cannot
accumulate or strand entries.

#### Scenario: Back closes the open editor

- **WHEN** the mission editor is open and the creator triggers back
- **THEN** the editor closes, the Builder remains on screen, and the game is not reloaded

#### Scenario: Back after closing leaves the Builder

- **WHEN** the creator closes the editor with the ✕ control and then triggers back
- **THEN** the creator leaves the Builder, exactly as a back would have done with no editor open

#### Scenario: Edits are flushed on dismissal however it happens

- **WHEN** the editor is dismissed by back, by ✕, or by Escape
- **THEN** any draft edit not yet flushed to game state is flushed, identically in all three cases

---

### Requirement: A mission link restores the editor, and an unknown one degrades

Loading a Builder URL that addresses a mission SHALL open that mission's editor once the game has
loaded.

A URL addressing a task id that is not present in the loaded game — deleted, belonging to another
game, or malformed — SHALL open the Builder with no editor and no error state, and SHALL clear the
stale address without adding a history entry. It SHALL NOT show an error, an empty editor, or a
crash.

#### Scenario: Reload reopens the mission

- **WHEN** a creator reloads the page while a mission editor is open
- **THEN** the same mission's editor is open after the reload

#### Scenario: A deleted mission's link degrades to the plain Builder

- **WHEN** a Builder URL addresses a task id that no longer exists in the game
- **THEN** the Builder opens with no editor, no error is shown, and the address is cleared by
  replacing the current history entry rather than adding one

#### Scenario: A malformed address is treated as no mission

- **WHEN** the address carries an empty or non-string task id
- **THEN** the Builder opens with no editor, exactly as if no mission had been addressed

---

### Requirement: The stage of the open mission is derived, never carried separately

The Builder SHALL derive the containing stage from the open mission's task id rather than storing a
stage id alongside it. It SHALL NOT be possible for the addressed mission and the stage the Builder
believes it is in to disagree.

#### Scenario: The stage follows the mission

- **WHEN** a mission is opened from any entry point
- **THEN** the stage reported as active is the stage that actually contains that mission

#### Scenario: A mission moved between stages stays correctly attributed

- **WHEN** the open mission is moved to another stage while its editor is open
- **THEN** the derived stage is the mission's new stage

---

### Requirement: The mission editor is full-screen on a phone

Below the `lg` breakpoint the mission editor SHALL occupy the full viewport, honouring the device's
safe-area insets, and SHALL NOT reserve or surrender height to any other overlay.

At `lg` and above the editor SHALL keep its existing inline side-pane presentation, unchanged.

The editor's primary controls SHALL remain reachable while the on-screen keyboard is open, and the
editor SHALL contain exactly one vertically scrolling region, which SHALL NOT chain its scroll to
anything behind it.

#### Scenario: Phone presentation uses the whole screen

- **WHEN** the mission editor is opened on a viewport narrower than `lg`
- **THEN** it fills the viewport rather than a fraction of its height

#### Scenario: A floating overlay no longer shrinks the editor

- **WHEN** a floating הקמה מהירה bar or card is on screen and the mission editor is open on a phone
- **THEN** the editor's height is not reduced on account of that overlay

#### Scenario: The primary action survives the keyboard

- **WHEN** the creator focuses a text field in the editor on a phone and the keyboard opens
- **THEN** the editor's primary action remains reachable

#### Scenario: Scrolling the editor does not move the Builder

- **WHEN** the creator scrolls to the end of the editor's scrolling region
- **THEN** the workspace behind the editor does not scroll
