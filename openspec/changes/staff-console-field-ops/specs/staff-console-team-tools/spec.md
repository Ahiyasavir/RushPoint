## ADDED Requirements

### Requirement: Staff can search the team list
The mobile staff console SHALL let staff filter the team list by name instead of only scrolling a
flat list.

#### Scenario: Filtering narrows the visible teams
- **WHEN** a staffer types text into the team search field
- **THEN** only teams whose display name contains that text (case- and RTL/LTR-direction
  insensitive) remain visible in the score-adjustment list

#### Scenario: Clearing the search restores the full list
- **WHEN** a staffer clears the search field
- **THEN** every team in the run is visible again, in the existing score-descending order

### Requirement: Staff can award or deduct an arbitrary amount
The mobile staff console SHALL allow a score adjustment of any integer amount, not only the fixed
±5/±10 buttons.

#### Scenario: Staff enters a custom amount
- **WHEN** a staffer opens the custom-amount control for a team, enters an integer, and confirms
- **THEN** the same `adjustTeamScore` call already used by the ±5/±10 buttons is made with that
  amount as the delta, and the team's live score updates immediately

#### Scenario: A non-numeric or empty custom amount cannot be confirmed
- **WHEN** the custom-amount field is empty or not a valid integer
- **THEN** the confirm action is disabled and no call is made

### Requirement: A score adjustment can carry a reason
Every manual score adjustment made from the mobile staff console SHALL be able to carry a reason,
recorded alongside the adjustment in the system audit trail.

#### Scenario: Staff picks a preset reason
- **WHEN** a staffer adjusts a team's score and selects a preset reason category (e.g. "Creativity
  Bonus", "Late Penalty") instead of leaving it blank
- **THEN** that category is sent as the `reason` on the same `adjustTeamScore` call, and the
  resulting audit-log entry for this adjustment records that reason

#### Scenario: Staff writes a free-text reason
- **WHEN** a staffer selects "Other" (or an equivalent free-text option) and types a short reason
- **THEN** that text is sent as the `reason` on the `adjustTeamScore` call and recorded in the
  audit-log entry, subject to the same length limit the callable already enforces on `reason`

#### Scenario: A reason is optional, never required
- **WHEN** a staffer adjusts a team's score without selecting or typing any reason
- **THEN** the adjustment still succeeds — a reason is a transparency aid, not a precondition for
  awarding or deducting points

### Requirement: Staff can clear a team's out-of-bounds flag from the phone
The mobile staff console SHALL expose the existing out-of-bounds recovery action per team.

#### Scenario: Clearing out-of-bounds from the phone
- **WHEN** a team currently flagged `outOfBounds` is shown in the console and a staffer taps
  "clear out-of-bounds"
- **THEN** the existing `clearTeamOutOfBounds` callable is invoked for that team and the flag
  clears from the live view once the server confirms

#### Scenario: The control is hidden for a team that is not out of bounds
- **WHEN** a team's `outOfBounds` flag is not set
- **THEN** the clear action is not shown for that team

### Requirement: Staff can skip a stuck team's current task from the phone
The mobile staff console SHALL expose the existing per-team task-skip action.

#### Scenario: Skipping a team's current task from the phone
- **WHEN** a staffer taps "skip task" for a team with an active task
- **THEN** the existing `skipTaskForTeam` callable is invoked for that team and task, and the
  team's stage progress reflects the skip once the server confirms
