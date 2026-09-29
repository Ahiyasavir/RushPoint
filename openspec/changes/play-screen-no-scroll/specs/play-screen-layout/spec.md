## ADDED Requirements

### Requirement: The game screen does not scroll
While a team is playing, the participant screen SHALL fit the phone's screen and the page SHALL NOT
scroll. When the game has a map, the map SHALL fill the screen and the mission SHALL be shown in a
sheet the player can set to a small, a middle or a full height. Only the content of the sheet at full
height, or of the mission card in a game without a map, MAY scroll inside itself.

#### Scenario: A long mission on a small phone
- **GIVEN** a 360×640 phone and a mission with long instructions
- **WHEN** the player is on the game screen
- **THEN** the page does not scroll
- **AND** the instructions scroll inside the mission sheet at full height

#### Scenario: A new mission arrives
- **WHEN** the team is given a new mission
- **THEN** the sheet shows the mission at the middle height over the map

### Requirement: Leaving the game is labelled
The participant screen SHALL NOT offer leaving the game as an unlabelled ✕. Leaving SHALL be an
item in a menu that states it leaves the game on this phone, and SHALL keep the existing confirmation.

#### Scenario: Leaving
- **WHEN** the player opens the menu
- **THEN** the item reads that it leaves the game on this phone
- **AND** choosing it asks for confirmation before leaving
