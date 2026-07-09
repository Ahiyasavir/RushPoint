# hot-zone-bonus Specification

## Purpose
TBD - created by archiving change hot-zone-bonus. Update Purpose after archive.
## Requirements
### Requirement: Organizer can activate a timed geofenced multiplier
An `activateHotZone` callable SHALL let the organizer (or staff) set a center, radius, multiplier,
and duration on a run, and a `deactivateHotZone` callable SHALL clear it. The hot zone MUST be stored
on the run with a server-stamped start and expiry.

#### Scenario: Activation writes a bounded hot zone
- **WHEN** the organizer activates a hot zone with a center, radius, 2× multiplier, and 5-minute duration
- **THEN** `run.hotZone` is written with `startedAt = now` and `expiresAt = now + 5min`

#### Scenario: Only one active zone at a time
- **WHEN** a hot zone is activated while another is active
- **THEN** the new zone replaces the old one (a single active zone per run)

### Requirement: The multiplier is enforced server-side within radius and window
Task completions SHALL earn multiplied points only when they occur within the hot-zone radius and
time window, decided by `hotZoneMultiplier` using the server-validated location and server clock. The
multiplier MUST never be applied based on client assertion.

#### Scenario: In-zone, in-window completion is multiplied
- **WHEN** a team completes a task inside the radius while the zone is active
- **THEN** the earned score is multiplied by the zone multiplier

#### Scenario: Out-of-zone or out-of-window completion is not multiplied
- **WHEN** a completion is outside the radius, before the start, or after expiry
- **THEN** `hotZoneMultiplier` returns 1 and the score is not multiplied

#### Scenario: Missing coordinates do not multiply
- **WHEN** `hotZoneMultiplier` is given no coordinates
- **THEN** it returns 1

### Requirement: Participants see the active hot zone
While a hot zone is active, the participant app SHALL show a "🔥 Hot Zone active!" banner with a
countdown and the zone drawn on the map.

#### Scenario: Hot zone banner and map indicator
- **WHEN** a hot zone is active during a run
- **THEN** participants see a countdown banner and a zone circle on the map that disappear on expiry

