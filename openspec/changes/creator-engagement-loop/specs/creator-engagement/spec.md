## ADDED Requirements

### Requirement: Creators see a red badge for real activity on their games

The creator console SHALL show a notification bell with a red count badge for items newer than the
creator's last look, and every item SHALL describe real activity on that creator's own games.

#### Scenario: First team joins a real run
- **WHEN** the first team joins a run that is not a test drive
- **THEN** one `firstJoin` item is written for the owner, and a retried join does not write a second

#### Scenario: Test drive stays silent
- **WHEN** a team joins a test-drive run
- **THEN** no notification is written

#### Scenario: Opening the sheet clears the badge
- **WHEN** the creator opens the notification sheet
- **THEN** `notificationsSeenAt` is stamped and the badge shows no count

#### Scenario: A writer failure never fails the action
- **WHEN** writing a notification throws
- **THEN** the join, like or finalize that triggered it still succeeds

### Requirement: A game can carry its event date

A game SHALL accept an optional `eventAt`, and the dashboard SHALL show a countdown to it while the
game is not yet launched for real.

#### Scenario: Countdown items
- **WHEN** the event is 3 days away, 1 day away or today, and the game has setup still open
- **THEN** one `eventSoon` item per threshold is written for the owner
