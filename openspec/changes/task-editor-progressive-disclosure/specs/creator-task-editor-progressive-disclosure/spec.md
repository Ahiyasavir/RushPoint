## ADDED Requirements

### Requirement: The task editor is exactly 3 steps, in a fixed order
The Builder's task editor SHALL present exactly 3 steps in this order: Location, Details & Type,
Execution & Enhancements.

#### Scenario: Creator opens the task editor for a new task
- **WHEN** a creator opens the task editor to create a new task
- **THEN** the first step shown is Location, the second is Details & Type, and the third is
  Execution & Enhancements

### Requirement: Step 1 contains only the Location picker
Step 1 SHALL render only the 2-option Location picker (Anywhere / Specific Location) and its
Advanced panel when applicable; no title, description, type, or optional field renders here.

#### Scenario: Creator views Step 1
- **WHEN** a creator is on Step 1
- **THEN** the only controls visible are the Location picker and, if "Specific Location" is
  selected, its Advanced panel

### Requirement: Step 2 contains only Title, Description, and Task Type
Step 2 SHALL render exactly three controls — Title, Description, Task Type — and nothing else.
`difficulty` SHALL NOT render on this step.

#### Scenario: Creator views Step 2
- **WHEN** a creator is on Step 2
- **THEN** exactly three controls are visible: Title, Description, and Task Type

### Requirement: Step 3 shows required verification fields before any opt-in chip
Step 3 SHALL render the task-type-conditional required verification fields first, followed by the
opt-in chip row. Required verification fields SHALL always render when applicable to the selected
type — they are never hidden behind a chip.

#### Scenario: Creator selects Quiz as the task type
- **WHEN** a task's type is Quiz and the creator is on Step 3
- **THEN** the quiz choices/ordering editor renders unconditionally, above the opt-in chip row

#### Scenario: Creator selects a type with no verification config
- **WHEN** a task's type is `field`, `self_report`, or `geofence`
- **THEN** Step 3 shows no required verification fields and the opt-in chip row renders directly

### Requirement: Optional fields are grouped into 4 opt-in chips
Step 3's opt-in chip row SHALL offer exactly 4 chips: "Add Hint", "Set Timer / Points", "Attach
Media", "Prerequisites / Rules", each covering its documented field group.

#### Scenario: Creator clicks an opt-in chip
- **WHEN** a creator clicks "Add Hint"
- **THEN** only the hint fields (`hint`, `hintPenalty`, auto-reveal thresholds) mount inline, with
  a Remove control, and the chip disappears from the row

#### Scenario: Creator removes an opted-in group
- **WHEN** a creator clicks the Remove control on an expanded group
- **THEN** that group's fields clear and the group's chip reappears in the row

### Requirement: A field group with existing data renders expanded by default
A previously-authored task whose optional field group already has data SHALL render that group
expanded with its Remove control on load — never behind an unclicked chip.

#### Scenario: Opening a task that already has a hint
- **WHEN** a creator opens a task with `hint` already set
- **THEN** the "Add Hint" group renders expanded, showing the existing hint value, not a chip

#### Scenario: Opening a task with no optional data
- **WHEN** a creator opens a task with no hint, no media, default timing, and no prerequisites
- **THEN** all 4 chips render collapsed and no optional fields are visible until clicked
