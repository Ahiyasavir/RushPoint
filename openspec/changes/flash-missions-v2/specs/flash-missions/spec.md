## ADDED Requirements

### Requirement: A flash mission can be taken and done
An operator SHALL be able to publish a flash mission during a live run that teams can take, with a
choice of whether only the first team or any team may take it, and how it is done (announcement only,
a done button, a photo, or a video). A team that takes it SHALL have its current mission paused, with
the mission's time limit not running, and SHALL return to that mission when it finishes or gives up the
flash mission, or when the flash mission ends.

#### Scenario: First team only
- **GIVEN** a flash mission for the first team only
- **WHEN** team A takes it
- **THEN** team B sees that it was taken by team A and cannot take it

#### Scenario: Back to the mission
- **GIVEN** team A was on mission M with 10 minutes left when it took a flash mission
- **WHEN** team A finishes the flash mission 6 minutes later
- **THEN** team A is back on mission M with 10 minutes left

### Requirement: Flash-mission points are recorded as such
Points for a flash mission SHALL be added to the team's score as a flash-mission award in the team's
score history, on approval or automatically when no approval is required, and SHALL be removed if the
approval is reversed.

#### Scenario: Approve a flash photo
- **WHEN** the organizer approves team A's flash photo worth 25 points
- **THEN** team A's score rises by 25
- **AND** its score history names the flash mission

### Requirement: The organizer controls a running flash mission
The organizer console SHALL show each active flash mission's time left and takers, and SHALL let the
organizer end it early, approve or reject a submission, and award it to a chosen team.

#### Scenario: End early
- **WHEN** the organizer ends an active flash mission
- **THEN** it disappears from the players' screens
- **AND** every team that had taken it returns to its mission

### Requirement: A flash mission arrives as an event
When a flash mission is published, players SHALL see a full-screen announcement with a sound and a
short animation (and vibration where the phone supports it), followed by a banner with a countdown and
the action to take it. The join screen SHALL ask players to turn the volume up and silent mode off.

#### Scenario: Arrival
- **WHEN** a flash mission is published
- **THEN** every playing phone shows the announcement with a sound

### Requirement: Removing a team gives back the flash mission it holds
When the organizer removes a team that has taken a flash mission and not yet sent it, the system SHALL
release that team's claim and end its suspension in the same step, so a first-team-only flash mission
becomes available to the other teams again.

#### Scenario: The removed team held a first-team mission
- **GIVEN** team A took a first-team-only flash mission and has not sent it
- **WHEN** the organizer removes team A
- **THEN** team A's claim reads released
- **AND** team B can take the flash mission

### Requirement: A flash mission waiting for approval reaches the people who approve it
A flash mission a team sent for approval SHALL appear in the console's "now" list with how long it
has waited, marked urgent from the same 20 seconds as a mission submission, and its row SHALL open
the flash-mission panel. The staff app SHALL list the same waiting flash missions to a staff member
allowed to review, with approve and reject, and SHALL let a staff member allowed to broadcast end a
running flash mission early.

#### Scenario: A photo flash mission waits
- **GIVEN** a team sent a photo for a flash mission that needs approval 25 seconds ago
- **THEN** the console's "now" list shows it as urgent
- **AND** a reviewing staff member sees it in the staff app with approve and reject

### Requirement: Taking a flash mission does not cost every phone a read
A team's claim on a flash mission SHALL be stored with that team, not on the flash mission that every
phone in the run watches. In "any team" mode, taking and sending a flash mission SHALL NOT change the
flash mission's document; in "first team only" mode the document SHALL change only when the mission
becomes taken or free again.

#### Scenario: Many teams take the same flash mission
- **GIVEN** an "any team" flash mission
- **WHEN** two teams take it and send it
- **THEN** the flash mission's document is unchanged
- **AND** each team's own record shows its claim and its sending
