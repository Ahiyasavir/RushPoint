## ADDED Requirements

### Requirement: Authoring order puts naming and typing before placement

The task wizard SHALL present naming and interaction typing before geospatial placement. A creator
opening a freshly added task SHALL be able to type its name as their first action, without loading a
map and without dropping a pin.

#### Scenario: A new task opens on the naming step

- **WHEN** a creator adds a task to a stage and the wizard opens
- **THEN** the first step shown is the one carrying the task name field
- **AND** the name field holds focus
- **AND** no map tiles are requested for that render

#### Scenario: Placement is the last step

- **WHEN** the wizard's step order is computed
- **THEN** the placement step is ordered after both the naming step and the interaction step

#### Scenario: Re-opening an existing task uses the same order

- **WHEN** a creator re-opens a task that already has a name, a type and a pin
- **THEN** the wizard opens on the same first step as a new task
- **AND** every previously entered value is intact

### Requirement: Placement never blocks forward navigation

Forward navigation between wizard steps SHALL NOT depend on whether a task has real coordinates. The
step-advance control SHALL be enabled for a task whose coordinates are the unplaced default.

#### Scenario: An unplaced task can still advance

- **WHEN** a task's trigger mode needs coordinates and its coordinates are the unplaced default
- **THEN** the step-advance control is enabled
- **AND** advancing does not modify the task's coordinates

#### Scenario: Naming remains the one forward gate

- **WHEN** a task has no name
- **THEN** the step-advance control on the naming step is disabled
- **AND** the reason is stated next to the name field

#### Scenario: Tabs and the advance control agree

- **WHEN** any step is reachable by clicking its step tab directly
- **THEN** the same step is reachable by advancing through the step-advance control
- **AND** neither path enforces a gate the other does not

### Requirement: An unplaced task shows an explicit "not placed yet" state

A task whose trigger mode requires coordinates and which has not been placed SHALL render an
explicit, calm "not placed yet" state that names what is missing and offers the action that fixes it.
The state SHALL NOT be styled as an error.

#### Scenario: Unplaced located task is labelled

- **WHEN** a task's trigger mode is a located mode and its coordinates are the unplaced default
- **THEN** the placement step states that the task has no pin yet
- **AND** it offers the action to place one

#### Scenario: Placed task shows no such state

- **WHEN** a task has real coordinates
- **THEN** the "not placed yet" state is not rendered

#### Scenario: A task that needs no pin shows no such state

- **WHEN** a task's trigger mode is locationless or instant
- **THEN** the "not placed yet" state is not rendered
- **AND** the task is not reported as unplaced anywhere in the interface

#### Scenario: Placement classification is total

- **WHEN** the placement classification rule is applied to any task
- **THEN** it returns exactly one of: placed, not placed, or placement not required

### Requirement: Every task type offers a working sample

The interaction type picker SHALL offer, for every task type, an action that fills the draft with an
authored, immediately completable example of that type. The action SHALL be reachable from the type
picker itself.

#### Scenario: Each type has at least one sample

- **WHEN** the sample catalogue is enumerated
- **THEN** every task type has at least one sample
- **AND** every sample has a non-empty label and a non-empty task title

#### Scenario: Loading a sample yields a completable task

- **WHEN** a creator loads a sample for a type whose completion needs an answer key
- **THEN** the resulting draft satisfies the interaction-completeness rule without further editing

#### Scenario: Loading a sample sets the type

- **WHEN** a creator loads a sample offered on a type card other than the current type
- **THEN** the draft's type becomes that type
- **AND** the sample's content is applied to the same draft

#### Scenario: A type with several samples lets the creator choose

- **WHEN** a type offers more than one sample
- **THEN** the creator is offered the labelled list of that type's samples
- **AND** a type offering exactly one sample applies it directly

### Requirement: Loading a sample preserves identity and never silently destroys authored content

Applying a sample SHALL preserve the draft's identifier, its coordinates and its trigger mode. When a
sample would replace content the creator already authored, the interface SHALL name what would be
replaced and require confirmation before applying.

#### Scenario: Identity and placement survive

- **WHEN** a sample is applied to a draft that already has an id, real coordinates and a trigger mode
- **THEN** the id, the coordinates and the trigger mode are unchanged
- **AND** the sample's fields are present

