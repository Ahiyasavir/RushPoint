## ADDED Requirements

### Requirement: A location ping writes the team pin at a bounded rate
The server SHALL write `teamLocations` at most once per minimum write interval per team, rather than
once per ping. A ping arriving before that interval has elapsed MUST be suppressed unless the team
has moved a significant distance since its last written fix, in which case the write proceeds
immediately. The decision SHALL be produced by a pure function receiving the incoming fix, the last
written fix and the current time as arguments.

#### Scenario: Pings inside the interval are suppressed
- **WHEN** a team pings again before the minimum write interval has elapsed
- **AND** it has not moved a significant distance since its last written fix
- **THEN** no `teamLocations` write is performed
- **AND** the callable still returns its normal success payload

#### Scenario: The pin refreshes once the interval elapses
- **WHEN** the minimum write interval has elapsed since the team's last written fix
- **THEN** the next ping performs the `teamLocations` write, whether or not the team moved
- **AND** the live map therefore never shows a fix older than the interval plus one ping period

#### Scenario: A significant jump writes immediately
- **WHEN** a team's reported position is a significant distance from its last written fix
- **THEN** the write is performed even though the minimum interval has not elapsed

#### Scenario: A team with no known last fix always writes
- **WHEN** the server holds no last written fix for a team, including after a process restart
- **THEN** the write is performed

### Requirement: Significance is judged against the fix's own error radius
A position change SHALL NOT count as significant movement when it is within the reported accuracy of
the incoming fix, so GPS jitter from a stationary device cannot defeat write suppression. The
accuracy allowance MUST be bounded by a ceiling so that a very low-confidence fix cannot suppress a
genuinely large movement, and a missing or malformed accuracy value MUST fall back to a fixed
distance threshold.

#### Scenario: Jitter within the error radius is not movement
- **WHEN** a stationary device reports positions varying by less than the fix's accuracy radius
- **THEN** those variations do not count as significant movement

#### Scenario: A very low-confidence fix cannot suppress a large move
- **WHEN** a fix reports an accuracy far larger than the allowance ceiling
- **AND** the team has moved farther than the ceiling
- **THEN** the movement counts as significant

#### Scenario: Missing accuracy falls back to a fixed threshold
- **WHEN** the incoming fix carries no accuracy value
- **THEN** significance is judged against the fixed distance threshold

### Requirement: Suppression never reaches the safety path
Write suppression SHALL govern only whether a document is written. The safe-zone boundary
evaluation, its alert emission and the team's out-of-bounds flag transitions MUST execute on every
ping, on exactly the inputs they receive today, whether or not the position write was suppressed.

#### Scenario: A stationary team outside the boundary is still detected
- **WHEN** a team sits motionless outside the safe zone and its position write is suppressed
- **THEN** the safe-zone evaluation still runs for that ping
- **AND** a breach alert is raised and the out-of-bounds flag is set exactly as it would be without
  suppression

#### Scenario: Returning inside the boundary still clears the flag
- **WHEN** a team flagged out-of-bounds pings from inside the safe zone and the write is suppressed
- **THEN** the out-of-bounds flag is cleared

### Requirement: The last-written fix is tracked without an extra Firestore read
Determining whether to suppress a write MUST NOT itself cost a Firestore read. The last written fix
per team SHALL be held in the API process's own memory, which is authoritative because the API is
the sole writer of `teamLocations` and runs as exactly one process. The store MUST be bounded so a
long-lived process cannot grow without limit, and MUST fail toward writing when it holds nothing for
a team.

#### Scenario: No read is issued to decide suppression
- **WHEN** the server evaluates whether to write a team's pin
- **THEN** it consults its in-process last-fix record and performs no `teamLocations` read

#### Scenario: A restarted process writes on the next ping
- **WHEN** the API process restarts and loses its in-memory last-fix records
- **THEN** the next ping for each team performs the write

#### Scenario: The store does not grow without bound
- **WHEN** many teams across many runs have pinged over a long-lived process
- **THEN** records for teams that have stopped pinging are evicted

### Requirement: The movement-history track is retained by distance travelled
The append to `locationTrack` SHALL be retained only once the team has travelled a retention
distance since its last retained point, rather than on every ping. The decision SHALL be pure and
deterministic for a given ping sequence, with no dependence on random selection.

#### Scenario: A stationary team appends no history
- **WHEN** a team remains within the retention distance of its last retained point
- **THEN** no `locationTrack` write is performed

#### Scenario: A walking team appends at the retention distance
- **WHEN** a team travels beyond the retention distance from its last retained point
- **THEN** one history point is appended and becomes the new reference point

#### Scenario: A failed history append never fails the ping
- **WHEN** the `locationTrack` append rejects
- **THEN** the callable still returns success, preserving today's best-effort behavior

### Requirement: The ping verdict is total and fails toward writing
The verdict function SHALL never throw. Absent, malformed, non-finite or out-of-range stored data
MUST be treated as "no usable last fix" and therefore resolve to *write*, so a data defect can never
cause a team's position to stop being recorded.

#### Scenario: Malformed last fix falls back to writing
- **WHEN** the last fix carries a non-finite coordinate or an unparseable timestamp
- **THEN** the verdict is to write
- **AND** no exception propagates to the callable

#### Scenario: Invalid incoming coordinates do not crash the verdict
- **WHEN** the verdict receives a non-finite incoming coordinate
- **THEN** it returns a write verdict rather than throwing
