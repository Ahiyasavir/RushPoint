## ADDED Requirements

### Requirement: A team held on guardian consent SHALL NOT be assigned a task
`assignNextInActiveStage` SHALL refuse to assign a task to a team for which
`canReceiveTaskAssignment(team)` is `false` (that is, `team.launched !== true`) — this is the
single function every task-assignment entry point (`requestNextTask`, `startTeams`'s post-launch
fan-out, `completeTask`'s reassign-on-completion, station-photo/sequence follow-on assignment, the
poll sweep) funnels through. The refusal SHALL happen before any station-slot reservation, before
any `activeTaskId` write, and before any of the function's poll-time maintenance side effects
(scheduled-release unlock, task-expiry sweep, unreachable-task heal).

#### Scenario: A held team's direct assignment request is denied
- **WHEN** a team with `launched !== true` (held on guardian consent) calls `requestNextTask`
  directly, without going through `startTeams`
- **THEN** the call returns `{ taskId: null, reason: 'guardian_consent' }`
- **AND** no station slot is reserved (`run.taskCounts` is unchanged)
- **AND** the team's `activeTaskId` remains unset
- **AND** no team-document write occurs as a side effect of the call

#### Scenario: A launched team is assigned exactly as before
- **WHEN** a team with `launched === true` calls `requestNextTask` (or is assigned via any other
  entry point that funnels through `assignNextInActiveStage`)
- **THEN** assignment proceeds exactly as it did before this change — same routing, same
  station-cap enforcement, same claim transaction, same response shape when a task is available

#### Scenario: Consent recovery re-enables assignment with no lingering block
- **WHEN** a previously held team's guardian consent is granted and the team is subsequently
  launched (via `startTeams`)
- **THEN** the next call to `requestNextTask` for that team succeeds normally and returns a real
  `taskId` (assuming a routable task exists), with no trace of the prior denial

#### Scenario: The denial reason matches the client's existing held-state vocabulary
- **WHEN** a held team's assignment request is denied
- **THEN** the returned `reason` is the literal string `'guardian_consent'` — the same value
  `getMyTeamState` already returns as `holdReason` for a held team — so the participant client
  renders the existing held-state UI with no new branch or client change required
