# task-creation-wizard Specification

## Purpose
TBD - created by archiving change task-creation-wizard. Update Purpose after archive.
## Requirements
### Requirement: Wizard opens at step 1 for every new or existing task
When a creator clicks a task tile or the "Add task" tile in `StepStages`, the task editor modal SHALL open with the wizard at step 1 (Map & Geospatial Placement). If the same task is re-opened, the wizard SHALL reset to step 1.

#### Scenario: New task opens at step 1
- **WHEN** a creator clicks the "Add task" tile in any stage
- **THEN** the task editor modal opens with step 1 (location picker) visible and wizard progress indicator showing step 1 of 3

#### Scenario: Existing task re-opens at step 1
- **WHEN** a creator clicks an existing task tile to edit it
- **THEN** the task editor modal opens at step 1, regardless of the step the wizard was on the last time this task was edited

---

### Requirement: Step 1 captures geospatial placement
Step 1 of the wizard SHALL display a full-width map (`LocationPicker`) and a prominent "Locationless task" toggle.

#### Scenario: Located task shows the map
- **WHEN** the wizard is on step 1 and `task.locationless` is false (default)
- **THEN** the `LocationPicker` map is visible, and lat/lng coordinate inputs are shown below the map

#### Scenario: Locationless toggle hides the map
- **WHEN** a creator enables the "Locationless task" toggle on step 1
- **THEN** `task.locationless` is set to `true`, the `LocationPicker` map is hidden, and a friendly explanation text is shown ("Teams complete this from anywhere — no map pin needed")

#### Scenario: Re-enabling the toggle restores the map
- **WHEN** a creator disables the "Locationless task" toggle after previously enabling it
- **THEN** `task.locationless` is set to `false` and the `LocationPicker` map becomes visible again

#### Scenario: Step 1 forward navigation is always allowed
- **WHEN** a creator is on step 1 (regardless of whether a location has been set or not)
- **THEN** the "Next" button is enabled and advances to step 2

---

### Requirement: Step 2 captures mission metadata with title validation
Step 2 SHALL display task name (required), difficulty, description, hint, and hint penalty. Forward navigation to step 3 SHALL be blocked until the task name is non-empty.

#### Scenario: Task name is required to advance
- **WHEN** a creator is on step 2 with `task.title` empty and clicks "Next"
- **THEN** navigation does NOT advance to step 3 and an inline validation hint is shown near the title input (e.g., "Task name is required")

#### Scenario: Non-empty name enables forward navigation
- **WHEN** a creator enters at least one non-whitespace character in the task name field on step 2
- **THEN** the "Next" button becomes enabled and clicking it advances to step 3

#### Scenario: All metadata fields are shown on step 2
- **WHEN** a creator is on step 2
- **THEN** the following fields are visible: Task Name input, Difficulty input (1–10), Description textarea, Hint textarea (optional), and Hint Penalty number input

---

### Requirement: Step 3 presents a visual interaction type picker
Step 3 SHALL display a 2-column card grid with all 8 `TaskType` values, each showing an icon, a plain-English label, and a 1-sentence description. Selecting a card SHALL immediately update `task.type`.

#### Scenario: All 8 task types are shown in the grid
- **WHEN** a creator is on step 3
- **THEN** cards for all 8 types are visible: `field`, `self_report`, `smart_station`, `photo`, `quiz`, `numeric`, `geofence`, `sequence`

#### Scenario: Selected type is visually highlighted
- **WHEN** a creator clicks a type card
- **THEN** that card receives a selected visual state (border highlight) and `task.type` is updated immediately via `onChange`

#### Scenario: Type-specific config appears after selection
- **WHEN** a creator selects the `smart_station` type
- **THEN** a "Secret code" text input appears below the grid for entering the station verification code

#### Scenario: Photo type shows auto-approve toggle
- **WHEN** a creator selects the `photo` type
- **THEN** an "Auto-approve (no staff review needed)" checkbox appears below the grid

#### Scenario: Quiz type shows choices and answers inputs
- **WHEN** a creator selects the `quiz` type
- **THEN** a "Choices, one per line" textarea and an "Accepted answers, one per line" textarea appear below the grid

#### Scenario: Numeric type shows answer and tolerance inputs
- **WHEN** a creator selects the `numeric` type
- **THEN** inputs for "Correct number" and "± tolerance" appear below the grid

#### Scenario: Geofence type shows radius input
- **WHEN** a creator selects the `geofence` type
- **THEN** an "Auto-check-in radius (meters)" input appears below the grid

#### Scenario: Sequence type shows step management
- **WHEN** a creator selects the `sequence` type
- **THEN** the existing sequence steps UI appears below the grid

#### Scenario: Advanced fields are collapsible on step 3
- **WHEN** a creator is on step 3
- **THEN** `pointValue`, `estimatedMinutes`, and `maxConcurrentTeams` are accessible via a collapsible "Advanced" accordion

---

### Requirement: Back navigation preserves all entered data
At any wizard step, clicking "Back" SHALL navigate to the previous step without modifying any `Task` fields already set.

#### Scenario: Back from step 2 preserves location
- **WHEN** a creator has set coordinates on step 1, advanced to step 2, and clicks "Back"
- **THEN** the wizard returns to step 1 with the previously set coordinates still in place

#### Scenario: Back from step 3 preserves name
- **WHEN** a creator has entered a task name on step 2, advanced to step 3, and clicks "Back"
- **THEN** the wizard returns to step 2 with the task name field still populated

#### Scenario: Back is disabled on step 1
- **WHEN** a creator is on step 1
- **THEN** no "Back" button is shown (or it is visually disabled)

---

### Requirement: Locationless task passes location validation without coordinates
A task with `locationless === true` SHALL be considered location-valid even when `coordinates.lat === 0` and `coordinates.lng === 0`.

#### Scenario: Locationless task with zero coordinates is valid
- **WHEN** `task.locationless` is `true` and `task.coordinates` is `{ lat: 0, lng: 0 }`
- **THEN** `isTaskLocationValid(task)` returns `true` and no coordinate error is shown

#### Scenario: Located task with zero coordinates is invalid
- **WHEN** `task.locationless` is `false` and `task.coordinates` is `{ lat: 0, lng: 0 }`
- **THEN** `isTaskLocationValid(task)` returns `false`

---

### Requirement: All existing Task fields are preserved through the wizard
The wizard SHALL write all `Task` fields that the previous flat `TaskEditor` wrote. No fields SHALL be silently dropped.

#### Scenario: Full task payload reaches the auto-save pipeline
- **WHEN** a creator completes all 3 steps and the parent's auto-save debounce fires
- **THEN** the `updateGame` callable receives a task object containing: `id`, `title`, `type`, `coordinates`, `locationless`, `difficulty`, `estimatedMinutes`, `pointValue`, `maxConcurrentTeams`, `description`, `hint`, `hintPenalty`, `smart`, `choices`, `answers`, `numericAnswer`, `numericTolerance`, `geofenceRadiusMeters`, `steps`, `tags`

---

### Requirement: `TASK_TYPE_META` covers all 8 TaskType values
`TASK_TYPE_META` in `wizardLogic.ts` SHALL have exactly one entry for every value in the `TaskType` union. Each entry SHALL have a non-empty `label` string and a non-empty `description` string.

#### Scenario: No TaskType is missing from the metadata map
- **WHEN** the set of keys in `TASK_TYPE_META` is compared to the `TaskType` union values
- **THEN** both sets are identical with no additions or omissions

