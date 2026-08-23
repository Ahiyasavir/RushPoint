## ADDED Requirements

### Requirement: A team the server held back at start is told that it was held

The participant app SHALL tell a team that the server held back at start that it was held back,
rather than showing it the same waiting-for-the-host state shown to a team the run has simply not
started for.

The notice SHALL state that the team is not waiting on the start, SHALL NOT attribute the hold to
anything the participant did, and SHALL point them at the host as the way it gets resolved. It SHALL
reuse the host-help affordance already present on that screen.

The server SHALL carry the hold as a read-only reason on the participant's own team state. It SHALL
NOT carry a guardian's name, contact details, consent token, or any other personal data of a third
party in order to explain the hold.

#### Scenario: A team held for guardian consent

- **WHEN** the organizer starts the cohort and the server holds this team back because the run
  requires guardian consent and none is recorded
- **THEN** the team's waiting screen says it was held back pending the host's approval step, does not
  claim the run has not started, does not blame the participant, and offers the existing host-help
  affordance

#### Scenario: A team that is simply waiting for the start

- **WHEN** the run has not been started and no hold applies to the team
- **THEN** the waiting screen is unchanged and shows no hold notice

### Requirement: An unrecognized hold reason degrades to a safe generic notice

The mapping from the server's hold state to the notice SHALL be a pure, total function. Any input,
including a missing, empty, malformed, non-string or unrecognized reason, SHALL produce a notice
value rather than an error or an empty screen, and SHALL NOT assert a cause the server did not state.

#### Scenario: A reason this app version does not know

- **WHEN** the server reports a hold reason the participant app does not recognize
- **THEN** the screen shows a generic held notice pointing at the host, names no specific cause, and
  is never blank

#### Scenario: An older client or an older server sends no hold state at all

- **WHEN** the team state carries no hold reason
- **THEN** no hold is claimed and the ordinary waiting copy is shown

#### Scenario: A team that was held and has since been started

- **WHEN** the team's state reports that it has been started, whatever hold reason accompanies it
- **THEN** no hold notice is shown

### Requirement: The participant app cannot clear a hold

The participant app SHALL NOT offer any control that grants, attests, bypasses, or dismisses a hold
the server applied. Releasing a held team SHALL remain a server decision reached through the
organizer's start path.

#### Scenario: The held screen offers no way out but the host

- **WHEN** a held team views its waiting screen
- **THEN** the only affordance offered is the existing route to a human, and no control on that
  screen changes the team's hold state or launches the team

### Requirement: The organizer can see which teams are held, not only how many

The organizer's run team listing SHALL indicate, per team, whether that team is currently held back
from starting, so the console identifies the affected teams by name. The indication SHALL be a
boolean state only and SHALL NOT include any personal data of a guardian or third party.

If the server cannot determine the hold state for the listing, every row SHALL report "not held"
rather than the listing failing.

#### Scenario: Held teams are identifiable in the run console

- **WHEN** the organizer starts a cohort and some teams are held back
- **THEN** the run console marks each held team's own row, in addition to reporting the count

#### Scenario: The hold state cannot be determined

- **WHEN** the server cannot read the configuration needed to decide the hold state
- **THEN** the team listing still returns and every row reports "not held"
