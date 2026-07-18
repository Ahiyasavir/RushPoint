# live-leaderboard-refresh Specification (delta)

## ADDED Requirements

### Requirement: Leaderboard snapshot auto-refreshes on task completion
The server SHALL recompute the run's `leaderboard` snapshot via the shared `buildRankings`
and write it to the run doc after a successful task completion (any path that funnels through
the internal `completeTaskForTeam` — completeTask, submitTaskAnswer, submitSequenceStep,
verifyStationCode, reviewStationSubmission), without organizer intervention. The refresh
MUST be throttled per run (skipped while the existing snapshot is fresher than the configured
minimum interval, default 20 seconds) and MUST preserve the snapshot's `published` and `frozen`
flags. A refresh failure MUST NOT fail the completion that triggered it.

#### Scenario: Completion is reflected without a manual refresh
- **WHEN** a team completes a scoring task and no organizer clicks "Refresh standings"
- **THEN** the run doc's `leaderboard.rankings` subsequently contains that team's updated score
  and a fresh `updatedAt`

#### Scenario: Refresh is throttled
- **WHEN** a task completes while the snapshot's `updatedAt` is newer than the minimum interval
- **THEN** the snapshot is left unchanged (the next scoring event after the window catches up)

#### Scenario: Frozen board is never auto-overwritten
- **WHEN** the organizer has frozen the leaderboard and a team then completes a task
- **THEN** the frozen snapshot's rankings remain exactly as frozen

#### Scenario: Publish state survives auto-refresh
- **WHEN** an auto-refresh runs on a published (or unpublished) board
- **THEN** the `published` flag is unchanged by the refresh

### Requirement: Staff score adjustments are immediately visible
`adjustTeamScore` SHALL trigger an immediate (unthrottled) leaderboard snapshot refresh after
its scoring transaction, and `listRunTeams` SHALL include each team's `bonusPenalty` in its
rows so the creator console can display the effective score (`score − bonusPenalty`). The
existing `score` field's meaning (sum of earned task scores) MUST NOT change.

#### Scenario: Adjustment shows on the leaderboard
- **WHEN** an operator applies `adjustTeamScore` with delta −50 to a team
- **THEN** the run doc's `leaderboard` reflects that team's score reduced by 50 without any
  manual refresh

#### Scenario: Adjustment shows in the console teams table
- **WHEN** the console next polls `listRunTeams` after a −50 adjustment
- **THEN** the team's row carries `bonusPenalty` reflecting the delta and the console renders
  the effective score

### Requirement: Owner-initiated stage skips refresh the snapshot
`skipStage` SHALL trigger an immediate leaderboard snapshot refresh after its transaction, so
skip awards appear on live standings without a manual refresh.

#### Scenario: Skip award appears
- **WHEN** the owner skips a team's active stage and the preset grants a skip award
- **THEN** the run doc's `leaderboard` subsequently reflects the team's updated score
