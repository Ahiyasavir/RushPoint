## ADDED Requirements

### Requirement: SOS/alert cards identify the team by its display name

The Staff console SHALL identify the team on each SOS / alert card by the team's human-readable
display name, using the team roster already loaded for that run, so a marshal responding to an
emergency can tell which team needs help without decoding a uid.

When no display name is available for the alert's team, the card SHALL fall back to a short prefix of
the team id, matching the fallback the console's chat section already uses.

The alert content, its coordinates link, and the acknowledge action SHALL be unchanged. No additional
data SHALL be fetched — the resolution SHALL use the roster already in the console's state.

#### Scenario: A named team triggers an alert

- **WHEN** a team with a loaded display name triggers SOS or a stuck-help alert
- **THEN** the alert card shows that team's display name

#### Scenario: The team's name has not loaded yet

- **WHEN** an alert arrives for a team whose roster row is not yet in state
- **THEN** the alert card shows the short team-id prefix as before
