# Builder guidance arbitration

## ADDED Requirements

### Requirement: At most one guidance surface is visible
The Builder SHALL display at most one guidance surface at a time. When more than one surface
qualifies to be shown, the system SHALL choose exactly one by a single declared priority order,
highest first: first-launch confirmation, הקמה מהירה (quick setup), the guided tour, the
first-open spotlight, the ready nudge.

The choice MUST NOT depend on component mount order, render order, or on how long a surface has
been mounted.

#### Scenario: Quick setup outranks the first-open spotlight
- **WHEN** a creator opens the Builder on a templated game where הקמה מהירה auto-invites and the
  first-open spotlight has never been seen
- **THEN** only the הקמה מהירה invitation is on screen
- **AND** the spotlight is not rendered

#### Scenario: A blocking confirmation outranks an in-progress flow
- **WHEN** the creator presses launch while a הקמה מהירה step is on screen and the first-launch
  confirmation is due
- **THEN** only the confirmation is on screen

#### Scenario: The ready nudge yields to everything
- **WHEN** the game is launch-ready and unplayed, and any other guidance surface qualifies
- **THEN** the ready nudge is not rendered
- **AND** it appears once no other surface qualifies

#### Scenario: Nothing qualifies
- **WHEN** no guidance surface qualifies
- **THEN** no guidance surface is rendered and the Builder is unobstructed

### Requirement: A requested tour is deferred, never dropped
When the creator explicitly requests the guided tour — the help control — while a higher-priority surface is on screen, the system SHALL NOT draw the tour over it and SHALL NOT
silently discard the request. The request SHALL be held and the tour SHALL start once no
higher-priority surface is on screen.

An automatically started tour that loses arbitration SHALL simply not start; only an explicitly
requested one is held.

#### Scenario: Help pressed during quick setup
- **WHEN** the creator presses the help control while a הקמה מהירה step is on screen
- **THEN** the tour does not appear
- **AND** the creator is told the tour will begin after the current flow
- **AND** the tour starts once הקמה מהירה is closed, deferred or completed

#### Scenario: Help pressed with nothing else running
- **WHEN** the creator presses the help control and no other surface qualifies
- **THEN** the tour starts immediately

#### Scenario: An auto-started tour that loses is not queued
- **WHEN** the tour would auto-start after signup but a higher-priority surface is on screen
- **THEN** the tour does not start
- **AND** it is not started later by the deferral path

### Requirement: Arbitration is re-evaluated, not snapshotted
The system SHALL re-evaluate which surface is visible whenever the inputs to that decision
change. A surface MUST NOT be able to remain on screen because it evaluated its own eligibility
before a higher-priority surface existed.

#### Scenario: A higher-priority surface starts after a lower one
- **WHEN** the first-open spotlight is on screen and the guided tour then starts
- **THEN** the spotlight is no longer on screen
- **AND** only the tour is visible

### Requirement: Arbitration never breaks the Builder
The arbitration decision SHALL be a total function: every combination of surface states,
including absent, unknown and malformed ones, SHALL yield a defined result and MUST NOT throw.
An undecidable input SHALL resolve to showing no guidance surface rather than to an error or to
several surfaces.

#### Scenario: Malformed state
- **WHEN** the arbitration inputs are null, undefined, or carry an unrecognised surface name
- **THEN** the decision returns "no surface" and the Builder renders normally

### Requirement: Existing triggers and records are unchanged
This arbitration SHALL NOT change which creator qualifies for a surface, what any surface says,
or any persisted "seen" record. A surface that is suppressed by arbitration SHALL NOT be recorded
as seen.

#### Scenario: A suppressed spotlight is still owed
- **WHEN** the first-open spotlight is suppressed because הקמה מהירה won arbitration
- **THEN** no "spotlight seen" record is written
- **AND** the spotlight is still offered on a later Builder open when nothing outranks it
