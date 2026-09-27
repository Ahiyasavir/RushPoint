# safe-zone Specification

## Purpose
TBD - created by archiving change safe-zone-boundary. Update Purpose after archive.
## Requirements
### Requirement: Organizer defines a safe-zone boundary
A creator SHALL be able to define a safe zone (center + radius) for a game/run. When no safe zone is
configured, behavior is unchanged.

#### Scenario: Safe zone is configured on the game
- **WHEN** the creator sets a safe-zone center and radius in the Builder
- **THEN** the run carries the safe-zone configuration

### Requirement: Breaches are detected server-side and auto-alert the organizer

The location-update path SHALL decide whether a team is out of bounds server-side, from a **pure
total evaluation** of the team's last known fix — its coordinates, its reported accuracy radius and
its age — against the configured safe zone, the server's clock, and any active staff override. The
evaluation SHALL NEVER throw and SHALL report the reason for its verdict.

The evaluation SHALL fail **open**: when no fix has been reported, when the coordinates are missing
or not finite, when the fix is older than the staleness limit or its age is unknown, or when the fix
is too imprecise to place the team relative to the boundary, the team SHALL NOT be treated as out of
bounds.

A fix SHALL be treated as outside only when it lies beyond the boundary by more than its own reported
accuracy radius, and a fix whose accuracy is worse than the trust ceiling SHALL NEVER flag a team.

On a new, verified breach the system MUST raise an alert to the organizer (reusing the existing alert
surface) and set the team's `outOfBounds` flag; when a later evaluation is anything other than a
verified breach, the flag MUST be cleared.

#### Scenario: Out-of-zone location raises an alert
- **WHEN** a team reports a confident, current location outside the safe zone for the first time
- **THEN** an alert is created for the organizer and the team is flagged out-of-bounds

#### Scenario: Returning inside clears the flag
- **WHEN** the team reports a location back inside the safe zone
- **THEN** the out-of-bounds flag is cleared

#### Scenario: Breach predicate boundary behavior
- **WHEN** `isOutsideSafeZone` is given coords exactly on the radius
- **THEN** it returns false (on-boundary is inside)
- **WHEN** given coords beyond the radius
- **THEN** it returns true

#### Scenario: A low-confidence fix does not flag a team
- **WHEN** a team's reported position lies outside the boundary by less than the fix's own accuracy radius
- **THEN** the verdict is low confidence and the team is NOT flagged out-of-bounds

#### Scenario: A fix worse than the trust ceiling never flags a team
- **WHEN** a team reports a position far outside the zone with an accuracy radius worse than the trust ceiling
- **THEN** the verdict is low confidence and the team is NOT flagged out-of-bounds

#### Scenario: Missing or malformed coordinates are not a violation
- **WHEN** no fix has ever been reported for a team, or the last fix has missing or non-finite coordinates
- **THEN** the evaluation returns without throwing and the team is NOT flagged out-of-bounds

#### Scenario: A device clock ahead of the server is not treated as stale
- **WHEN** the last fix carries a timestamp in the server's future
- **THEN** its age is treated as zero and the position verdict is computed normally

### Requirement: An out-of-bounds team is soft-paused and warned

While a team is verifiably out of bounds, the participant app SHALL show a "head back to the play
area" warning and the system MUST NOT assign new tasks until the team returns inside.

The out-of-bounds condition SHALL NOT be able to outlive the evidence that produced it. Before the
flag is allowed to withhold a task, the system SHALL re-evaluate it against the team's last known
fix; if that evaluation is anything other than a verified breach — the fix is stale, absent,
malformed, low-confidence, overridden, or now inside the zone — the system SHALL clear the flag and
assign a task normally.

A participant SHALL NEVER be left in a state that only a signal their device cannot produce could
clear.

#### Scenario: No new task while out of bounds
- **WHEN** a team is flagged out-of-bounds and its last fix is current, confident and outside the zone
- **THEN** the participant sees the warning and no new task is assigned until they return inside

#### Scenario: A device that stops reporting releases its team
- **WHEN** a flagged team's last known fix has aged past the staleness limit
- **AND** the team requests its next task
- **THEN** the flag is cleared and a task is assigned

#### Scenario: A team flagged by an inaccurate fix is released
- **WHEN** a flagged team's last known fix is too imprecise to place it outside the boundary
- **AND** the team requests its next task
- **THEN** the flag is cleared and a task is assigned

#### Scenario: A team that walked back in without pinging is released
- **WHEN** a flagged team's last known fix is inside the zone
- **AND** the team requests its next task
- **THEN** the flag is cleared and a task is assigned

### Requirement: A safe-zone boundary is validated before it is stored

The system SHALL validate a safe-zone boundary before persisting it, so the enforcement path can
never read a boundary the system would not have accepted. A boundary SHALL be accepted only with a
finite centre latitude within the valid latitude range, a finite centre longitude within the valid
longitude range, and a finite radius that is strictly positive and no larger than a documented
maximum.

