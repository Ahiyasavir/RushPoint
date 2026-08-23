## ADDED Requirements

### Requirement: A task can be authored to pause the team's race clock
A `Task` SHALL carry an optional boolean `pausesTimer`. When absent or `false` the task behaves
exactly as it does today. When `true`, the time a team spends on that task SHALL be excluded from
every time-derived scoring term for that team.

The flag SHALL be available for every task type and SHALL default to off, so no existing game, no
in-flight run and no completed run changes by a single point or second.

The flag SHALL be validated as a boolean wherever a game document is accepted from outside the
server, and a game file carrying a non-boolean `pausesTimer` SHALL be refused rather than coerced.

#### Scenario: A game authored before this change is unaffected
- **WHEN** a run is scored for a game in which no task carries `pausesTimer`
- **THEN** every task score, every team duration, every speed bonus and every Z-Score bonus is
  identical to the values produced before this change
- **AND** no `excludedMs` is written to any task record

#### Scenario: The flag is offered on any task type
- **WHEN** a creator opens the task editor for a `survey`, `quiz`, `photo`, `self_report`,
  `sequence`, `field` or `geofence` task
- **THEN** the pause-clock toggle is offered and is off
- **AND** on a located task (`radius` or `exact` trigger) the editor additionally states that the
  walk to the spot will not be timed either

#### Scenario: A malformed flag is refused on import
- **WHEN** a game file declares `pausesTimer: "yes"` on a task
- **THEN** the import is refused naming the field and the expected type
- **AND** no game is produced

### Requirement: The excluded duration is computed only from server timestamps
The excluded duration for one task SHALL be derived solely from timestamps the server itself wrote
onto that team's `RunTaskRecord`: the span from `startedAt` to `completedAt`. No value reported by,
derived from, or influenced by a client SHALL contribute to it.

The result SHALL be stamped once, at completion, onto `RunTaskRecord.excludedMs`, as part of the
whole-object stage rewrite the record already receives, and SHALL never be written through a dotted
array path.

A span SHALL be clamped to zero and SHALL never be negative, `NaN` or infinite. An absent
`excludedMs` SHALL read as zero.

#### Scenario: A client cannot inflate its own excluded time
- **WHEN** a completion payload carries any client-supplied duration, elapsed time or timestamp
- **THEN** it is ignored, and the excluded duration is the server's own
  `completedAt − startedAt` span

#### Scenario: A non-monotonic clock cannot produce negative excluded time
- **WHEN** a task record's stored `completedAt` precedes its `startedAt`
- **THEN** the excluded duration for that task is zero
- **AND** the team's adjusted elapsed time equals its raw elapsed time

#### Scenario: An unparsable timestamp cannot poison the total
- **WHEN** a task record carries a non-string or unparsable `startedAt` or `completedAt`
- **THEN** that record contributes zero excluded time
- **AND** the team's total excluded time stays finite and non-negative

### Requirement: A task the team does not complete excludes nothing
Excluded time SHALL accrue only for a paused task the team actually **completed**. A paused task
that is still in progress, was abandoned and re-routed, expired, was skipped by an operator, or was
auto-skipped because its stage's `requiredTaskCount` was already met SHALL contribute zero.

#### Scenario: The team never completes the paused task
- **WHEN** a run is finalised while a team holds an incomplete paused task
- **THEN** that task contributes zero excluded time
- **AND** the team's ranked duration is its raw elapsed time

#### Scenario: A partial-completion stage auto-skips a paused task
- **WHEN** a stage with `requiredTaskCount` is completed and its remaining paused task is auto
  skipped
- **THEN** the skipped task contributes zero excluded time

#### Scenario: The team abandons a paused task and is re-routed
- **WHEN** a team is released from a paused task without completing it and later completes it
- **THEN** only the span that ended in the completion contributes excluded time

#### Scenario: A duplicate completion is idempotent
- **WHEN** the same paused task is submitted twice
- **THEN** the second submission is a no-op and `excludedMs` keeps its first value
- **AND** the team's adjusted elapsed time is unchanged

