## ADDED Requirements

### Requirement: Optional task groups open collapsed
The task editor's opt-in field groups (hint, timer & points, media, prerequisites & rules) SHALL
mount collapsed every time the editor opens, regardless of what the task already carries. The
decision SHALL NOT depend on whether the group holds authored data. This supersedes the earlier
rule that a group holding content mounted expanded.

#### Scenario: A brand-new task opens with nothing expanded
- **WHEN** the editor opens for a freshly created task
- **THEN** no opt-in group is expanded

#### Scenario: A template-seeded task opens with nothing expanded
- **WHEN** the editor opens for a task carrying a non-default station capacity, a non-default
  difficulty, a non-default point value and an authored hint (the shape every template-derived
  task has)
- **THEN** no opt-in group is expanded

#### Scenario: A fully populated task opens with nothing expanded
- **WHEN** the editor opens for a task with content in all four groups
- **THEN** no opt-in group is expanded

### Requirement: A folded group still advertises that it holds data
Folding SHALL NOT make authored data undiscoverable. For any group holding authored content, the
system SHALL report that content through the group's chip badge count, so a creator can see which
folded groups carry settings without opening them.

#### Scenario: Authorship is still reported for a collapsed populated group
- **WHEN** a task carries an authored hint and the hint group is collapsed
- **THEN** the hint group is still reported as holding content, and its badge count is greater
  than zero

#### Scenario: An untouched group advertises nothing
- **WHEN** a task carries no authored value for a group
- **THEN** that group reports no content and a badge count of zero

### Requirement: Hiding a group never modifies the task
The control that folds an opt-in group away SHALL only change what is displayed. It SHALL NOT
clear, reset, or otherwise write any field of the task, and SHALL be labelled as a hide action
rather than a removal.

#### Scenario: Hiding a populated group preserves every field
- **WHEN** a creator hides a group on a task that has content in every group
- **THEN** every field of the task is unchanged, including the hidden group's own fields

#### Scenario: Re-opening a hidden group shows the original values
- **WHEN** a creator hides a populated group and then opens it again
- **THEN** the values shown are the ones that were there before hiding

### Requirement: Destroying a stage is labelled and confirmed
A control that deletes a stage SHALL be labelled as a deletion, never as a close, and SHALL
require explicit confirmation that names the stage before the stage and its tasks are removed.

#### Scenario: Deleting a stage asks first
- **WHEN** a creator activates the stage delete control
- **THEN** a confirmation naming the stage and the number of tasks it will destroy is shown, and
  no stage is removed until it is accepted

#### Scenario: Declining the confirmation keeps the stage
- **WHEN** a creator activates the stage delete control and declines the confirmation
- **THEN** the stage and all of its tasks remain in the game
