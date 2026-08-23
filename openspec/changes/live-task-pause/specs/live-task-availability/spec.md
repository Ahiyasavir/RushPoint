## ADDED Requirements

### Requirement: An authorized operator can take a task out of play for a live run

The platform SHALL provide an authorized server callable that sets a task's availability for ONE
run to active, paused or closed, and that is the only writer of that state.

The override SHALL be scoped to the run. It SHALL NOT modify the game template, and it SHALL NOT be
visible to any other run, to a duplicate of the game, to an exported game file, or to the public
gallery.

The callable SHALL be authorized for the game owner and for staff scoped to that run, and SHALL be
denied to participants, to unrelated accounts, and to staff scoped to a different run. It SHALL
record every accepted change in the durable audit trail, including who acted, the previous and the
new availability, and whether the change was forced.

A status value that is not one of the three supported values SHALL be rejected as an invalid
argument, and nothing SHALL be written.

Every transition between the three supported values SHALL be permitted, including reopening a closed
task. A change to the value a task already has SHALL be accepted as a no-op and SHALL be idempotent.

#### Scenario: Staff pause a dead stop

- **WHEN** a staff member scoped to the run sets a task to paused
- **THEN** the run records the override, an audit entry is written with the previous and new value,
  and the game template is unchanged

#### Scenario: A participant tries to pause a task

- **WHEN** a participant of the run calls the availability callable
- **THEN** the call is denied and nothing is written

#### Scenario: An unsupported status value

- **WHEN** the callable is asked to set a status that is not active, paused or closed
- **THEN** the call fails as an invalid argument and nothing is written

### Requirement: A paused or closed task is never handed out

Routing SHALL treat a task whose effective availability is paused or closed as ineligible: it SHALL
NOT be assigned to a team, and it SHALL NOT appear among recommended tasks.

Effective availability SHALL be resolved as the run override when present, otherwise the task's own
status, otherwise active. Resolution SHALL be total: an absent, empty, malformed or unrecognized
value at either level SHALL resolve to active rather than raising an error or rendering the task
permanently unroutable.

#### Scenario: A paused task is skipped by assignment

- **WHEN** a team requests its next task in a stage where one task is paused for this run
- **THEN** the team is assigned one of the remaining available tasks and never the paused one

#### Scenario: A malformed override

- **WHEN** the run carries an override value that is not a recognized availability
- **THEN** the task resolves to active and remains assignable

### Requirement: A team already holding a task can still finish it when the task is taken out of play

Taking a task out of play SHALL NOT revoke it from any team that already holds it, SHALL NOT clear
that team's active task, and SHALL NOT release its station slot. Such a team SHALL be able to
complete the task and SHALL be scored for it exactly as if the task had not been taken out of play.

The callable SHALL report how many teams hold the task at the moment of the change, so the operator
is told what the change does and does not affect.

#### Scenario: A team standing at the station when it is paused

- **WHEN** a task is paused while two teams have it in flight
- **THEN** both teams keep the task, can complete it, are scored for it, and the response reports
  that two teams were holding it

### Requirement: The operator is warned when taking a task out of play would make a stage unwinnable

Before writing the change, the platform SHALL evaluate whether the stage that owns the task can
still yield the number of tasks it requires for completion. The required number SHALL be the stage's
required task count, clamped to the number of tasks in the stage, and SHALL default to every task in
the stage when no required count is set.

When the change would leave fewer available tasks than the stage requires, the callable SHALL refuse
it and SHALL return the stage, the number of tasks that would remain available and the number
required, so the operator learns it at the moment they act rather than through stuck teams. Nothing
SHALL be written on that refusal.

The operator SHALL be able to proceed deliberately with an explicit force, which SHALL be recorded
in the audit entry. Restoring a task to active SHALL never be refused.

#### Scenario: The pause would break the stage

- **WHEN** an operator pauses a task in a stage that requires three tasks and would be left with one
  available
- **THEN** the call is refused, the response states one available against three required, and the
  run is unchanged

#### Scenario: The stage is still satisfiable

- **WHEN** an operator pauses one task in a four task stage that requires two
- **THEN** the change is applied without a warning

#### Scenario: Proceeding anyway

- **WHEN** the operator repeats the refused change with an explicit force
- **THEN** the change is applied and the audit entry records that it was forced

### Requirement: The run console exposes per task availability

The run console SHALL show, for a live run, each task of the game with its current availability and
SHALL offer a control to pause, close or restore it. The control SHALL reflect changes made by
anyone with access to the run without requiring a reload.

When the server refuses a change because it would make a stage unwinnable, the console SHALL present
the stage and the numbers returned by the server and SHALL require a separate, explicit confirmation
before retrying with force.

All copy SHALL be available in Hebrew and English through the shared dictionary, and user authored
task titles SHALL render with automatic direction.

#### Scenario: Pausing from the console

- **WHEN** the organizer pauses a task from the run console
- **THEN** the task shows as paused for every console watching that run

#### Scenario: The console surfaces the unwinnable warning

- **WHEN** the server refuses the pause because the stage would become unwinnable
- **THEN** the console shows the stage and the available against required counts and asks for an
  explicit confirmation before forcing
