## ADDED Requirements

### Requirement: A finished team's fixed-points speed bonus is immutable against later template edits
The `fixed_points_speed` route "expected total minutes" that feeds a team's speed bonus SHALL be a
pure function of the STORED team document. For each task a team completes or skips, the server SHALL
stamp the resolved expected duration onto that team's own task record at the moment the record reaches
a terminal state, using the same resolution the score uses today
(`expectedDurationMinutes ?? estimatedMinutes`, treated as 0 when non-finite or not greater than 0).
The route expected total SHALL be summed from those stored stamps, never re-derived from the current
game template.

Consequently, editing any task's expected duration after a team has finished SHALL NOT change that
team's score on any subsequent recompute (live `refreshLeaderboard` or `finalizeRun`), so the live and
final boards cannot drift and the live board cannot jump on a template edit.

#### Scenario: Editing a completed task's expected duration does not re-score a finished team
- **WHEN** a `fixed_points_speed` run has a team that has finished, and the creator then lowers the
  `expectedDurationMinutes` of a task that team already completed
- **THEN** the next leaderboard recompute leaves that finished team's score unchanged
- **AND** the team's rank relative to the other finished teams is unchanged

#### Scenario: A mid-run edit near the bonus cap cannot flip two close finished teams
- **WHEN** two finished teams have speed bonuses close to the 200-point cap and the creator edits a
  task's expected duration mid-run
- **THEN** the recomputed order of those two teams is the same as before the edit

### Requirement: An unedited run scores identically to before this change
When no task's expected duration is edited during a run, the summed per-task stamps SHALL equal the
value the previous template reduce produced, so every such run — the common case — scores byte-for-byte
identically to before this change. No other scoring preset SHALL change: `time_only` and
`smart_weighted` do not read a route-level expected total and SHALL be unaffected.

#### Scenario: An unedited fixed-points run is unchanged
- **WHEN** a `fixed_points_speed` run is scored and no task's expected duration was edited during it
- **THEN** every team's speed bonus and final score is identical to the value produced before this
  change

#### Scenario: Other presets are unaffected
- **WHEN** a `time_only` or `smart_weighted` run is scored
- **THEN** its scores are identical to before this change and no route expected-total stamp affects
  them

### Requirement: Legacy and in-flight records fall back to the template without error
A task record that carries no stamp SHALL contribute its task's resolved template expected duration
to the route total — this covers every record written before this change and any run started before
this change ships — so old runs keep scoring (the pre-change behavior for that task) and the
summation never throws or yields a non-finite total. A record whose template task can no longer be found SHALL
contribute its stamp if present and otherwise zero, never `NaN`.

#### Scenario: A legacy finished team still scores via the fallback
- **WHEN** a finished team's task records carry no expected-duration stamp and its template is not
  edited
- **THEN** its speed bonus and final score equal the pre-change value for that same team and template
- **AND** the scoring computation does not throw

#### Scenario: A record for a since-deleted template task does not poison the total
- **WHEN** a team's terminal task record references a task no longer present in the template and the
  record carries no stamp
- **THEN** that record contributes zero to the route expected total and the team's total remains a
  finite number

### Requirement: The stamp is written once, server-side, at the terminal transition
The expected-duration stamp SHALL be written by the server as part of the same whole-object task-record
rewrite that marks the record completed or skipped, and SHALL NOT be derived from any value a client
reports. A duplicate submission of an already-terminal task SHALL NOT overwrite the first stamp.

#### Scenario: The first stamp is final
- **WHEN** a task is completed and then the same completion is submitted again
- **THEN** the record's stamped expected duration is the value resolved at the first completion and is
  not rewritten
