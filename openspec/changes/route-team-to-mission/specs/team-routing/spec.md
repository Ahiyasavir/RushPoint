## ADDED Requirements

### Requirement: An operator can send a team to any mission
The platform SHALL let the run's owner, a platform admin, or staff of that run with the routing
permission send one team to any mission of the game that the team has not already done, in any stage,
while the run is live. The operator SHALL choose to send it now or after its current mission.

#### Scenario: Send now
- **GIVEN** a team working on mission A
- **WHEN** the organizer sends it now to mission B
- **THEN** mission B is the team's current mission
- **AND** mission A is available to it again and was not skipped

#### Scenario: Send after the current mission
- **GIVEN** a team working on mission A
- **WHEN** the organizer sends it to mission B after its current mission
- **THEN** the team keeps mission A
- **AND** when it completes mission A it is given mission B

#### Scenario: A mission in another stage is visited
- **GIVEN** a team in stage 1
- **WHEN** the organizer sends it to a mission of stage 3 and the team completes it
- **THEN** the team earns that mission's points
- **AND** the team's current stage is still stage 1

### Requirement: Only the conditions blocking this assignment are waived
Before sending, the platform SHALL show the exact list of conditions that block the chosen mission for
that team. Only the listed conditions SHALL be waived, only for that team and that assignment. No other
condition, mission, team or the game itself SHALL change. If the list changed before the operator
confirmed, the platform SHALL refuse and show the new list.

#### Scenario: One of two prerequisites is missing
- **GIVEN** mission Z opens after missions X and Y, and the team completed X but not Y
- **WHEN** the organizer chooses Z for the team
- **THEN** the only listed condition is that Y is not done
- **AND** after confirming, the team gets Z
- **AND** another mission that also requires Y is still locked for the team

#### Scenario: Something new blocks the jump
- **GIVEN** the organizer confirmed a list that did not include "station full"
- **WHEN** the station filled up before the request arrived
- **THEN** the request is refused
- **AND** the organizer sees the new list

#### Scenario: A closed mission cannot be forced
- **GIVEN** a mission the organizers closed for this run
- **WHEN** an operator tries to send a team to it
- **THEN** the request is refused with the reason that the mission is closed
