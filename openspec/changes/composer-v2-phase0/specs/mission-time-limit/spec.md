## MODIFIED Requirements

### Requirement: A located mission's time limit starts when the team arrives
A mission that is sealed until arrival SHALL count its `timeLimitMinutes` from the team's arrival
at the pin, not from the moment the mission was given. Every other mission SHALL keep counting from
the moment it was given.

#### Scenario: The walk does not eat the clock
- **WHEN** a team is given a located 3 minute mission whose pin is 5 minutes away
- **THEN** no countdown runs and the mission is not closed while they walk
- **AND** on arrival the team has the full 3 minutes

#### Scenario: A mission without a pin is unchanged
- **WHEN** a team is given a locationless mission with a time limit
- **THEN** its countdown starts at once, as before

#### Scenario: A pause stops the clock after arrival too
- **WHEN** a team that already arrived is held, then released
- **THEN** the countdown continues from where it stopped
