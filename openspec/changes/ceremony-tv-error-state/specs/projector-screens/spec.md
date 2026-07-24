# projector-screens

## ADDED Requirements

### Requirement: Projector screens distinguish a fetch error from a not-yet-published run

The Ceremony and TV projector screens SHALL distinguish a rejected `getPublicLeaderboard`
fetch from a run that is merely not yet published, showing a distinct, projector-legible error
line for the error case while continuing to poll, so a wrong access code no longer strands the
projector forever on the neutral "waiting to publish" holding screen.

The screens SHALL track an error flag set when the poll rejects and cleared on the next
successful fetch. They SHALL NOT stop polling on error, SHALL NOT change the poll cadence, and
SHALL leave the published-run happy path and the ordinary (no-error) not-yet-published holding
screen unchanged. The error line SHALL be rendered through `t.*` with correct HE and EN copy
and no em-dash.

#### Scenario: A fetch error shows a distinct error line and keeps polling, and a later-published run still appears

- **WHEN** the projector is opened with a wrong access code and `getPublicLeaderboard` rejects
- **THEN** the holding screen shows the distinct error line (via `t.tv.loadError` /
  `t.ceremony.loadError`) rather than the neutral "not available yet" / "waiting to publish"
  line, and the screen keeps polling on the unchanged cadence
- **AND WHEN** a valid run is subsequently published
- **THEN** the next successful poll clears the error flag and the screen comes alive on the
  live board / ceremony sequence as normal

#### Scenario: A transient blip self-heals

- **WHEN** one poll rejects (setting the error flag and the error line) and the following poll
  succeeds
- **THEN** the error flag clears and the screen returns to the normal holding or live render
  with no residual error line
