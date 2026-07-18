# leaderboard-flag-integrity Specification (delta)

## ADDED Requirements

### Requirement: Automatic refresh never overwrites organizer flags
An automatic leaderboard snapshot refresh SHALL write only the recomputed `leaderboard.rankings` and
the snapshot timestamps, and MUST NOT write `leaderboard.published` or `leaderboard.frozen`, so a
concurrent organizer publish or freeze can never be reverted by an in-flight refresh. The refresh
write MUST be committed under a transaction that re-reads the run and skips the write when the board
has become frozen since the refresh began. This applies to every path funneling through
`maybeRefreshLeaderboardSnapshot`.

#### Scenario: Publish during an in-flight refresh survives
- **WHEN** an auto-refresh has begun (run read, rankings being recomputed) and the organizer
  publishes the board before the refresh commits
- **THEN** after the refresh commits the board remains `published: true`

#### Scenario: Freeze during an in-flight refresh is respected
- **WHEN** an auto-refresh has begun and the organizer freezes the board before the refresh commits
- **THEN** the refresh does not overwrite the frozen snapshot and the board remains `frozen: true`

#### Scenario: Normal refresh still updates the rankings
- **WHEN** a team completes a scoring task on an unpublished, unfrozen board and the throttle window
  has elapsed
- **THEN** the run's `leaderboard.rankings` and `leaderboard.updatedAt` are updated and
  `leaderboard.published` / `leaderboard.frozen` keep their prior values
