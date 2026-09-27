## ADDED Requirements

### Requirement: An operator can return a team to a mission
The platform SHALL let the run's owner, a platform admin, or permitted staff of that run return one
team to a skipped or completed mission of its current stage or of an earlier stage, while the run is
live. The mission SHALL become playable for that team and SHALL be assigned to it when its station has
capacity. The award previously recorded for that mission SHALL be removed from the team's score,
never taking the score below zero, and the change SHALL be recorded with its reason.

#### Scenario: Undo a skip
- **GIVEN** a team whose mission M was skipped with a consolation of 30 points
- **WHEN** the organizer returns the team to M
- **THEN** M is the team's current mission
- **AND** the team's score is 30 points lower
- **AND** the team is told it was sent back to M

#### Scenario: Participants cannot rewind
- **WHEN** a participant of the run calls the operation for its own team
- **THEN** the call is denied

### Requirement: An operator can return a team to an earlier stage
The platform SHALL let an operator reopen a completed stage for one team. The reopened stage SHALL
become the team's active stage; later stages SHALL wait until it completes again while keeping the
team's completed missions in them; missions skipped by an operator or left over SHALL become playable;
missions closed by an exclusive-group choice or by expiry SHALL stay closed. When a stage becomes
active and its requirement is already met, it SHALL complete immediately.

#### Scenario: Back to stage 1 after reaching stage 2
- **GIVEN** a team that completed stage 1 and completed one mission of stage 2
- **WHEN** the organizer returns the team to stage 1
- **THEN** stage 1 is active and stage 2 is locked
- **AND** the completed mission of stage 2 is still completed

#### Scenario: A finished team is returned
- **GIVEN** a team that finished the game in a live run
- **WHEN** the organizer returns it to a mission
- **THEN** the team is active again

#### Scenario: A finalized run is frozen
- **WHEN** an operator tries to return a team in a finalized run
- **THEN** the call is refused and nothing changes

### Requirement: Sending a team back is one button away
The Run Console SHALL offer a "send back" action for every team, and the staff app SHALL offer it to
staff permitted to route teams. The action SHALL open a picker of that team's stages and missions,
marked as completed, skipped or current, and SHALL show the previewed consequence before applying it.

#### Scenario: From the teams list
- **GIVEN** a live run with a team whose stage 1 was skipped entirely
- **WHEN** the organizer opens that team's actions in the teams list
- **THEN** a "send back" action is offered
- **AND** choosing it lists stage 1 and its skipped missions as targets

### Requirement: A rewind can be previewed
The operation SHALL accept a dry-run flag that reports what would reopen, which points would be
removed and which later stages would wait, without writing anything.

#### Scenario: Preview writes nothing
- **WHEN** an organizer requests a dry-run return for a team
- **THEN** the team document is unchanged
