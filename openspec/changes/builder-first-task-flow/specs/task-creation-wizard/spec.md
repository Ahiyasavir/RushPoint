## MODIFIED Requirements

### Requirement: Wizard opens at step 1 for every new or existing task
When a creator clicks a task tile or the "Add task" tile in `StepStages`, the task editor SHALL open
with the wizard at step 1. If the same task is re-opened, the wizard SHALL reset to step 1. Step 1 is
the details step (task name, description, difficulty), not the placement step.

#### Scenario: New task opens at step 1
- **WHEN** a creator clicks the "Add task" tile in any stage
- **THEN** the task editor opens with step 1 visible, the task name field focused, and the step
  indicator showing step 1 of 3

#### Scenario: Existing task re-opens at step 1
- **WHEN** a creator clicks an existing task tile to edit it
- **THEN** the task editor opens at step 1, regardless of the step the wizard was on the last time
  this task was edited

#### Scenario: Opening step 1 needs no map
- **WHEN** the wizard opens at step 1
- **THEN** no map component is mounted and no map tiles are requested for that render

## ADDED Requirements

### Requirement: Wizard step order is details, then interaction, then placement
The wizard SHALL order its three steps as details (step 1), interaction (step 2), placement (step 3).
The order SHALL come from one declared sequence that both the step tabs and the step bodies read, so
a tab and its body can never disagree.

#### Scenario: Declared order drives both tabs and bodies
- **WHEN** the step tabs and the step bodies are rendered
- **THEN** the label on the tab at a given position and the body rendered at that position come from
  the same declared sequence entry

#### Scenario: Placement is last
- **WHEN** the step order is enumerated
- **THEN** placement is the third entry, after details and interaction

#### Scenario: Back navigation preserves entered data
- **WHEN** a creator enters data on any step, advances, and returns with the back control
- **THEN** every value entered on the earlier step is still in place
- **AND** no `Task` field was modified by the navigation itself

### Requirement: The details step captures mission metadata with title validation
The details step SHALL display the task name (required), description, difficulty, and the collapsible
hint, prerequisites and media sections. Forward navigation SHALL be blocked until the task name is
non-empty, and this SHALL be the wizard's only forward gate.

#### Scenario: Task name is required to advance
- **WHEN** a creator is on the details step with an empty task name and activates the advance control
- **THEN** navigation does not advance and an inline hint is shown near the name field

#### Scenario: Non-empty name enables forward navigation
- **WHEN** a creator enters at least one non-whitespace character in the task name field
- **THEN** the advance control becomes enabled and activating it advances to the interaction step

#### Scenario: The name gate is the only forward gate
- **WHEN** the forward gates of every wizard step are enumerated
- **THEN** the non-empty task name is the only one

### Requirement: The interaction step presents a visual type picker with samples
The interaction step SHALL display a card for every `TaskType` value, each showing an icon, a plain
label and a one-sentence description, and selecting a card SHALL update `task.type` immediately. Each
card SHALL additionally offer the action that loads an authored sample of that type. Type-specific
configuration SHALL appear below the grid for the selected type, and point value, estimated minutes
and maximum concurrent teams SHALL remain reachable through the collapsible advanced section.

#### Scenario: Every task type is offered
- **WHEN** the set of cards in the picker is compared with the `TaskType` union
- **THEN** both sets are identical with no additions or omissions

#### Scenario: Selected type is highlighted and applied
- **WHEN** a creator activates a type card
- **THEN** that card receives the selected visual state and `task.type` is updated immediately

#### Scenario: Type-specific configuration follows the selection
- **WHEN** a creator selects the station type
- **THEN** the secret-code input appears below the grid
- **AND** selecting the numeric type instead shows the correct-number and tolerance inputs
- **AND** selecting the sequence type instead shows the ordered-steps editor

#### Scenario: The sample action sits with the type
- **WHEN** a type card is rendered
- **THEN** its sample-loading action is reachable from that card
- **AND** the action's label names the type it will load

### Requirement: The placement step captures geospatial placement
The placement step SHALL display the trigger-mode chooser and, for a mode that needs coordinates, the
map. For a mode that needs no coordinates the map SHALL be replaced by an explanation. The step SHALL
never block forward or backward navigation.

#### Scenario: A located mode shows the map
- **WHEN** the placement step is shown for a task whose trigger mode is a located mode
- **THEN** the map is visible and dropping a pin sets the task's coordinates

#### Scenario: A locationless mode hides the map
- **WHEN** a creator selects the locationless or the instant trigger mode
- **THEN** the map is not mounted and an explanation of that mode is shown instead

#### Scenario: Placement never gates navigation
- **WHEN** a task on the placement step has the unplaced default coordinates
- **THEN** both the back control and the finish control remain enabled

#### Scenario: Locationless task with zero coordinates is valid
- **WHEN** a task's trigger mode is locationless and its coordinates are the unplaced default
- **THEN** the location-validity rule returns true and no coordinate error is shown

#### Scenario: Located task with zero coordinates is invalid
- **WHEN** a task's trigger mode is a located mode and its coordinates are the unplaced default
- **THEN** the location-validity rule returns false
- **AND** the task is reported on the readiness surface rather than blocking navigation

## REMOVED Requirements

### Requirement: Step 1 captures geospatial placement
**Reason**: The wizard's step order changes so that naming and typing come before placement, so a
requirement that binds geospatial placement to the ordinal "step 1" is no longer true. Its content is
carried forward, unbound from an ordinal, by "The placement step captures geospatial placement", and
its forward-navigation scenario is subsumed by the stronger rule that placement never gates
navigation at all.
**Migration**: None. No stored data, callable, payload or `Task` field changes. Read "The placement
step captures geospatial placement" for the placement contract.

### Requirement: Step 2 captures mission metadata with title validation
**Reason**: Same reordering. The metadata fields and the non-empty-title gate are unchanged; only the
ordinal they were bound to moved.
**Migration**: None. Read "The details step captures mission metadata with title validation", which
carries the identical fields and the identical title gate.

### Requirement: Step 3 presents a visual interaction type picker
**Reason**: Same reordering, plus the requirement had drifted from the implementation: it named eight
`TaskType` values where the union now has nine, and it described the quiz editor as two
newline-separated textareas where it is now a row-based choice editor.
**Migration**: None. Read "The interaction step presents a visual type picker with samples", which
states the picker contract against the whole `TaskType` union and adds the per-type sample action.
