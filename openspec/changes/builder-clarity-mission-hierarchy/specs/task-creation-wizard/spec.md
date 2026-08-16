## MODIFIED Requirements

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

## ADDED Requirements

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
