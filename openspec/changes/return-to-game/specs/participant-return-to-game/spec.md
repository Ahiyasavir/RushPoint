## ADDED Requirements

### Requirement: Searching keeps the game open
The play screen's menu SHALL offer a web search that opens in a new browser tab, so the game's own
tab is never navigated away.

#### Scenario: A player searches from the menu
- **WHEN** a player opens the menu on the waiting screen or during play and chooses Search the web
- **THEN** a search page opens in a new tab (`target="_blank"`, `rel` including `noopener`)
- **AND** the game's tab stays on the game

### Requirement: The screen says how to get back
The waiting screen SHALL tell the team, in the active language and in one short sentence, that
scanning the code again brings them back to where they were.

#### Scenario: A team waits for the start
- **WHEN** a team has joined and the race has not started
- **THEN** the waiting screen shows the return tip in Hebrew or English, matching the app's language

### Requirement: The printed sign says how to get back
The printed join sign SHALL carry a line telling a player who left the game to scan the same code
again.

#### Scenario: The organizer prints the join sign for a run
- **WHEN** the join sign is printed for a run that has a join code
- **THEN** under the code it says that scanning this code again returns a player who left the game
