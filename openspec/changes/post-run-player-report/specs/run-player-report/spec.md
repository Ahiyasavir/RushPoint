# run-player-report Specification

## ADDED Requirements

### Requirement: getRunPlayerReport returns the owner's full per-player analysis
A new `getRunPlayerReport` callable SHALL resolve a run by `{ gameId, runId }`, refuse any caller who
is not that game's owner, and return the run's players together with every mission outcome. It SHALL
work on a FINISHED run and on a live one, and SHALL tolerate a pruned or missing game document by
degrading (missions it can no longer name are reported by id) rather than failing.

#### Scenario: Owner receives players and per-mission rows
- **WHEN** the run owner calls `getRunPlayerReport` for one of their runs
- **THEN** the response contains one player row per team — display name, member names, rank, score,
  bonus/penalty, elapsed time, missions completed, hints used and media count
- **AND** one answer row per player x mission — stage, mission title and type, the question as
  authored, the recorded submission(s) with their verdicts, attempt count, points earned, time
  taken, media URL and survey text

#### Scenario: A non-owner is denied
- **WHEN** a participant, a stranger, or the staff of another run calls `getRunPlayerReport`
- **THEN** the call fails with `permission-denied`
- **AND** no part of the report is returned

#### Scenario: A deleted game's report is refused
- **WHEN** the owner calls it for a run whose game is tombstoned
- **THEN** the call fails rather than serving data from the trash

### Requirement: The report distinguishes "answered nothing" from "not recorded"
The report SHALL mark a mission with an explicit `answersUnavailable` flag — never an empty answer
list — when its answers predate the answer log or have passed the 30-day retention window. A
mission type that has no answer at all (a check-in, a geofence, a photo) SHALL be reported as having
no answer channel. The two MUST be distinguishable by the consumer.

#### Scenario: A legacy run is honest about missing data
- **WHEN** the report covers a run played before answers were recorded
- **THEN** its answer rows carry `answersUnavailable: true`
- **AND** their score, status and timing fields are still populated

#### Scenario: A check-in mission is not reported as a missing answer
- **WHEN** the report covers a `field` or `geofence` mission
- **THEN** that row reports no answer channel, not an unavailable answer

### Requirement: The report builder is pure and total
`buildRunPlayerReport` SHALL be a pure function of the stored game, run and team documents — never of
the current clock and never re-derived from a live template in a way that could disagree with the
stored record. It MUST be total: a malformed team, a stage with no tasks, a task record naming a
mission the game no longer has, or a non-finite score SHALL each degrade to a sane row instead of
throwing, so one bad document cannot deny the owner the whole report.

#### Scenario: A malformed team does not break the report
- **WHEN** one team document has no `stages` array and a non-finite score
- **THEN** that team still appears as a player row with a zeroed score
- **AND** every other team's rows are unaffected

#### Scenario: An orphaned task record is still reported
- **WHEN** a task record names a mission that has since been deleted from the game
- **THEN** the row is reported under the mission id with an unknown title, not dropped

### Requirement: Ranking in the report matches the leaderboard
Player rank in the report SHALL be taken from the run's stored leaderboard when one exists, so the
report and the standings the players saw cannot disagree. When no leaderboard has been built, the
report SHALL rank by the same score-then-time ordering and SHALL mark the ranking as provisional.

#### Scenario: A finalized run reuses the stored ranking
- **WHEN** the run has a finalized leaderboard
- **THEN** each player row's rank equals that leaderboard's rank for the same team

#### Scenario: A live run is marked provisional
- **WHEN** the run has never had a leaderboard built
- **THEN** the report's ranking is flagged provisional

### Requirement: A creator can read the analysis and export it as one spreadsheet
The creator console SHALL present the report at a stable route as a readable page — a run header, a
standings table, an expandable per-player breakdown showing each mission with the player's own
answers and verdicts, and their submitted media — and SHALL offer a single-click export of one
`.xlsx` workbook containing a players sheet, an answers sheet (one row per player x mission) and a
missions sheet. The workbook generator MUST be lazy-loaded so it never enters the console's entry
chunk, and the page MUST state how long recorded answers are kept.

#### Scenario: Export produces one workbook with three sheets
- **WHEN** the creator clicks export on the report page
- **THEN** one `.xlsx` file downloads containing the players, answers and missions sheets

#### Scenario: Hebrew content survives the round trip
- **WHEN** the run's players, missions and answers are in Hebrew
- **THEN** the exported cells read as Hebrew when opened in a spreadsheet application

#### Scenario: The retention window is disclosed
- **WHEN** the report page renders
- **THEN** it states that recorded answers are kept for 30 days

#### Scenario: The export code is not in the entry chunk
- **WHEN** the creator console is built for production
- **THEN** the spreadsheet library is absent from the entry chunk
