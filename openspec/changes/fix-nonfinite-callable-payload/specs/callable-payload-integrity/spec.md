# callable-payload-integrity Specification (delta)

## ADDED Requirements

### Requirement: Callable return values contain no non-finite numbers
Every Cloud Function callable's return value SHALL be free of non-finite numbers. Before a result is
serialized, any `number` that is `Infinity`, `-Infinity`, or `NaN` MUST be replaced with `null`, so a
callable can never fail JSON encoding on a non-finite value.

#### Scenario: A computed non-finite value degrades to null instead of crashing
- **WHEN** a callable's handler produces a payload containing a non-finite number at any nesting depth
- **THEN** the value delivered to the client has that number replaced with `null` and the response is
  delivered successfully (no `Data cannot be encoded in JSON` error)

### Requirement: Leaderboard entries never carry a non-finite duration
The ranked standings computed for a run (live snapshot and final) SHALL omit `durationSeconds` and
`totalMinutes` for any team whose elapsed duration is not finite (e.g. a team that joined but was
never started), so the snapshot written to `run.leaderboard` is always JSON-encodable.

#### Scenario: A joined-but-not-started team does not poison the board
- **WHEN** a run contains a team that has joined but has no `startedAt`
- **THEN** that team's leaderboard entry has no `durationSeconds`/`totalMinutes` (rather than
  `Infinity`) and the whole `run.leaderboard` snapshot serializes without error

#### Scenario: getMyTeamState with an unstarted team in the run succeeds
- **WHEN** a participant polls `getMyTeamState` while another team in the run is joined-but-not-started
- **THEN** the response resolves successfully and every embedded leaderboard entry is finite-or-absent