#### Scenario: Overwrite is disclosed

- **WHEN** a sample would replace a non-empty title, description or answer key the creator authored
- **THEN** the fields that would be replaced are named before the sample is applied
- **AND** declining leaves the draft byte-identical

#### Scenario: An empty draft applies without a prompt

- **WHEN** a sample is applied to a draft with no authored content
- **THEN** it is applied immediately with no confirmation

### Requirement: Validation is withheld until a field is dirtied or the creator tries to finish

No validation message about a task's own content SHALL be rendered on open. A message SHALL become
visible only after the creator has edited the field group it concerns, or after the creator has
attempted to finish the task, or when the editor was opened from the readiness surface's link to that
issue.

#### Scenario: A fresh quiz is silent

- **WHEN** a creator switches a brand-new task to the quiz type
- **THEN** no message about a missing correct answer is shown
- **AND** no message about the interaction being incomplete is shown

#### Scenario: A fresh ordering quiz is silent

- **WHEN** a creator switches a brand-new quiz to the ordering mode and the editor pads the list with
  empty rows
- **THEN** no message about the item count is shown against those auto-padded rows

#### Scenario: A fresh numeric, station or sequence task is silent

- **WHEN** a creator opens a brand-new task of the numeric, station or sequence type
- **THEN** no message about the missing answer, code or steps is shown

#### Scenario: Editing the field group reveals its message

- **WHEN** a creator types into a quiz choice and leaves every choice unmarked as correct
- **THEN** the missing-correct-answer message becomes visible

#### Scenario: An unrelated edit reveals nothing

- **WHEN** a creator edits only the task description
- **THEN** no message about the answer key becomes visible

#### Scenario: Clearing a dirtied field keeps its message visible

- **WHEN** a creator types into a field group and then clears it
- **THEN** that group's message remains visible

#### Scenario: Reveal state does not survive re-opening

- **WHEN** a creator edits a task, closes the editor and re-opens the same task
- **THEN** no validation message is visible on open
- **AND** the task's stored content is unchanged

#### Scenario: Opening from the readiness surface reveals immediately

- **WHEN** the editor is opened by following a readiness issue that names this task
- **THEN** that issue's message is visible on open without any edit

### Requirement: Finishing a task with unresolved blockers reveals them once and never traps the creator

The wizard's finish control SHALL always be enabled. Pressing it while the task carries an unrevealed
blocking issue SHALL reveal every such issue and keep the editor open. Pressing it again SHALL close
the editor.

#### Scenario: First press reveals

- **WHEN** a creator presses finish on a task with a blocking issue that has not been revealed
- **THEN** every blocking issue on that task becomes visible
- **AND** the editor stays open

#### Scenario: Second press closes

- **WHEN** the creator presses finish again with the issues revealed
- **THEN** the editor closes
- **AND** the task keeps whatever content it has

#### Scenario: A complete task closes on the first press

- **WHEN** a creator presses finish on a task with no blocking issue
- **THEN** the editor closes immediately

#### Scenario: A closed incomplete task is still reported

- **WHEN** an incomplete task is closed by finish, by the close control or by dismissing the panel
- **THEN** it appears as a blocking issue on the readiness surface

### Requirement: One readiness surface lists every launch-blocking issue

The Builder SHALL present a persistent readiness surface that lists, at once, every issue that would
block launching the game. Each entry SHALL name the offending stage and, where the issue belongs to a
task, the offending task, and SHALL navigate to it when activated. The surface SHALL be visible
without attempting a launch.

#### Scenario: Three broken tasks are reported together

- **WHEN** a game has three tasks that cannot be completed
- **THEN** the readiness surface lists three entries
- **AND** it does not require three launch attempts to discover them

#### Scenario: Every rule is represented

- **WHEN** the readiness surface is computed for a game
- **THEN** it reports a stage with no tasks, a task with no answer key, a located task with no pin,
  and a stage that requires more completions than it can yield

#### Scenario: Entries navigate to the offender

- **WHEN** a creator activates a readiness entry that names a task
- **THEN** that task's stage becomes the active stage
- **AND** that task's editor opens with the issue revealed

