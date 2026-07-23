## ADDED Requirements

### Requirement: An organiser can skip a single mission for a single team
The platform SHALL provide a privileged operation that marks ONE task of ONE team as skipped without
ending that team's stage. The operation SHALL accept the id of the task to skip, and, when no id is
given, SHALL resolve the mission the team is currently holding.

The operation SHALL be reachable by the run's owner, by a platform admin, and by staff whose session
is scoped to that same run, and SHALL be refused for every other caller, including a participant of
the run, a signed in stranger, and staff scoped to a different run.

The operation SHALL record a durable audit entry naming the operator, the team, the task and the
reason.

The existing whole stage skip SHALL keep working unchanged.

#### Scenario: One mission is skipped and the stage continues
- **WHEN** an organiser skips the mission a team is holding, in a stage of three missions
- **THEN** that mission is recorded as skipped for that team
- **AND** the team's stage is still active
- **AND** the other two missions of the stage are still playable by that team

#### Scenario: The team is handed its next mission in the same stage
- **WHEN** a mission is skipped for a team that has other missions left in the stage
- **THEN** the team is routed to another mission of the SAME stage
- **AND** no later stage is unlocked

#### Scenario: A participant cannot skip their own mission
- **WHEN** a participant of the run calls the skip operation for their own team
- **THEN** the call is denied
- **AND** the team's tasks are unchanged

#### Scenario: Staff of another run cannot skip
- **WHEN** staff holding a session scoped to a different run of the same game calls the operation
- **THEN** the call is denied

#### Scenario: The whole stage skip still exists
- **WHEN** an organiser skips a team's stage
- **THEN** every non completed task of that stage is skipped and the stage completes, as before

### Requirement: A skipped mission scores nothing and never returns to that team
A mission skipped for a team SHALL be recorded with an earned score of exactly zero, and SHALL NOT
contribute any consolation award.

The skipped mission SHALL NOT be assignable to that team again, for the remainder of the run.

Skipping SHALL NOT change the team's total score, and SHALL NOT alter the team's start time, finish
time, or any excluded time. The live standings and the final standings SHALL therefore continue to be
computed from the same stored team document and SHALL NOT diverge because of a skip.

#### Scenario: The skip pays nothing
- **WHEN** a mission is skipped for a team
- **THEN** the task record carries an earned score of zero
- **AND** the team's total score is the same as before the skip

#### Scenario: The skipped mission is never handed out again
- **WHEN** the team asks for its next mission repeatedly after a skip
- **THEN** the skipped mission is never returned

#### Scenario: Standings are unaffected by the act of skipping
- **WHEN** the standings are recomputed live and then finalised after a skip
- **THEN** both are derived from the stored team document
- **AND** neither introduces a value derived from the current time or from the game template

### Requirement: A skip never strands a team in an unfinishable stage
When a stage requires a number of completed missions that the skip puts out of reach, the team's own
requirement for that stage SHALL be lowered to the largest number of missions that team can still
complete in it, and SHALL NOT be lowered further.

The ceiling on completions SHALL be computed with the platform's single definition of that ceiling, so
that a set of mutually exclusive alternatives contributes at most one completion.

The lowered requirement SHALL be stored on that team's own record of the stage and SHALL NOT be
written to the game template, so no other team and no later run is affected.

When the skip leaves the stage already satisfied, or leaves no playable mission at all, the stage
SHALL complete, and SHALL complete through the same rule that governs an ordinary completion,
including the unlocking of the next stage and the auto skipping of leftovers.

#### Scenario: A stage of three requiring three drops to requiring two
- **WHEN** one of the three missions of a stage that requires all three is skipped for a team
- **THEN** that team's requirement for the stage becomes two
- **AND** the stage completes once the team completes the two remaining missions

#### Scenario: Alternatives count as one
- **WHEN** a stage offers two mutually exclusive alternatives plus one ordinary mission, requires two,
  and one alternative is skipped
- **THEN** the requirement stays at two, because the group still yields one completion
- **AND** when the second alternative is skipped as well, the requirement becomes one

#### Scenario: Skipping the last playable mission completes the stage
- **WHEN** the only mission left to play in a stage is skipped
- **THEN** the stage completes
- **AND** the next stage becomes active unless its own scheduled release has not opened

#### Scenario: Another team is unaffected
- **WHEN** a mission is skipped for one team
- **THEN** every other team's stage requirement and mission list are unchanged
- **AND** the game template is unchanged

### Requirement: A skip releases the station capacity it was holding
When the skipped mission was assigned to the team, the operation SHALL release the station occupancy
slot that assignment reserved, and SHALL release it exactly once.

A mission that was not assigned to the team SHALL NOT release anything, and no release SHALL be able
to drive a station's counter below zero.

#### Scenario: The held slot comes back
- **WHEN** the mission a team was holding is skipped
- **THEN** the station's occupancy count returns to the value it had before the assignment

#### Scenario: A repeated skip changes nothing
- **WHEN** the same mission is skipped a second time for the same team
- **THEN** the call is refused because the mission is already in a terminal state
- **AND** no score, no station counter and no stage requirement changes

### Requirement: The skip decision is a pure, total function
The decision of what a skip does SHALL be expressed as one pure function of the stage's authored
tasks, that team's per task statuses and that team's stored requirement, so that the server, the
tests and any future surface read the same rule.

The function SHALL be total: an unknown task id, an absent tasks array, absent groups, and a
requirement that is not a number, is negative, or exceeds the number of tasks SHALL each yield a
defined result rather than an exception. No result SHALL be `NaN` or negative.

The function SHALL NOT modify its inputs.

#### Scenario: Refusals are reported, not thrown
- **WHEN** the decision is computed for a task id that is not in the stage, and for a task already
  completed or already skipped
- **THEN** each returns a refusal carrying its reason
- **AND** nothing in the inputs is modified

#### Scenario: Malformed state still yields a usable plan
- **WHEN** the decision is computed for a stage with no tasks array, null groups, or a requirement of
  `NaN`, a negative number, or a number larger than the task count
- **THEN** a result is returned without throwing
- **AND** the resulting requirement is a finite number that is not negative
