## ADDED Requirements

### Requirement: SOS points to emergency services first
The participant app SHALL show, in the SOS confirmation, a one-tap call to 101 for an injury or real
danger, before the option to alert the organizers. It SHALL show the same call option when the alert
was sent and when it failed, and SHALL NOT tell players that help is on the way.

#### Scenario: Opening SOS
- **WHEN** a player taps SOS
- **THEN** the confirmation offers a control that dials 101
- **AND** it still offers sending the alert to the organizers

#### Scenario: The alert could not be sent
- **WHEN** sending the SOS alert fails
- **THEN** the player is told it failed and is offered the 101 call control
