# participant-offline-continuity Specification (delta)

## ADDED Requirements

### Requirement: The play screen stays populated through a transient connectivity drop
The app SHALL keep the last-known play state rendered with a non-blocking "reconnecting" indicator
when a team-state poll fails for a transient reason (network offline, `unavailable`, `internal`,
`deadline-exceeded`) and the screen already has state. It MUST NOT replace the running game with a
full-screen error for a transient failure.

#### Scenario: A momentary drop keeps the game on screen
- **WHEN** the device goes offline mid-game and a poll fails
- **THEN** the last-known play state stays rendered with a "reconnecting" indicator, not a full-screen
  error

### Requirement: A fatal sync error still surfaces
The app SHALL surface the recoverable error screen (retry + leave) when a team-state poll fails with a
fatal code (`not-found`, `permission-denied`, `unauthenticated`), so a deleted/pruned run does not
trap the participant behind a stale screen.

#### Scenario: A deleted run shows the error screen
- **WHEN** a poll fails with `not-found`
- **THEN** the participant sees the error screen with retry and leave actions

### Requirement: Reconnection resumes immediately
The app SHALL react to the browser `online` event by refreshing team state immediately, and while
reconnecting SHALL retry on a short interval, so recovery does not wait for the slow fallback poll.

#### Scenario: Coming back online resumes at once
- **WHEN** the device regains connectivity after a drop
- **THEN** the app refreshes team state immediately and clears the reconnecting indicator on success
