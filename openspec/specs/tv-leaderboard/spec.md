# tv-leaderboard Specification

## Purpose
TBD - created by archiving change tv-leaderboard. Update Purpose after archive.
## Requirements
### Requirement: A full-screen TV display renders the live standings
A `?tv=<accessCode>` route in play-web SHALL render a full-screen, auto-refreshing leaderboard
optimised for projection. It MUST use the existing `getPublicLeaderboard` callable (published gate
enforced) and MUST auto-refresh at least every 15 seconds without organizer intervention.

#### Scenario: Published run renders on the TV screen
- **WHEN** an organizer opens `<playBaseUrl>/?tv=<accessCode>` for a published run
- **THEN** the full-screen standings display shows rank, team name, score, and time for each team

#### Scenario: Unpublished run is not exposed
- **WHEN** `?tv=` is opened for an unpublished run
- **THEN** the screen shows a "not available" state (same published gate as the public leaderboard)

#### Scenario: Display auto-refreshes
- **WHEN** the TV screen is open and standings change
- **THEN** the display updates within 15 seconds without any manual action

### Requirement: Top-team change triggers a visual highlight
The TV display SHALL detect when the leading team changes between refreshes and MUST fire a visible
animation or highlight on the new leader, creating a social moment at the venue.

#### Scenario: New leader animation fires
- **WHEN** a refresh brings a different team to the top of the standings
- **THEN** that team's row receives a "Now in the lead!" highlight animation

### Requirement: Organizer can generate the TV URL from the RunConsole
The creator RunConsole SHALL expose a one-tap "TV Screen" action that opens or copies the
`?tv=<accessCode>` URL for the active run.

#### Scenario: TV Screen button works
- **WHEN** the organizer taps "TV Screen" in the RunConsole
- **THEN** the `?tv=<accessCode>` URL is opened in a new tab or copied to clipboard