An absent boundary SHALL mean "unchanged". An explicit clear SHALL remove the boundary. A present but
malformed boundary SHALL be refused rather than stored.

An accepted boundary SHALL be stored as centre and radius only, so no additional client-supplied
keys ride into a field the safety path reads.

#### Scenario: A well-formed boundary is accepted

- **WHEN** a game update supplies a centre in range and a positive radius within the maximum
- **THEN** the boundary is stored as centre and radius

#### Scenario: Non-finite coordinates are refused

- **WHEN** a boundary's latitude or longitude is not a finite number
- **THEN** the update is refused and no boundary is stored

#### Scenario: Out-of-range coordinates are refused

- **WHEN** a boundary's latitude is outside the valid latitude range, or its longitude is outside the valid longitude range
- **THEN** the update is refused

#### Scenario: A non-positive radius is refused

- **WHEN** a boundary's radius is zero or negative
- **THEN** the update is refused, because a zero radius is a boundary every team is outside of rather than an absent boundary

#### Scenario: An absurd radius is refused

- **WHEN** a boundary's radius exceeds the documented maximum
- **THEN** the update is refused

#### Scenario: Clearing the boundary is allowed

- **WHEN** a game update explicitly clears the safe zone
- **THEN** the boundary is removed and location handling returns to unbounded behavior

#### Scenario: Omitting the boundary changes nothing

- **WHEN** a game update omits the safe zone
- **THEN** the stored boundary is left exactly as it was

### Requirement: The creator can author the safe-zone boundary

A creator SHALL be able to turn a safe-zone boundary on, adjust it, and remove it from the game
builder. The setting the server enforces SHALL NOT be reachable only by hand-editing a game file.

The builder SHALL offer a boundary derived from the stops the creator has already placed, so a
creator sets a play area without composing coordinates by hand. The derivation SHALL be a pure
function of the game's stages: it SHALL ignore stops that carry no usable location, SHALL contain
every stop that does, and SHALL report when the stops are spread too wide to be contained.

Clearing the boundary SHALL be sent as an explicit clear and SHALL remove the stored boundary. An
omitted boundary SHALL leave the stored value untouched.

#### Scenario: A boundary is fitted to the game's stops

- **WHEN** the creator turns the play area on for a game with at least one placed stop
- **THEN** the game receives a boundary centred on the extent of those stops, with a radius that
  contains all of them plus walking room

#### Scenario: A game with no placed stop cannot fit an area

- **WHEN** no stop of the game carries a usable location
- **THEN** no boundary is offered, and the creator is told why

#### Scenario: Stops spread too wide are reported

- **WHEN** the game's stops are spread further apart than the maximum permitted radius
- **THEN** the suggested boundary is capped at the maximum and the creator is warned that some stops
  fall outside it

#### Scenario: Removing the boundary actually removes it

- **WHEN** the creator removes the play area and the game is saved
- **THEN** the stored boundary is deleted and location handling returns to unbounded behavior

#### Scenario: The boundary is part of the builder's saved payload

- **WHEN** the creator changes or clears the play area
- **THEN** the game is marked unsaved and the change is included in the update sent to the server

### Requirement: The file-import door validates the boundary on the same terms

A game restored from a file SHALL have its safe-zone boundary validated on exactly the same terms as
one authored in the builder, and SHALL be stored as centre and radius only. A file MUST NOT be able
to write a boundary that an authored game would have been refused.

#### Scenario: A malformed boundary in a file is refused

- **WHEN** a game file supplies a boundary with a non-finite coordinate, a non-positive radius, or a
  radius beyond the maximum
- **THEN** the import is refused and no game is created

#### Scenario: Extra keys in a file boundary are dropped

- **WHEN** a game file supplies a valid boundary carrying additional keys
- **THEN** only the centre and radius are stored

### Requirement: Staff can release a team from the out-of-bounds state

A staff member or the run owner SHALL be able to clear a team's out-of-bounds state from the run
console. The condition SHALL be visible to them before they act on it, and the action SHALL be
recorded in the audit trail.

The release SHALL be honoured for a bounded grace period during which a further out-of-zone report
does not re-apply the flag, so a team rescued from a faulty device is not immediately re-blocked by
the same faulty report. Breach alerts to the organizer SHALL continue to be raised during the grace
period.

The release SHALL be refused to participants and to staff of a different run.

#### Scenario: The run console shows which teams are out of bounds

- **WHEN** the creator or staff views the teams panel of a live run
- **THEN** any team currently flagged out-of-bounds is identifiable as such

#### Scenario: Staff release a stuck team

- **WHEN** a staff member or the owner releases a flagged team
- **THEN** the team's out-of-bounds flag is cleared
- **AND** the team is assigned a task on its next request
- **AND** an audit-log entry records who released which team

#### Scenario: The grace period prevents an immediate re-latch

- **WHEN** a released team's device reports an out-of-zone position during the grace period
- **THEN** the team is NOT re-flagged out-of-bounds

#### Scenario: A participant cannot release themselves

- **WHEN** a participant calls the release action
- **THEN** the call is denied

