# solo-registration Specification

## Purpose
TBD - created by archiving change solo-mode-registration. Update Purpose after archive.
## Requirements
### Requirement: Solo mode collects a single name
When a run's mode is `individual`, the join registration form SHALL collect exactly one name for the
participant and SHALL NOT present both a team name and a player name.

#### Scenario: Solo join shows one name field
- **WHEN** a participant joins a run whose `mode` is `individual`
- **THEN** the form shows a single name input labeled "Your name" (Hebrew: "השם שלך"), with no
  team-name field, no "Team members" list, and no "Add member" button

#### Scenario: Solo display name is the single name
- **WHEN** a solo participant enters their name and submits
- **THEN** `resolveDisplayName('individual', values, memberNames)` returns that single name and it is
  sent to `joinRun` as `displayName`

#### Scenario: Team mode is unchanged
- **WHEN** a participant joins a run whose `mode` is `team`
- **THEN** the form shows the team-name field, the member list, and the "Add member" button exactly
  as before, and `resolveRegistrationFields('team', fields)` returns the fields unchanged

---

### Requirement: Registration field resolution is a pure, tested helper
The mode-aware field and display-name logic SHALL live in `@rushpoint/shared` as pure functions so it
is unit-tested without rendering.

#### Scenario: Individual mode drops the team name field
- **WHEN** `resolveRegistrationFields('individual', fields)` is called with a team-level name field, a
  member-level name field, and a custom field
- **THEN** the result contains exactly one name field (the member name) and the custom field, and no
  team-level name field

