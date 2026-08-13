## ADDED Requirements

### Requirement: Two top-level location/trigger choices
The Builder's task editor SHALL present exactly two top-level location/trigger choices —
"Anywhere" and "Specific Location" — instead of four (Radius, Exact, Instant, Anywhere) or three
(Located, Instant, Anywhere).

#### Scenario: Creator opens the trigger-mode picker
- **WHEN** a creator opens a task's trigger-mode selector in the Builder
- **THEN** they see exactly two choices: Anywhere and Specific Location

#### Scenario: Anywhere has no visible technical detail
- **WHEN** a creator selects "Anywhere"
- **THEN** no radius, GPS-check, or hide-location control is shown, and the task's stored
  `triggerMode` SHALL be `'locationless'`

#### Scenario: Specific Location defaults with no visible technical detail
- **WHEN** a creator selects "Specific Location" and does not open Advanced
- **THEN** the task's stored `triggerMode` SHALL be `'radius'` with the default 40m
  `geofenceRadiusMeters`, and no radius number is shown at the top level

### Requirement: Advanced panel nested under Specific Location
Every technical control — radius number, skip-GPS-check, hide-location — SHALL render inside a
single Advanced panel that only appears when "Specific Location" is selected.

#### Scenario: Radius controls the underlying trigger mode
- **WHEN** a creator opens Advanced under "Specific Location" and sets the radius to 4 meters or
  less
- **THEN** the task's stored `triggerMode` SHALL be `'exact'`

#### Scenario: Radius above the tight threshold
- **WHEN** a creator opens Advanced under "Specific Location" and sets the radius above 4 meters
- **THEN** the task's stored `triggerMode` SHALL be `'radius'`

#### Scenario: Skip GPS check preserves location and routing
- **WHEN** a creator enables "Skip GPS check" under Specific Location's Advanced panel
- **THEN** the task's stored `triggerMode` SHALL be `'instant'`, and the task SHALL retain its
  `coordinates` and continue to be included in routing/transit calculations exactly as a
  `'radius'`/`'exact'` task would

#### Scenario: Anywhere has no Advanced panel
- **WHEN** a creator selects "Anywhere"
- **THEN** no Advanced panel is shown, since there is no located-task detail to configure

#### Scenario: Hide-location lives inside Specific Location's Advanced panel
- **WHEN** a creator opens Advanced under "Specific Location"
- **THEN** the "Hide location" toggle and its clue field are shown there, not in a separate,
  disconnected section of the form

### Requirement: Existing tasks are unaffected on load
Opening a previously-authored task in the redesigned editor SHALL NOT change its stored
`triggerMode`, `geofenceRadiusMeters`, `hideLocation`, or `locationClue` merely from being viewed.

#### Scenario: A task saved as `'exact'` still reads as Specific Location with a tight radius
- **WHEN** a task with `triggerMode: 'exact'` is opened
- **THEN** the editor shows "Specific Location" selected with its Advanced radius control at the
  task's saved (tight) radius, without altering the stored value

#### Scenario: A task saved as `'instant'` still shows its map pin
- **WHEN** a task with `triggerMode: 'instant'` is opened
- **THEN** the editor shows "Specific Location" selected with "Skip GPS check" enabled and the
  task's saved coordinates intact
