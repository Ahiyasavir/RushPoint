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

### Requirement: Smart routing is biased toward an active hot zone
The task routing engine SHALL favor assigning a team to a candidate task whose location is within an active hot zone's `radiusMeters` over an otherwise-comparable candidate task outside the zone, using the same activation/eligibility rule already used for the score multiplier (a zone exists, its multiplier is greater than 1, and the current time is within `[startedAt, expiresAt]`). The bias SHALL be additive to the existing load/transit/skill routing factors — it MUST NOT act as a hard filter that excludes out-of-zone tasks, and a sufficiently better out-of-zone task (e.g. far less loaded, far closer) MAY still be chosen over a poorly-suited in-zone task. A task with no location (a locationless task) SHALL NOT receive the bias, since it has no coordinates to evaluate against the zone.

#### Scenario: An in-zone task is preferred over an equivalent out-of-zone task
- **WHEN** a hot zone is active and two open candidate tasks have identical load, transit, and difficulty, but only one task's location falls within the zone's radius
- **THEN** the in-zone task receives a higher routing score and is the one assigned

#### Scenario: The bias does not apply when no hot zone is active
- **WHEN** no hot zone is active on the run (none activated, or the previous one has expired)
- **THEN** routing scores are computed exactly as before this change, with no bonus applied

#### Scenario: The bias is a nudge, not an override
- **WHEN** an in-zone task is heavily loaded (near its `maxConcurrentTeams` cap) or far from the team, while a comparable out-of-zone task is unloaded and close
- **THEN** the out-of-zone task's routing score MAY still exceed the in-zone task's score

#### Scenario: Locationless tasks are unaffected
- **WHEN** a hot zone is active and a candidate task is locationless (has no coordinates)
- **THEN** that task's routing score does not receive the hot-zone bonus

