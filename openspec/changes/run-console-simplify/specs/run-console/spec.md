## ADDED Requirements

### Requirement: The live console has three task-based screens
The organizer's live console SHALL offer exactly three screens, always reachable from a visible tab
bar: Now (what is waiting for the organizer), Teams (map, list and standings), and Game (actions that
affect every team). Setup and sharing tools and after-run reports SHALL be reached from a menu, not
from the live tabs. Every capability of the previous console SHALL remain reachable.

#### Scenario: Opening a live run
- **WHEN** the organizer opens a live run that has teams
- **THEN** the Now screen is shown

#### Scenario: Nothing is lost
- **GIVEN** any tool the previous console offered
- **THEN** it is reachable from one of the three screens or the menu

### Requirement: Now lists everything waiting for the organizer
The Now screen SHALL list, in one list, every item waiting for the organizer: submissions to review,
safety alerts, unread team and staff messages, stuck teams, teams waiting to start, and reported feed
posts. Urgent items SHALL come first, then the oldest. Each item SHALL show how long it has waited and
offer its primary action. When nothing is waiting, the screen SHALL say so.

#### Scenario: A photo and an SOS
- **GIVEN** a photo waiting 40 seconds and an SOS raised 10 seconds ago
- **THEN** the SOS is listed first and the photo second
- **AND** each shows its waiting time and its action

#### Scenario: Nothing waiting
- **GIVEN** nothing is waiting
- **THEN** the Now screen says that nothing needs the organizer

### Requirement: Every team action is on the team
Clicking a team in the Teams list or on its map SHALL open that team's page, and the page SHALL offer
every action that applies to a single team.

#### Scenario: Pause from the team page
- **WHEN** the organizer opens a team's page
- **THEN** starting, pausing, sending to a mission, sending back, skipping, points, messaging and
  removing are all available there
