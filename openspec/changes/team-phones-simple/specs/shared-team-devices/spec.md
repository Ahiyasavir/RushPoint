## ADDED Requirements

### Requirement: A phone joins its team from one link
The participant app SHALL provide, on every team screen, a link and a QR code that carry both the
run's access code and the team's device code, and opening that link SHALL present joining that
named team with only the member's name to enter.

#### Scenario: Scan to join a team
- **GIVEN** a team that has joined a run
- **WHEN** a teammate scans the team's "add a phone" QR on another phone and enters a name
- **THEN** that phone is attached to the same team
- **AND** it shows the team's current state

### Requirement: Media can be sent from any phone of the team
The platform SHALL accept a photo, audio or video submission from any device attached to the team,
SHALL record which device sent it, and SHALL keep graded-answer submissions restricted to the
team's sending phone.

#### Scenario: A non-sending phone sends a photo
- **GIVEN** a team with two attached phones where the first is the sending phone
- **WHEN** the second phone submits a photo for a photo mission
- **THEN** the submission is accepted and attributed to the second phone

#### Scenario: A non-sending phone cannot answer a quiz
- **WHEN** the second phone submits an answer to a quiz mission
- **THEN** the submission is refused because it is not the sending phone

### Requirement: A viewing phone explains itself where the controls are
The participant app SHALL NOT render disabled mission controls on a phone that is not the sending
phone. It SHALL show, in their place, who is sending for the team and a control to take over
sending from this phone.

#### Scenario: Take over from the mission card
- **GIVEN** a phone that is not the sending phone, on a quiz mission
- **WHEN** the member taps "send from my phone"
- **THEN** this phone becomes the sending phone without a confirmation dialog
- **AND** the previous sending phone is offered to take it back

### Requirement: A silent sending phone is noticed
The platform SHALL tell the team's other phones when the sending phone has not been seen for three
minutes while they have, and SHALL offer to take over. It SHALL NOT make that claim when the
sending phone's last contact is unknown.

#### Scenario: The sending phone died
- **GIVEN** the sending phone last contacted the server four minutes ago
- **AND** another phone of the team contacted it within the last minute
- **WHEN** the other phone refreshes its state
- **THEN** it is told the sending phone seems offline and offered to take over
