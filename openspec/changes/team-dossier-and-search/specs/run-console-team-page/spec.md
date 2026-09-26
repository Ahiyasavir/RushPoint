## ADDED Requirements

### Requirement: Every team opens a page with everything about it
The Run Console SHALL open a team page when the organizer selects a team, and the page SHALL show
the team's members and phones, which phone sends, its last known location and how old it is, its
current mission and how long it has been on it, a timeline of its stages and missions with status,
times, points and answers given, every media submission with its review state, its chat with the
organizer, and its score with the reasons for every manual change.

The team page SHALL be addressable in the console's URL.

#### Scenario: Open a team
- **GIVEN** a live run where a team has submitted a photo and answered a quiz
- **WHEN** the organizer selects that team in the teams list
- **THEN** the team page shows the photo with its review state and the quiz answer in the timeline

#### Scenario: Refresh keeps the page
- **WHEN** the organizer refreshes the console while a team page is open
- **THEN** the same team page is open after the reload

### Requirement: Organizer actions are available from the team page
The team page SHALL let the organizer message the team, change its score with a reason, review its
media, skip its current mission, and hold or release it, using the same operations as the rest of
the console.

#### Scenario: Add points with a reason
- **WHEN** the organizer adds 20 points to a team with the reason "great costume"
- **THEN** the team's score rises by 20
- **AND** the team page lists that change with its reason and who made it

### Requirement: Every score change is recorded on the team
The platform SHALL record on the team, for every manual adjustment, paid hint, skip consolation and
approval reversal, the change, its kind, the time, the reason when given and the operator's display
name, keeping the latest 100 entries. This record SHALL NOT be sent to participants.

#### Scenario: The record is organizer-only
- **WHEN** a participant loads its team state
- **THEN** the score change record is not included

### Requirement: Teams can be searched and filtered
The teams list SHALL offer a search over team names, member names, phone names and team codes, and
filters for teams needing attention, waiting for review, not started and finished.

#### Scenario: Find a team by a member's name
- **GIVEN** 40 teams where one team has a member named "דנה"
- **WHEN** the organizer types "דנ" in the search
- **THEN** that team is listed