#### Scenario: A ready game says so

- **WHEN** a game has no blocking issue
- **THEN** the readiness surface states that the game is ready to launch
- **AND** it lists no entries

#### Scenario: The surface updates as issues are fixed

- **WHEN** a creator fixes one of several reported issues
- **THEN** that entry disappears and the remaining entries stay listed

### Requirement: Launch enforcement and the readiness surface share one rule

The rule that decides whether a game can launch SHALL be the same computation that produces the
readiness surface's entries. Launch SHALL refuse while any blocking issue exists.

#### Scenario: Launch refuses exactly when the surface is non-empty

- **WHEN** launch is attempted for a game
- **THEN** it proceeds if and only if the readiness computation returns no blocking issue

#### Scenario: A refused launch points at the surface

- **WHEN** launch is refused
- **THEN** the creator is directed to the readiness surface rather than told about one offender

#### Scenario: A test run obeys the same rule

- **WHEN** a test run is launched
- **THEN** the same readiness rule decides whether it proceeds

#### Scenario: No rule exists only at launch time

- **WHEN** the set of conditions that refuse a launch is compared with the set of issue kinds the
  readiness surface can report
- **THEN** the two sets are identical

### Requirement: A configured advanced setting is visible while its section is folded

The task editor's advanced section SHALL report, on its folded header, how many of its optional
settings are configured, and SHALL start expanded when at least one is. No server-honored setting a
task carries SHALL be invisible at rest.

#### Scenario: A configured expiry is reported

- **WHEN** a task carries a task expiry
- **THEN** the advanced section's folded header reports one configured setting
- **AND** the section starts expanded when the editor opens

#### Scenario: A fresh task carries no badge

- **WHEN** a task carries none of the advanced section's optional settings
- **THEN** the folded header shows no count
- **AND** the section starts collapsed

#### Scenario: Defaults are not counted as configured

- **WHEN** a task carries only the point value, estimated minutes and concurrency defaults a fresh
  task ships with
- **THEN** the advanced section reports no configured setting

#### Scenario: The badge and the auto-open rule agree

- **WHEN** the advanced section's count is greater than zero
- **THEN** the section starts expanded
- **AND** the two answers come from the same computation

### Requirement: A scheduled release a task carries is disclosed, not warned about in the dark

A task carrying a wall-clock release instant SHALL have that instant disclosed in the task editor,
regardless of whether the task also carries an expiry, and SHALL be counted among the advanced
section's configured settings. The editor SHALL NOT render a warning whose condition it gives the
creator no way to reach or resolve.

#### Scenario: A carried release instant is shown

- **WHEN** a task carries a wall-clock release instant, however it was authored
- **THEN** the task editor states the instant at which the task opens
- **AND** the advanced section counts it as configured

#### Scenario: The disclosure does not depend on an expiry

- **WHEN** a task carries a release instant and no expiry
- **THEN** the release instant is still disclosed

#### Scenario: No unreachable warning remains

- **WHEN** the task editor's warning conditions are enumerated
- **THEN** none of them depends on a field that the editor neither edits nor displays

### Requirement: All new authoring copy is localized

Every label, message, empty state, confirmation and accessible name introduced by this capability SHALL
be read from the translation maps in both Hebrew and English. No such string SHALL be hardcoded in a
component.

#### Scenario: Both dictionaries carry every new key

- **WHEN** the translation maps are compared
- **THEN** every new key exists in both the Hebrew and the English dictionary
- **AND** the Hebrew value contains no English words and the English value contains no Hebrew letters

#### Scenario: The readiness surface switches language

- **WHEN** a creator switches the interface language
- **THEN** every readiness entry, its stage and task labels and its call to action are rendered in the
  selected language

### Requirement: No authoring capability is removed

Every task field and every stage setting reachable in the Builder before this change SHALL remain
reachable after it, and every launch rule enforced before SHALL remain enforced.

#### Scenario: Fields survive

- **WHEN** the task editor's field inventory is compared before and after
- **THEN** no field became unreachable

#### Scenario: Launch rules survive

- **WHEN** the launch refusal conditions are compared before and after
- **THEN** no condition stopped being enforced
- **AND** the placement rule still refuses a located task with no pin
