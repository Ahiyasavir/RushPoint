# task-creation-wizard Specification

## Purpose
TBD - created by archiving change task-creation-wizard. Update Purpose after archive.
## Requirements
### Requirement: Wizard opens at step 1 for every new or existing task

When a creator opens a task — by clicking a task tile or the "Add task" tile — the task editor SHALL
open with the wizard at step 1. If the same task is re-opened, the wizard SHALL reset to step 1.

Opening a task is a NAVIGATION, not the raising of a modal: the open task is addressed by the URL
(see the `builder-mission-editor-route` capability), so the platform back affordance dismisses the
editor, and a reload restores it at step 1. Below the `lg` breakpoint the editor presents
full-screen; at `lg` and above it presents as the inline side pane. The wizard's own step content,
step order, validation gating and finish behaviour are unchanged by how it is opened.

#### Scenario: New task opens at step 1

- **WHEN** a creator clicks the "Add task" tile in any stage
- **THEN** the task editor opens with step 1 visible and the wizard progress indicator showing step
  1 of 3

#### Scenario: Existing task re-opens at step 1

- **WHEN** a creator clicks an existing task tile to edit it
- **THEN** the task editor opens at step 1, regardless of the step the wizard was on the last time
  this task was edited

#### Scenario: A restored task also opens at step 1

- **WHEN** a creator reloads the page while a task editor is open
- **THEN** the same task's editor is open at step 1, not at the step it was on before the reload

### Requirement: Step 1 captures geospatial placement
Step 1 of the wizard SHALL display a full-width map (`LocationPicker`) and a prominent "Locationless mission" toggle.

#### Scenario: Located mission shows the map
- **WHEN** the wizard is on step 1 and `task.locationless` is false (default)
- **THEN** the `LocationPicker` map is visible, and lat/lng coordinate inputs are shown below the map

#### Scenario: Locationless toggle hides the map
- **WHEN** a creator enables the "Locationless mission" toggle on step 1
- **THEN** `task.locationless` is set to `true`, the `LocationPicker` map is hidden, and a friendly explanation text is shown ("Teams complete this from anywhere — no map pin needed")

#### Scenario: Re-enabling the toggle restores the map
- **WHEN** a creator disables the "Locationless mission" toggle after previously enabling it
- **THEN** `task.locationless` is set to `false` and the `LocationPicker` map becomes visible again

#### Scenario: Step 1 forward navigation is always allowed
- **WHEN** a creator is on step 1 (regardless of whether a location has been set or not)
- **THEN** the "Next" button is enabled and advances to step 2

### Requirement: Step 2 captures mission metadata with title validation
Step 2 SHALL display mission name (required), difficulty, description, hint, and hint penalty, all labeled with "mission" wording. Forward navigation to step 3 SHALL be blocked until the mission name is non-empty.

#### Scenario: Mission name is required to advance
- **WHEN** a creator is on step 2 with `task.title` empty and clicks "Next"
- **THEN** navigation does NOT advance to step 3 and an inline validation hint is shown near the title input (e.g., "Mission name is required")

#### Scenario: Non-empty name enables forward navigation
- **WHEN** a creator enters at least one non-whitespace character in the mission name field on step 2
- **THEN** the "Next" button becomes enabled and clicking it advances to step 3

#### Scenario: All metadata fields are shown on step 2
- **WHEN** a creator is on step 2
- **THEN** the following fields are visible, labeled with "mission" wording: Mission Name input, Difficulty input (1–10), Description textarea, Hint textarea (optional), and Hint Penalty number input

### Requirement: Step 3 presents a visual interaction type picker
Step 3 SHALL display a 2-column card grid with all 8 `TaskType` values, each showing an icon, a plain-English label, and a 1-sentence description, using "mission" wording wherever the copy references the object being configured. Selecting a card SHALL immediately update `task.type`.

#### Scenario: All 8 mission types are shown in the grid
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

### Requirement: Builder header shows the active stage/mission breadcrumb
The Builder header SHALL display a persistent, live-updating label showing the currently selected stage and, if a mission is open in the wizard, the currently open mission, using the pattern "Stage {n}: {stage name} → Mission {n}: {mission name}". When no mission is open, the label SHALL show only "Stage {n}: {stage name}". Untitled stages/missions SHALL fall back to their existing placeholder names (e.g. "Untitled Stage", "Untitled Mission") rather than an empty string.

