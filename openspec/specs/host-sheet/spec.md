# host-sheet Specification

## Purpose
A printable briefing of any game (and optionally one run) for its host: the route, every station, how each mission is judged, every answer, and the run's staff codes on a tear-off page.
## Requirements
### Requirement: Any game can be printed as a host sheet

The creator console SHALL render a printable host sheet for any game the signed-in
creator owns, listing every stage in order with its completion rule in words, and a
card for every mission with its type in words, its location (or "from anywhere"), its
approval mode, its points, its hint and price, its limits and its operator notes.

#### Scenario: A partial stage
- **WHEN** a stage requires 2 of its 4 missions
- **THEN** the stage's rule reads "2 of 4"

#### Scenario: A mission with no location
- **WHEN** a mission is locationless
- **THEN** its card says it is played from anywhere and shows no coordinates

#### Scenario: A hidden mission
- **WHEN** a mission's location is hidden from players
- **THEN** its card shows both the real spot and the clue players receive

### Requirement: Approval on paper matches the server

The host sheet SHALL state a mission as approved automatically exactly when the server
would approve its submission without a person, and SHALL note when a video outside
its length range still waits for a person.

#### Scenario: A photo mission in a run that approves everything
- **WHEN** a photo mission has no per-mission auto-approve and the run approves all media
- **THEN** its card says approval is automatic

#### Scenario: A code mission
- **WHEN** a mission is checked by a secret code
- **THEN** its card says it is checked automatically

### Requirement: Every answer is printed when answers are included

With answers included, the sheet SHALL print, per mission type: the accepted answers
(and every choice with the correct one marked), a number with its tolerance, each step
of a sequence with its answer, the correct order of an ordering mission, the secret
code, and each scored answer with its points; for a survey, check-in or self-report it
SHALL say in words how the mission counts as done. A condensed answer table SHALL list
every mission with its answer.

#### Scenario: A numeric mission
- **WHEN** a numeric mission expects 37 with a tolerance of 2
- **THEN** its answer reads "37 (±2)"

### Requirement: A copy without answers carries no secret

The sheet SHALL contain no answer, accepted code, secret code, hint text, step answer,
answer outcome, ordering key or staff code anywhere when answers are excluded.

#### Scenario: Printing for a helper
- **WHEN** the host turns "include answers" off
- **THEN** the sheet contains none of the game's secret values and no staff-codes page

### Requirement: Staff codes are a tear-off last page of a run sheet

When the sheet is printed for a run with answers included, it SHALL end with a page of
the run's active staff codes, one card each with its name, what it allows, the code and
a QR to the staff sign-in. A disabled code SHALL NOT be printed. A sheet printed for a
game without a run SHALL have no staff page.

#### Scenario: A disabled code
- **WHEN** one of the run's staff codes is disabled
- **THEN** it does not appear on the staff page

### Requirement: The sheet prints on A4 and reads in black and white

The sheet SHALL print on A4 portrait without the app's header or controls, SHALL NOT
split a mission card across pages, and SHALL convey every state with a word or icon,
never colour alone. It SHALL never throw on a malformed or empty game.

#### Scenario: An empty game
- **WHEN** the game has no stages
- **THEN** the sheet renders its cover and an empty route, without an error

