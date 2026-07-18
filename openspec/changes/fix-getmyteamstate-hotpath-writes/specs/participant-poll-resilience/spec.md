# participant-poll-resilience Specification (delta)

## ADDED Requirements

### Requirement: A team-state poll never fails on a contended advance write
`getMyTeamState` SHALL advance the returned team state (scheduled-release unlock, task-expiry sweep)
in memory unconditionally, and persist that advance on a best-effort basis. A failed or aborted
persistence write MUST be caught and logged, never propagated, so the poll always returns the
advanced state.

#### Scenario: A contended advance write does not fail the poll
- **WHEN** the persistence write for a poll-time advance is aborted (e.g. a transaction lock timeout
  under concurrent load)
- **THEN** `getMyTeamState` still resolves successfully with the advanced team state, and the failed
  write is logged as a best-effort miss

### Requirement: Only the controller device persists a poll-time advance
When multiple devices are attached to one team, only the controller's poll SHALL write the advance to
the team document; non-controller (viewer) polls MUST NOT write. Every device still receives the
advanced state in its response.

#### Scenario: A viewer poll does not write
- **WHEN** a non-controller device polls `getMyTeamState` across a stage boundary
- **THEN** the team document is not modified by that poll, but the response reflects the unlocked stage

#### Scenario: The controller poll persists as before
- **WHEN** the controller device polls `getMyTeamState` and a scheduled-release stage is due
- **THEN** the unlocked stage is persisted to the team document (the existing poll-then-complete flow
  continues to work)
