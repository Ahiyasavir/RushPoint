## ADDED Requirements

### Requirement: Global per-run device ceiling

The system SHALL cap the total number of phones (devices) that may join a single run at a
fixed ceiling `MAX_RUN_DEVICES` (16). This ceiling SHALL be enforced independently of, and in
addition to, the per-team device cap (`MAX_TEAM_DEVICES`) and the billing participant cap
(`maxParticipants`): a join SHALL be admitted only when it satisfies every applicable cap.

The run's live phone total SHALL be tracked by a monotonic `run.deviceCount` counter that is
incremented by exactly one on each admitted phone join. Because there is no detach/leave path,
the counter never decrements. For legacy runs created before this field existed, the system
SHALL fall back to `run.participantCount` as the current device count.

#### Scenario: Joining below the ceiling is admitted

- **WHEN** a phone joins a run (via `joinRun` or `joinTeamAsDevice`) whose current device count
  is less than `MAX_RUN_DEVICES`
- **THEN** the join succeeds and `run.deviceCount` is incremented by one

#### Scenario: The 17th phone is refused

- **WHEN** a run already holds `MAX_RUN_DEVICES` (16) phones and another phone attempts to join
  via either `joinRun` or `joinTeamAsDevice`
- **THEN** the join is rejected with `HttpsError('resource-exhausted', …)` carrying `{ cap, used }`
- **AND** `run.deviceCount` is unchanged

#### Scenario: Enforced atomically under concurrent joins

- **WHEN** multiple phones attempt to join a run concurrently near the ceiling
- **THEN** the cap is enforced inside the existing join transaction so the admitted total never
  exceeds `MAX_RUN_DEVICES`

#### Scenario: Additive to the per-team and billing caps

- **WHEN** a run is still under its billing `maxParticipants` and a team is still under
  `MAX_TEAM_DEVICES`, but the run has already reached `MAX_RUN_DEVICES` phones
- **THEN** a further phone join is refused by the global ceiling even though the other caps
  would otherwise allow it

#### Scenario: Legacy run without the counter field

- **WHEN** a phone joins a run whose document predates `deviceCount`
- **THEN** the current device count is read from `run.participantCount`, the ceiling is applied,
  and `run.deviceCount` is written going forward

### Requirement: Single configurable source of truth

The ceiling `MAX_RUN_DEVICES` SHALL be defined in exactly one place (`@rushpoint/shared`) and
imported by both the backend enforcement and any client that displays it, so the enforced value
and the displayed value can never diverge. Raising the ceiling SHALL require editing only that
one constant. Setting it to `Infinity` SHALL disable enforcement (every join admitted) and
SHALL cause the creator-facing warning to hide itself, with no other code change required.

#### Scenario: Raising the ceiling is a one-line change

- **WHEN** the constant `MAX_RUN_DEVICES` is changed to a larger number
- **THEN** both the backend guard and the creator warning reflect the new number without any
  other edit

#### Scenario: Removing the cap disables enforcement and the warning

- **WHEN** `MAX_RUN_DEVICES` is `Infinity`
- **THEN** `canAddRunDevice` admits every join and `isRunDeviceCapActive()` returns false so the
  creator warning is not shown

### Requirement: Creators are told the per-run phone limit

While the cap is active, the creator console SHALL surface the limit next to the run's join
code/share controls, stating the maximum phones per run in the creator's language (Hebrew or
English), so a host knows the ceiling before inviting participants.

#### Scenario: Warning shown on the run console

- **WHEN** a creator views a live run's join/share card and the cap is active
- **THEN** a note states that up to `MAX_RUN_DEVICES` phones may join the run and that extra
  phones will be turned away

#### Scenario: Warning hidden when the cap is removed

- **WHEN** the cap has been removed (`MAX_RUN_DEVICES` is `Infinity`)
- **THEN** no such note is shown
