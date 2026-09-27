## ADDED Requirements

### Requirement: A station code mission can award points by code
A creator SHALL be able to give a station code mission several codes, each with its own non-negative
points and a name. When a team enters one of those codes the mission SHALL be completed with that
code's points as its award. A code matching none SHALL be refused as an incorrect code under the
mission's attempt rules. Code matching SHALL ignore letter case, surrounding and repeated spaces, and
Hebrew vowel marks. The printable station QR sheet SHALL print one labelled QR code per code.

#### Scenario: The operator hands out a code
- **GIVEN** a station code mission where "זעתר" earns 50 points and "מרווה" earns 100 points
- **WHEN** team A enters "זעתר" and team B enters "מרווה"
- **THEN** team A earns 50 points for the mission
- **AND** team B earns 100 points for the mission

#### Scenario: Vowel marks and spaces
- **WHEN** a team enters "זַעְתָּר " for that mission
- **THEN** it earns 50 points

#### Scenario: An unknown code
- **WHEN** a team enters "נענע" for that mission
- **THEN** the code is refused as incorrect and the attempt is counted

### Requirement: A question can award points by answer
A creator SHALL be able to define, for a quiz or numeric mission, between two and ten answer
outcomes, each with the answers or number range it accepts and the non-negative points it earns.
The platform SHALL refuse outcomes that overlap. When a team's answer matches an outcome, the mission
SHALL be completed with that outcome's points as its award. When it matches none, the answer SHALL be
treated as a wrong answer unless the creator set points for any other answer.

#### Scenario: Two answers, two awards
- **GIVEN** a quiz where "X" earns 50 points and "Y" earns 20 points, in a fixed-points game
- **WHEN** team A answers "Y" and team B answers "X"
- **THEN** team A earns 20 points for the mission
- **AND** team B earns 50 points for the mission

#### Scenario: A number range
- **GIVEN** a numeric question where 90 to 110 earns 50 points and 70 to 130 earns 20 points
- **WHEN** a team answers 110
- **THEN** the team earns 50 points

#### Scenario: An unexpected answer
- **GIVEN** a question with outcomes and no points for other answers
- **WHEN** a team answers something matching no outcome
- **THEN** the answer counts as a wrong answer under the mission's retry rules

### Requirement: Answer outcomes stay secret
The platform SHALL NOT send the accepted answers or the points of answer outcomes to participants,
except the outcome labels needed to show answer buttons and, when the creator chooses, each button's
points. Shared and public views of the game SHALL withhold them.

#### Scenario: The participant payload
- **WHEN** a participant loads a mission with answer outcomes shown as buttons
- **THEN** it receives the button labels
- **AND** it does not receive the points or the accepted answers

### Requirement: Points by answer follow the game's scoring
Under fixed-points scoring and smart-weighted scoring the matched outcome's points SHALL be the
mission's award. In a time-only game, outcomes SHALL decide only whether the answer is accepted, and
the editor SHALL NOT allow points on them.

#### Scenario: Smart-weighted game
- **GIVEN** a smart-weighted game with an outcome worth 40 points
- **WHEN** a team hits that outcome
- **THEN** the team earns exactly 40 points for the mission
