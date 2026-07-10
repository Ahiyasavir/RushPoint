# tv-leaderboard Specification (delta)

## MODIFIED Requirements

### Requirement: Organizer can generate the TV URL from the RunConsole
The creator RunConsole SHALL expose a one-tap "TV Screen" action that opens or copies the
`?tv=<accessCode>` URL for the active run. Before copying or opening, the action MUST ensure
the leaderboard is published: when the run's leaderboard is not yet published, the action first
calls `refreshLeaderboard` with `publish: true`, so the projection screen shows standings
immediately instead of the "not available" state. The existing visibility toggle remains the
way to un-publish afterwards.

#### Scenario: TV Screen button works
- **WHEN** the organizer taps "TV Screen" in the RunConsole
- **THEN** the `?tv=<accessCode>` URL is opened in a new tab or copied to clipboard

#### Scenario: Sharing publishes an unpublished board
- **WHEN** the organizer taps "TV Screen" (or copies the public leaderboard link) while the
  leaderboard is unpublished
- **THEN** the leaderboard is refreshed and published before the URL is copied/opened, and the
  TV screen renders standings on its next poll
