## ADDED Requirements

### Requirement: An organizer can start one team
The Run Console SHALL let the run's owner start a single team that has not started, from the team's
row and from its page, without starting any other team. The same holds that apply when starting all
teams SHALL apply, and the console SHALL say why a team was held instead of started.

#### Scenario: Start one of two waiting teams
- **GIVEN** a live run with two registered teams A and B
- **WHEN** the organizer starts team A
- **THEN** team A is playing
- **AND** team B is still waiting to start

#### Scenario: A held team is explained
- **GIVEN** a team whose guardian consent is missing
- **WHEN** the organizer starts that team
- **THEN** the team is not started
- **AND** the console says it is waiting for a guardian's consent

### Requirement: An organizer can pause and resume a team
The Run Console SHALL let the run's owner pause one team and resume it. While paused the team SHALL
not be able to advance, its race clock SHALL not run, and the console SHALL mark it as paused.

#### Scenario: Pause from the console
- **WHEN** the organizer pauses a playing team
- **THEN** the team's submissions are refused until it is resumed
- **AND** the team appears as paused in the team list

### Requirement: An organizer can remove a team from the game and bring it back
The platform SHALL let the run's owner or a platform admin remove one team from a live run without
deleting any of its data, and SHALL let them bring it back. A removed team SHALL NOT be able to
advance, SHALL NOT appear in live, published or final standings, SHALL NOT be started by starting all
teams, SHALL NOT hold station capacity, and SHALL still be able to send SOS. Its phones SHALL show that
the organizers removed it from the game. Removing and restoring SHALL be recorded in the audit log.

#### Scenario: A removed team leaves the standings
- **GIVEN** a live run where team T has 120 points and is ranked first
- **WHEN** the organizer removes team T
- **THEN** the live standings no longer list team T
- **AND** team T's submissions are refused
- **AND** team T's data is unchanged apart from the removal record

#### Scenario: SOS still works for a removed team
- **GIVEN** a removed team
- **WHEN** a member sends SOS
- **THEN** the alert reaches the organizers

#### Scenario: Bringing a team back
- **GIVEN** a removed team
- **WHEN** the organizer brings it back
- **THEN** it can play again and is ranked again

#### Scenario: Only the owner can remove
- **WHEN** a participant, a stranger or a staff member of the run tries to remove a team
- **THEN** the call is denied

### Requirement: A team on the live map opens its page
The Run Console's live map SHALL open a team's page when the organizer clicks that team's marker.

#### Scenario: Click a team on the map
- **WHEN** the organizer clicks team T on the live map
- **THEN** team T's page opens
