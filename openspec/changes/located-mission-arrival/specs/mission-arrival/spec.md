## ADDED Requirements

### Requirement: A located mission opens on arrival
In a run launched after this capability exists, a mission with a location SHALL show a participant only
its name, points, location and distance until the team has arrived within the mission's radius; its
instructions and answer inputs SHALL open on arrival. Locationless missions SHALL be unaffected, and
runs launched earlier SHALL keep their behaviour.

#### Scenario: Before arrival
- **GIVEN** a team whose current mission has a location 300 m away
- **THEN** the player sees the mission's name, points and distance and an instruction to walk to the point
- **AND** the player does not see the mission's instructions or answer inputs

#### Scenario: On arrival
- **WHEN** the team's phone reports a position inside the mission's radius
- **THEN** the mission's instructions and inputs open

#### Scenario: A locationless mission
- **GIVEN** a mission without a location
- **THEN** it opens immediately as before

### Requirement: An operator can let a team in
The platform SHALL let the run's owner, a platform admin or staff with the routing permission mark a
team as arrived at its mission when its phone cannot prove it, and SHALL record who did it.

#### Scenario: GPS fails indoors
- **GIVEN** a team at the right place whose phone cannot get a usable position
- **WHEN** the organizer marks it as arrived
- **THEN** the mission opens on the team's phone

### Requirement: The map shows where to go
When a team receives a located mission, the participant map SHALL move to the mission, then show both
the mission and the team, and SHALL draw an arrow from the team toward the mission. The mission's pin
SHALL be visually distinct and labelled, and the map SHALL state the distance to it.

#### Scenario: A new located mission
- **WHEN** the team is assigned a located mission
- **THEN** the map moves to that mission and then frames the mission and the team together
- **AND** an arrow points from the team to the mission

### Requirement: Every mission is on the map
The participant map SHALL show the location of every mission of the game that has a location,
including locked ones, marked as done, current, open or locked. A mission whose location is hidden
SHALL show only its search area, never its exact location.

#### Scenario: A locked mission
- **GIVEN** a mission in a stage the team has not reached
- **THEN** its location is on the map, marked as locked

#### Scenario: A hidden mission
- **GIVEN** a mission whose location is hidden
- **THEN** only its search circle is on the map
