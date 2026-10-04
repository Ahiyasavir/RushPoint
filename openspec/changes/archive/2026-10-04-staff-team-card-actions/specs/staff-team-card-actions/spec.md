## ADDED Requirements

### Requirement: A staff team card shows urgent actions at once and the rest behind one button

A staff team card SHALL always show hold or release, clear out of bounds when the team is out
of bounds, and let them in when available. Score steps, a custom amount, send to a mission, skip
and send back SHALL be shown only after the marshal opens the card's actions.

#### Scenario: Six teams on a phone
- **WHEN** a marshal opens the staff app with six playing teams
- **THEN** no team card shows score steps or routing buttons until its actions are opened

#### Scenario: Holding a team
- **WHEN** a marshal needs to hold a team
- **THEN** the hold button is on the card without opening anything

### Requirement: Opening the actions never loses input

While one of a card's inline panels is open, the card's actions SHALL stay shown.

#### Scenario: Typing a custom amount
- **WHEN** a marshal is typing a custom amount
- **THEN** the actions area stays open even if the toggle is closed

### Requirement: No empty actions button

A card SHALL NOT show the actions button when nothing is behind it.

#### Scenario: A code without score or routing
- **WHEN** the marshal's code allows neither score nor routing
- **THEN** the card has no actions button
