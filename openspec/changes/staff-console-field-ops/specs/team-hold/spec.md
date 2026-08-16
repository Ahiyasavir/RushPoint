## ADDED Requirements

### Requirement: Staff can place a team on hold
An authorized staffer SHALL be able to put one team on hold via a `setTeamHold` callable, scoped
to that team only — no other team in the run is affected.

#### Scenario: Staff holds an active team
- **WHEN** an authorized staffer calls `setTeamHold` with `held: true` for a team that is not
  currently held
- **THEN** the server stamps `RunTeam.held = true`, `RunTeam.heldAt` to the current server time,
  and stores the optional `heldReason`/`heldBy`, and the call succeeds

#### Scenario: Holding an already-held team is a safe no-op refusal
- **WHEN** `setTeamHold` is called with `held: true` for a team that already has `held: true`
- **THEN** the server refuses with a non-retryable precondition error and makes no further state
  change (idempotent — a double-tap cannot double-charge the held duration)

### Requirement: Staff can resume a held team
An authorized staffer SHALL be able to release a team from hold, and the server SHALL account for
the elapsed held time.

#### Scenario: Staff resumes a held team
- **WHEN** an authorized staffer calls `setTeamHold` with `held: false` for a team with
  `held: true`
- **THEN** the server adds `(now - heldAt)` to `RunTeam.heldMs`, clears `held`, `heldAt`, and
  `heldReason`, and the team can immediately resume normal actions

#### Scenario: Resuming a team that is not held is a safe no-op refusal
- **WHEN** `setTeamHold` is called with `held: false` for a team with `held` absent or false
- **THEN** the server refuses with a non-retryable precondition error and makes no state change

### Requirement: A held team cannot advance its run
While `RunTeam.held` is true, every progress-advancing callable for that team SHALL refuse instead
of mutating the team's state.

#### Scenario: Held team is blocked from claiming or completing work
- **WHEN** a held team calls `requestNextTask`, `submitTaskAnswer`, `submitSequenceStep`,
  `verifyStationCode`, `reportArrival`, `checkOutTask`, or `requestTaskHint`
- **THEN** the server refuses the call with a stable, non-retryable error the client can classify
  and explain, and none of the team's stored progress, score, or task records change

#### Scenario: A held team can still read its own state
- **WHEN** a held team calls `getMyTeamState`
- **THEN** the call succeeds and the response indicates the team is held (and its reason, if any),
  so the participant app can render a clear "on hold" notice instead of a generic failure

### Requirement: Held time is excluded from the team's race clock
Time spent on hold SHALL NOT count toward a team's completion duration, in both the live and the
final leaderboard.

#### Scenario: Held duration is excluded from ranking time
- **WHEN** the leaderboard is computed (live refresh or final) for a team with accumulated
  `heldMs`
- **THEN** that team's adjusted elapsed time subtracts `heldMs` in addition to any existing
  task-level excluded time, using the same shared calculation for both the live and the final
  board

### Requirement: A hold cannot outlive the run
No team SHALL remain marked as held after the run finishes.

#### Scenario: Run finalization clears any outstanding hold
- **WHEN** a run is finalized while a team is still held
- **THEN** finalization accounts for the held interval up to the finalization instant and the
  team is no longer reported as actively held afterward
