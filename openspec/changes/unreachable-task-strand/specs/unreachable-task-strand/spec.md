## ADDED Requirements

### Requirement: A team is never left holding a task it can never complete

The platform SHALL treat a task whose prerequisites can never all be completed by a given team as
finished for that team, so that the stage holding it can always end.

A prerequisite that was retired for that team, because the team completed a different alternative of
the same exclusive group or because the prerequisite was taken out of play mid run, SHALL never count
as completed, and every task gated on it, directly or through a chain of gates, SHALL be treated as
finished for that team.

This SHALL be decided from the team's own progress, not from the template, because the template alone
cannot say which alternative a team picked.

#### Scenario: A team picks the alternative that does not unlock the follow up

- **GIVEN** a stage offering two alternatives and a third task that unlocks only after the first
  alternative
- **WHEN** a team completes the second alternative
- **THEN** the first alternative is retired as it is today, the follow up task is retired too, and the
  stage ends for that team

#### Scenario: A chain of gates behind a retired task

- **GIVEN** a stage where one task unlocks after a retired task and a further task unlocks after that
  one
- **WHEN** the reachability of the stage is resolved for the team
- **THEN** both tasks are retired

#### Scenario: A team already stranded before this rule existed

- **GIVEN** a team whose stage holds only tasks it can never complete
- **WHEN** that team next asks for its next task
- **THEN** the unreachable tasks are retired, the stage ends, and the team continues its game without
  any action by an operator

### Requirement: Retirement never takes away work a team has done or is doing

The platform SHALL NOT retire a task that a team has already completed, and SHALL NOT retire a task
that the team is currently holding.

A task the team is currently holding SHALL be treated as still completable when judging every task
gated behind it, so nothing downstream is retired on the assumption that the team will fail.

Resolving reachability SHALL terminate for every stage, including one whose gates form a loop or name
a task that does not exist, and repeating it SHALL change nothing further.

#### Scenario: A completed task behind a retired prerequisite

- **WHEN** reachability is resolved for a stage where a completed task was gated on a task that has
  since been retired
- **THEN** the completed task keeps its completion

#### Scenario: A task in the team's hands

- **WHEN** reachability is resolved while the team is holding a task whose prerequisite was retired
- **THEN** that task is left in the team's hands and the stage does not end under it

#### Scenario: A stage whose gates form a loop

- **WHEN** reachability is resolved for a stage whose tasks require each other in a loop
- **THEN** the resolution terminates and reports those tasks as unable to complete

### Requirement: A task retired as unreachable scores as a skip

A task retired because it can never be completed SHALL score exactly as an automatically skipped task
scores today: it SHALL award nothing, SHALL NOT count as a completion, and SHALL NOT apply any
penalty.

The standings computed while a run is live and the standings computed when it is finalized SHALL
agree about a team whose tasks were retired this way.

#### Scenario: The stage total after a retirement

- **WHEN** a stage ends with one completed task worth points and one task retired as unreachable
- **THEN** the stage total is the points of the completed task alone

#### Scenario: Live and final standings

- **WHEN** the standings are computed for a team with retired tasks, first while the run is live and
  then when it is finalized
- **THEN** both computations report the same score for that team

### Requirement: The creator is warned when a task can only be played by part of the field

While authoring a stage, the platform SHALL tell the creator when a task unlocks only after a task
that belongs to a group of alternatives, naming the task that can go unplayed and the alternative it
depends on.

This SHALL be advisory. It SHALL NOT prevent the game from being saved, and SHALL NOT prevent it from
being launched, because gating content behind one alternative is a legitimate branching design that
now plays correctly.

#### Scenario: Authoring a branch

- **WHEN** a creator gates a task on one member of a two task group of alternatives
- **THEN** the stage shows a warning naming that task and that alternative, and the game can still be
  saved and launched

#### Scenario: A gate on a task that is not an alternative

- **WHEN** a creator gates a task on a task belonging to no group of alternatives
- **THEN** no such warning is shown
