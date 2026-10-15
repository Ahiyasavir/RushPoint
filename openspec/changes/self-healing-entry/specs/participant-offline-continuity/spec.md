## MODIFIED Requirements

### Requirement: A fatal sync error still surfaces
The app SHALL surface the recoverable error screen (retry + leave) when a team-state poll fails with a
fatal code (`not-found`, `permission-denied`), so a deleted/pruned run does not trap the participant
behind a stale screen.

A poll refused for a missing sign-in (`unauthenticated`) SHALL first go through automatic sign-in
recovery (participant-identity-recovery). While recovery is pending the screen MAY show the
"reconnecting" indicator. Once recovery has failed, the app SHALL NOT keep showing "reconnecting":
it SHALL tell the participant that the phone lost its sign-in and offer to rejoin their team.

#### Scenario: A deleted run shows the error screen
- **WHEN** a poll fails with `not-found`
- **THEN** the participant sees the error screen with retry and leave actions

#### Scenario: A lost sign-in mid-game is not "reconnecting" forever
- **WHEN** a poll is refused for a missing sign-in while the play screen has state, and automatic
  recovery fails
- **THEN** the participant sees that the phone lost its sign-in and a one-tap rejoin of their team,
  instead of an indefinite "reconnecting" indicator