#### Scenario: Breadcrumb shows stage only when no mission is open
- **WHEN** a creator has selected a stage in `StageRail` and the `TaskWizard` panel is closed
- **THEN** the Builder header shows "Stage {n}: {stage name}" and no mission segment

#### Scenario: Breadcrumb shows stage and mission when the wizard is open
- **WHEN** a creator opens an existing mission tile (or the "Add mission" tile) in `TaskCanvas`, opening `TaskWizard`
- **THEN** the Builder header shows "Stage {n}: {stage name} → Mission {n}: {mission name}", where {n} for the mission is its 1-based position within the current stage's task list

#### Scenario: Breadcrumb updates live as the creator switches stages
- **WHEN** a creator selects a different stage in `StageRail` while the wizard is closed
- **THEN** the breadcrumb updates immediately to reflect the newly selected stage, without a page reload

#### Scenario: Breadcrumb updates live as the wizard's mission name changes
- **WHEN** a creator is on step 2 of the wizard and types into the mission name field
- **THEN** the breadcrumb's mission segment updates to reflect the in-progress title on each change (not only after save)

#### Scenario: Untitled stage or mission falls back to placeholder text
- **WHEN** the currently selected stage or open mission has an empty `title`
- **THEN** the breadcrumb shows the existing untitled-placeholder string for that item instead of an empty segment

#### Scenario: Breadcrumb text is sourced from i18n, not hardcoded
- **WHEN** the breadcrumb renders in either language
- **THEN** the "Stage" / "Mission" labels come from `t.*` translation keys with EN and HE entries, matching the app's existing i18n conventions

### Requirement: Pause-clock control is visually marked as advanced
The pause-clock (`pausesTimer`) control on wizard step 3 SHALL carry a small, explicit "advanced" visual marker directly on the control itself, in addition to its existing position below the "Advanced timing" divider, so its advanced status does not depend solely on scroll position within the group.

#### Scenario: Pause-clock control shows an advanced marker
- **WHEN** a creator has the `timerPoints` group open on wizard step 3
- **THEN** the pause-clock control's label includes a small advanced-tag marker distinct from the surrounding "Advanced timing" section divider text

#### Scenario: The marker does not change the control's behavior
- **WHEN** a creator toggles the pause-clock checkbox
- **THEN** `task.pausesTimer` is set/cleared exactly as before this change, with no change to validation, scoring, or persistence

#### Scenario: Marker text is sourced from i18n, not hardcoded
- **WHEN** the advanced marker renders in either language
- **THEN** its text comes from a `t.*` translation key with EN and HE entries, matching the app's existing i18n conventions

### Requirement: Step 3 opt-in chip labels describe their group's real contents
Each step 3 opt-in chip label, and the group title it expands into, SHALL describe in plain language what that group actually contains. A label SHALL NOT name only one member of a multi-purpose group in a way that misrepresents the rest. A chip and the group it opens SHALL use the same label text, so opening a chip never renames what the creator clicked. Group membership, chip order, chip styling, and the collapsed-by-default rule are unchanged.

#### Scenario: The timing/points chip and its group share one plain label
- **WHEN** a creator views the step 3 chip row and then opens the timing/points group
- **THEN** the chip label and the opened group's title are the same plain-language string describing points and timing

#### Scenario: The rules chip label reflects that the group governs unlocking and limits
- **WHEN** a creator views the chip for the group holding `unlockAfterTaskIds`, `requirePresence`, `tags`, and `maxConcurrentTeams`
- **THEN** its label describes unlocking and limits rather than the bare word "Rules", and does not name prerequisites alone as though that were the group's only content

#### Scenario: The already-clear hint chip is unchanged
- **WHEN** a creator views the chip for the hint group
- **THEN** its label is unchanged from before this change

#### Scenario: Group membership and behavior are untouched
- **WHEN** a creator opens any step 3 opt-in group after this change
- **THEN** it contains exactly the same fields as before, in the same order, with the same collapsed-by-default behavior and the same count badge semantics

#### Scenario: New labels obey the no-dash copy standard
- **WHEN** the new chip and group labels are scanned by the user-facing-copy dash check
- **THEN** none contains a hyphen, en dash, em dash, or other banned dash separator, and `scripts/test-no-dashes.ts` passes

#### Scenario: Labels exist in both languages
- **WHEN** the chip row renders in either language
- **THEN** every chip and group label resolves from a `t.*` key with both EN and HE entries, with HE pure Hebrew and EN pure English

