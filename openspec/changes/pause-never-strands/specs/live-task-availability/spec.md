## MODIFIED Requirements

### Requirement: The operator is warned when taking a task out of play would make a stage unwinnable

Before writing the change, the platform SHALL evaluate whether the stage that owns the task can
still yield the number of tasks it requires for completion, and SHALL report the result with the
number of tasks that would remain available and the number required. A pause SHALL NOT be refused
because of it: no pause can strand a team (see the requirement below). Restoring a task to active
SHALL never be refused.

#### Scenario: A pause the stage cannot spare

- **WHEN** an operator pauses a task in a stage that cannot complete without it
- **THEN** the pause is applied and the response reports the stage as unwinnable with the counts

### Requirement: A pause never strands a team

When a team asks for its next mission and nothing in its active stage can be handed out for a reason
other than a full station, and nothing is in flight for that team, every unassigned mission of that
stage that is paused at that moment SHALL be set aside for that team: recorded as skipped with no
points, satisfying the unlock conditions of the missions that wait for it, and lowering the team's
requirement for the stage by the smallest amount that keeps it completable. The team SHALL then be
routed again in the same call. A team holding the paused mission SHALL keep it and may finish and
score it. A team that still has other missions to play SHALL keep the paused mission pending.

#### Scenario: A team runs out of missions because of a pause

- **GIVEN** a stage of required missions head, mid (after head) and end (after head and mid)
- **AND** mid is paused while a team is still on head
- **WHEN** the team completes head
- **THEN** mid is set aside for that team with no points and the team is given end
- **AND** after end the team reaches the next stage

#### Scenario: The team on the paused mission

- **WHEN** a team holding mid at the moment of the pause completes it
- **THEN** it scores mid and continues to end and the next stage

### Requirement: The run console exposes per task availability

The run console SHALL show, for a live run, each task of the game with its current availability and
SHALL offer a control to pause, close or restore it. The control SHALL reflect changes made by
anyone with access to the run without requiring a reload. After a pause the stage cannot spare, the
console SHALL say that teams which run out of missions because of it will skip it and move on.

All copy SHALL be available in Hebrew and English through the shared dictionary, and user authored
task titles SHALL render with automatic direction.

#### Scenario: Pausing from the console

- **WHEN** the organizer pauses a task from the run console
- **THEN** the task shows as paused for every console watching that run