### Requirement: Every scoring preset honours the excluded duration
The team's **adjusted elapsed time** SHALL be `max(0, rawElapsed − totalExcluded)` and SHALL be the
elapsed value used by every time-derived term:

- `time_only` SHALL rank finished teams by adjusted elapsed time.
- `fixed_points_speed` SHALL compute its speed bonus against the adjusted elapsed time.
- `finalizeRun`'s Z-Score normalisation SHALL use the adjusted elapsed time.
- The `durationSeconds` and `totalMinutes` published on a leaderboard entry SHALL be the adjusted
  values.
- Under `smart_weighted`, a paused task's per-task score SHALL be computed on-estimate
  (`actualMinutes := estimatedMinutes`), making the sigmoid multiplier independent of how long the
  team took.

The adjusted elapsed time SHALL never be negative. A team whose raw elapsed time is unavailable
(not finished) SHALL keep its existing "no duration" treatment rather than gaining one.

#### Scenario: A paused task removes exactly its own span from a timed race
- **WHEN** a `time_only` team runs for 60 minutes, 10 of them on a completed paused task
- **THEN** its ranked duration is 50 minutes
- **AND** it outranks a team that ran 55 minutes with no paused task

#### Scenario: A paused task is scored on estimate under smart_weighted
- **WHEN** a team spends 20 minutes on a paused task estimated at 5 minutes
- **THEN** the task's earned score equals the score of the same task completed in exactly 5 minutes
- **AND** a team that spent 1 minute on it earns the same score

#### Scenario: Every task in the game pauses the clock
- **WHEN** every task a team completed carries `pausesTimer`
- **THEN** the team's adjusted elapsed time is zero rather than negative
- **AND** the leaderboard is still well-formed: contiguous ranks, finite scores, and no division by
  the elapsed time

### Requirement: Live and final standings cannot drift
The adjustment SHALL be applied inside the single shared ranking implementation
(`buildRankings`), which both `finalizeRun` and `refreshLeaderboard` use, and SHALL be a function of
the stored team documents alone — not of the reference instant, not of the current game template,
not of any client input.

Editing a game's `pausesTimer` while a run is live SHALL NOT retroactively change the excluded time
of a task the team already completed.

#### Scenario: The live board agrees with the final board
- **WHEN** the leaderboard is refreshed mid-run and the run is later finalised with no further team
  activity
- **THEN** each team's score, adjusted duration and rank are identical in both boards

#### Scenario: A mid-run template edit does not re-time completed work
- **WHEN** a creator turns `pausesTimer` on for a task after a team already completed it
- **THEN** that team's already-stamped excluded time is unchanged
- **AND** only completions occurring after the edit carry the new behaviour

### Requirement: Routing pace ignores paused tasks
`computeSkillRatio` SHALL exclude any completed task record that carries an `excludedMs` stamp from
the team's measured pace, so a paused task can make the team look neither faster nor slower than it
is. When no measurable record remains, the ratio SHALL be the existing neutral value.

#### Scenario: A long paused task does not make a team look slow
- **WHEN** a team's only completed tasks are paused ones on which it spent far longer than the
  estimate
- **THEN** its skill ratio is the neutral value, not the "slower than estimate" extreme
- **AND** routing offers it the same difficulty mix as a team with no completed tasks

#### Scenario: An instantly completed paused task is still ignored
- **WHEN** a paused task is completed in under a second, stamping `excludedMs: 0`
- **THEN** it is still excluded from the pace sample

### Requirement: The participant is told the clock is paused
While a team is on a task whose clock is paused, the participant app SHALL state that the timer is
stopped for this task, in the participant's language, using the shared translation dictionaries. The
flag SHALL reach the participant through the existing task sanitizer and SHALL be added to the e2e
participant-payload allowlist.

#### Scenario: The notice is shown on a paused task
- **WHEN** a team opens a task carrying `pausesTimer`
- **THEN** the task card states that the clock is stopped and there is no need to hurry

#### Scenario: Nothing new is shown on an ordinary task
- **WHEN** a team opens a task without `pausesTimer`
- **THEN** the task card is unchanged
