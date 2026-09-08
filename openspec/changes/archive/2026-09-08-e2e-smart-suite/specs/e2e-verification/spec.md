# e2e-verification Specification (delta)

## ADDED Requirements

### Requirement: Scenario isolation with grouped diagnostics
The e2e suite SHALL run independent test blocks as named scenarios such that an uncaught error in
one scenario fails that scenario and the suite continues with the remaining scenarios. The suite
SHALL end with a per-scenario summary (checks, failures, duration) and a per-callable latency
table, and SHALL exit non-zero iff any check or scenario failed.

#### Scenario: A crashing scenario does not hide the rest
- **WHEN** a callable inside one scenario throws an unexpected error
- **THEN** that scenario is recorded as failed and every subsequent scenario still executes
- **AND** the process exit code is non-zero

### Requirement: Participant task payload is allowlist-verified
The suite SHALL assert that every key of a participant-visible task payload (top level and under
`smart`) belongs to an explicit allowlist, so that any newly added task field fails the e2e until
it is consciously classified as client-safe.

#### Scenario: A new server-side field cannot leak silently
- **WHEN** a field not in the allowlist appears in `getMyTeamState().activeStageTasks[]`
- **THEN** the e2e fails naming the unexpected key

### Requirement: Leaderboard invariants and live/final parity
On a multi-team run the suite SHALL assert: rankings contain every team exactly once with
contiguous ranks starting at 1; scores are finite and ordered per the preset; each completed
task's `scoreBreakdown.total` equals its `earnedScore`; the sum of task `earnedScore` equals
`team.score`; and the team ordering produced by `refreshLeaderboard` equals the ordering produced
by `finalizeRun` for the same end state.

#### Scenario: Live and final standings agree
- **WHEN** all teams have finished and `refreshLeaderboard` is invoked followed by `finalizeRun`
- **THEN** both produce the same team ordering

### Requirement: Station capacity holds under concurrent assignment
The suite SHALL race at least three teams concurrently requesting tasks in a stage whose stations
have `maxConcurrentTeams: 1` and assert the run's `taskCounts` never exceed each task's cap, and
SHALL assert that duplicate concurrent submissions of the same completion score exactly once.

#### Scenario: Concurrent requestNextTask cannot oversubscribe a station
- **WHEN** three teams call `requestNextTask` simultaneously for a stage of cap-1 stations
- **THEN** after settlement `run.taskCounts[taskId] ≤ 1` for every station task

#### Scenario: Concurrent duplicate submission scores once
- **WHEN** the same team submits the same correct completion twice concurrently
- **THEN** the task contributes its score exactly once to `team.score`

### Requirement: Authorization denial matrix
The suite SHALL verify, from one data-driven table, that participant and stranger identities are
denied (typed error) on owner-only callables, covering at minimum: `startTeams`, `skipStage`,
`finalizeRun`, `refreshLeaderboard`, `adjustTeamScore`, `inviteStaff`, `pruneRunNow`,
`activateHotZone`, `deactivateHotZone`, `getRunReplay`, and `getRunAnalytics`.

#### Scenario: A participant cannot run owner live-ops
- **WHEN** a joined participant calls an owner-only callable against the run it plays in
- **THEN** the call is rejected with `permission-denied` or `not-found` and run state is unchanged

### Requirement: Boundary behavior is pinned
The suite SHALL pin answer/geo boundary semantics with deterministic (seeded) cases: quiz answers
match case-insensitively with surrounding whitespace ignored; numeric answers accept exactly
`|given − answer| ≤ tolerance`; radius check-ins accept inside and reject outside the configured
radius near its edge.

#### Scenario: Numeric tolerance is inclusive
- **WHEN** a numeric task has answer 12 and tolerance 1
- **THEN** `'13'` is accepted and `'14'` is rejected

### Requirement: Callable coverage guard
The e2e suite SHALL introspect the set of callables the emulator actually serves (from the built
functions bundle) and SHALL fail if any callable was never invoked during the run, unless it is
listed in an explicit exemption set with a reason. The suite SHALL also fail if the exemption set
contains an entry that no longer exists or is now exercised.

#### Scenario: A new untested callable fails the suite
- **WHEN** a callable is added and exported but no scenario invokes it
- **THEN** the coverage guard fails, naming the uncovered callable

#### Scenario: Coverage is complete
- **WHEN** every deployed callable is invoked by some scenario (positively or via the denial matrix)
- **THEN** the coverage guard passes

### Requirement: Property/invariant unit tests for pure logic
The pure logic behind scoring, ranking, answer-matching, geo gating, and rate-limiting SHALL be
covered by fast (no-emulator) property tests that assert invariants over seeded-random inputs, so
a regression produces a reproducible counterexample in the unit lane.

#### Scenario: Ranking well-formedness holds for any team set
- **WHEN** `buildRankings` is called with any randomized set of teams under any preset
- **THEN** the output contains every team exactly once with contiguous ranks and finite scores

#### Scenario: A task score can never be negative
- **WHEN** `taskScoreSmart` is called with any finite difficulty (including negative)
- **THEN** the returned score is finite and `>= 0`

### Requirement: v2 load simulator
A `simulate-run` script SHALL drive N concurrent teams (configurable, seeded/reproducible)
through a real multi-stage game via the public callable API only, and end by asserting the
leaderboard invariants and that every station counter returns to zero, exiting non-zero on any
violation.

#### Scenario: Full-field load run stays consistent
- **WHEN** `npm run simulate` completes a 12-team concurrent run against the emulator
- **THEN** the final leaderboard passes the invariant oracle and all `taskCounts` are 0
