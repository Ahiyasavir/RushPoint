## ADDED Requirements

### Requirement: Team attention is a pure, total, quiet-by-default classification

The run console SHALL derive each team's attention level from a **pure function** of the team's
projected row, a run-level context, and an injected current time. The function SHALL NOT read a
clock, perform I/O, or throw for any input, and SHALL be deterministic for a given `nowMs`.

The level SHALL be one of `ok`, `watch`, `stuck`, accompanied by an ordered list of machine-readable
reasons. `reasons` SHALL be empty if and only if the level is `ok`.

The classification SHALL **fail quiet**: a missing, empty, unparsable, `NaN` or non-finite timestamp,
an absent location stream, an absent lockout value, or a timestamp in the future relative to the
injected time SHALL never, on its own, produce a non-`ok` level.

#### Scenario: A healthy team mid-task is not flagged
- **WHEN** a launched team that started well before the grace window was last active a few minutes ago, is pinging its location, and has no lockout
- **THEN** the level is `ok` and no reasons are reported

#### Scenario: Missing and malformed timestamps are silent
- **WHEN** a team row carries no `updatedAt`, an empty string, a non-date string, or a `NaN` lockout value
- **THEN** the classification returns without throwing and the level is `ok`

#### Scenario: A clock ahead of the server never flags a team
- **WHEN** every timestamp on a team row lies in the future relative to the injected current time
- **THEN** all derived durations are treated as zero and the level is `ok`

#### Scenario: The classification is total
- **WHEN** the classifier is given any combination of present, absent, `NaN`, negative and infinite field values
- **THEN** it never throws, the level is always one of the three known values, and every reason is drawn from the known reason set

### Requirement: Idle detection is relative to the field, not absolute

An idle team SHALL be flagged only when its time since last activity exceeds **both** an absolute
floor and a multiple of the field's own median idle time, so that a game whose tasks are legitimately
long does not flag its entire field.

The run context SHALL compute the median idle time over launched, unfinished teams with a usable
activity timestamp, and SHALL report no median when fewer than the minimum number of such teams
exists — in which case only the absolute floors apply.

An absolute ceiling SHALL bound the stuck threshold, except when the field's own median exceeds that
ceiling, in which case no team is flagged for idleness alone.

#### Scenario: An outlier in a fast field is flagged
- **WHEN** the field's median idle time is a few minutes and one team has been inactive for half an hour
- **THEN** that team's level is `stuck` and `idle` is among its reasons

#### Scenario: The same idle time in a slow field is not flagged
- **WHEN** the field's median idle time is itself long and a team's idle time is within the field-relative multiple
- **THEN** that team's level is `ok`

#### Scenario: Too few teams to form a median
- **WHEN** fewer than the minimum number of active teams are present
- **THEN** the context reports no median and only the absolute floors are applied

### Requirement: Teams that cannot be in trouble are never flagged

Three kinds of team SHALL always classify as `ok`, regardless of every other signal: a team that has
finished the run, a team that has not been launched, and a team that started within the grace window.

#### Scenario: A finished team with ancient timestamps is clean
- **WHEN** a team is finished and its last activity and last location are hours old
- **THEN** its level is `ok` and no reasons are reported

#### Scenario: A team that just joined is clean
- **WHEN** a team was launched within the grace window
- **THEN** its level is `ok` even if its activity timestamp looks stale

#### Scenario: A team waiting in the lobby is clean
- **WHEN** a team has joined but has not been launched
- **THEN** its level is `ok`

### Requirement: The reasons name the specific field failure

The classifier SHALL distinguish the known field failure modes so the organizer is told *what* is
wrong, not merely that something is.

A team held by the safe-zone latch SHALL classify as `stuck`. A retry lockout SHALL be reported only
when meaningful time remains on it, as `watch`, escalating to `stuck` past a longer remaining
threshold. A silent location stream SHALL be reported as `watch`, escalating to `stuck` only in
combination with an idle team. A pending staff review SHALL be reported as an explanatory reason on an
already-flagged team and SHALL NEVER raise the level on its own.

#### Scenario: The safe-zone latch is a stuck team
- **WHEN** a team's row reports it is out of bounds
- **THEN** its level is `stuck` and `outOfBounds` is among its reasons

#### Scenario: A short lockout is ordinary gameplay
- **WHEN** a team's retry lockout has less than the minimum remaining time left
- **THEN** its level is `ok`

#### Scenario: A long lockout is surfaced
- **WHEN** a team's retry lockout has several minutes remaining
- **THEN** its level is `watch` and `answerLockout` is among its reasons

#### Scenario: A dead location stream on a progressing team is a watch, not a stuck
- **WHEN** a team has not reported a location for a long window but is still active
- **THEN** its level is `watch` and `gpsSilent` is among its reasons

#### Scenario: A dead location stream on an idle team is a stuck
- **WHEN** a team has neither reported a location nor been active for a long window
- **THEN** its level is `stuck` and both `gpsSilent` and `idle` are among its reasons

#### Scenario: No location stream at all is not a failure
- **WHEN** a team has never reported a location
- **THEN** no location-related reason is produced

#### Scenario: A pending review explains but does not accuse
- **WHEN** a healthy team has a photo submission awaiting staff review
- **THEN** its level is `ok`
- **WHEN** an already-flagged team has a photo submission awaiting staff review
- **THEN** `awaitingReview` is appended to its reasons and its level is unchanged

### Requirement: The run team projection carries the signals the classification needs

`listRunTeams` SHALL project, for each team, the team's last-activity timestamp, the latest expiry of
any active answer-retry lockout, and the timestamp of the team's most recent reported location. These
SHALL be read-only projections of state the server already holds; the callable SHALL NOT write, SHALL
NOT gain new parameters, and SHALL remain behind its existing owner authorization gate.

All three fields SHALL be optional on the wire, so a client build receiving a row without them
behaves exactly as one receiving a row with them absent of evidence.

#### Scenario: The projection exposes the activity clock
- **WHEN** the owner lists the teams of their run
- **THEN** each row carries the team's last-activity timestamp

#### Scenario: The projection exposes an active lockout
- **WHEN** a team is serving an answer-retry lockout
- **THEN** its row carries the lockout expiry, and a team with no lockout carries a null

#### Scenario: The projection exposes location freshness without exposing position
- **WHEN** a team has reported a location
- **THEN** its row carries the timestamp of that report and no coordinates

#### Scenario: The projection remains owner-only
- **WHEN** a caller who does not own the run lists its teams
- **THEN** the call is denied exactly as before

### Requirement: The run console surfaces attention without becoming a dashboard

The teams panel SHALL display a count of teams needing attention when that count is greater than
zero, and SHALL display, on each affected team's row, a single compact indicator stating the reason in
the organizer's language.

The indicator SHALL reuse the existing badge primitive and the existing row layout, SHALL add no new
dependency, and SHALL NOT duplicate a condition that already has its own dedicated line and control on
the row.

All copy SHALL exist in both Hebrew and English dictionaries.

#### Scenario: A clean run shows nothing
- **WHEN** no team is flagged
- **THEN** no count and no per-row indicator are rendered

#### Scenario: A flagged team shows its reason
- **WHEN** a team classifies as `watch` or `stuck`
- **THEN** its row renders one badge naming the reason, and the panel header renders the total count

#### Scenario: The out-of-bounds row is not double-reported
- **WHEN** a team's only reason is the safe-zone latch
- **THEN** the row keeps its existing out-of-bounds line and rescue control and renders no additional badge
