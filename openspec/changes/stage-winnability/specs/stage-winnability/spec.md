## ADDED Requirements

### Requirement: The platform computes one ceiling on how many tasks of a stage a team can complete

The platform SHALL derive, from a stage alone, the maximum number of that stage's tasks a single team
can ever complete. That maximum SHALL be the number of tasks belonging to no effective mutually
exclusive group, plus one for each effective group.

A group SHALL be effective only when it names at least two tasks of that stage. A group naming fewer
than two, an empty group, and a group naming only tasks of other stages SHALL have no effect on the
maximum. A task named by more than one group SHALL count once, toward the first group that names it.

This maximum SHALL be computed in exactly one place and consumed by every surface that depends on it,
so the authoring control, the launch guard, the server validation and the live-operations guard can
never disagree.

#### Scenario: A stage with no exclusive groups

- **WHEN** the maximum is computed for a stage of six tasks with no exclusive groups
- **THEN** the maximum is six

#### Scenario: The reported stage

- **WHEN** the maximum is computed for a stage of six tasks arranged as three exclusive groups of two
- **THEN** the maximum is three

#### Scenario: Grouped and ungrouped tasks mixed

- **WHEN** the maximum is computed for a stage of five tasks where two of them form one exclusive
  group
- **THEN** the maximum is four

#### Scenario: A group that names a single task

- **WHEN** the maximum is computed for a stage whose only group names one task
- **THEN** the group has no effect and the maximum is the number of tasks

#### Scenario: A stage with no tasks

- **WHEN** the maximum is computed for a stage with no tasks
- **THEN** the maximum is zero

### Requirement: The authoring control never offers an unreachable completion count

The stage authoring control that sets how many tasks a team must complete SHALL NOT offer any value
greater than the maximum for that stage, and SHALL explain to the creator why the offered values stop
where they do.

When a stage already carries a stored completion count greater than its maximum, the platform SHALL
NOT silently change the stored value. It SHALL show the creator that the stored count cannot be
reached, state the reachable maximum, and offer a single explicit action that corrects the value.

#### Scenario: Authoring a stage whose tasks are all alternatives

- **WHEN** a creator opens the completion control on a stage of six tasks in three groups of two
- **THEN** the control offers at most three, and the accompanying text explains that some of the
  tasks are alternatives

#### Scenario: Opening a game saved with an unreachable count

- **WHEN** a creator opens a stage that was saved requiring six of six tasks while three of them are
  alternatives
- **THEN** the stored value is still shown, the creator is told it cannot be reached and what the
  reachable maximum is, and an explicit action sets it to that maximum

### Requirement: A game whose stage requires more than it can yield cannot be launched

The platform SHALL treat a stage whose required completion count exceeds its maximum as a launch
blocker, name that stage to the creator, and refuse to launch the game from every surface that
launches games.

A stage with no explicit required completion count SHALL never be a blocker, because requiring every
task is satisfied by the stage ending once no task remains to do.

#### Scenario: An already saved game is opened

- **WHEN** a creator opens a game containing a stage that requires more tasks than it can yield
- **THEN** the readiness surface names that stage as unwinnable

#### Scenario: Launching from a surface with no readiness panel

- **WHEN** a launch is attempted for that game from a surface that shows no readiness panel
- **THEN** the launch is refused and the offending stage is named

### Requirement: The server refuses to store an unreachable completion count

The server SHALL reject any attempt to store a stage whose required completion count exceeds that
stage's maximum, whether the stage arrives from the authoring client or from an imported game file,
and SHALL NOT store any part of that submission. The rejection SHALL state the offending stage, the
submitted count and the reachable maximum.

The server SHALL reject rather than adjust the value, so a creator can never be shown one design
while a different one is stored.

#### Scenario: A stale client sends an unreachable count

- **WHEN** a game save arrives requiring six tasks of a stage that can yield three
- **THEN** the save is refused as an invalid argument, naming the stage, the count and the maximum,
  and the stored game is unchanged

#### Scenario: An imported game file carries an unreachable count

- **WHEN** a game file containing such a stage is imported
- **THEN** the import is refused on the same terms as an authored save, and no game is created

### Requirement: Taking a task out of play during a run respects the same ceiling

When an operator takes a task out of play for a live run, the platform SHALL judge whether the owning
stage can still be finished using the same maximum, counting a group of alternatives as one
completion and counting a group as unavailable only when every one of its members is unavailable.

The required count it is compared against SHALL itself never exceed that stage's maximum.

#### Scenario: Pausing one alternative of a pair

- **WHEN** an operator pauses one task of a two-task exclusive group in a stage that requires one
  completion
- **THEN** the stage is not reported as unwinnable, because the other alternative remains playable

#### Scenario: Pausing every alternative of a group

- **WHEN** an operator pauses both tasks of a two-task exclusive group in a stage that requires every
  group to be answered
- **THEN** the stage is reported as unwinnable before the change is applied
