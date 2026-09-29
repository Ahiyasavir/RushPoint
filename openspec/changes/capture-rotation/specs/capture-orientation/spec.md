## ADDED Requirements

### Requirement: The phone can be rotated while capturing
The participant app SHALL NOT be locked to portrait by its manifests. While the in-app camera is open,
the app SHALL allow the phone to rotate and SHALL record video in the orientation it was filmed in.
While the camera is closed, the app SHALL ask for portrait where the platform supports it, and the game
screen SHALL remain usable in landscape where it does not.

#### Scenario: Filming in landscape
- **GIVEN** the in-app video camera is open
- **WHEN** the player turns the phone sideways
- **THEN** the camera view rotates and the clip is recorded in landscape

#### Scenario: A phone that cannot lock orientation
- **GIVEN** a phone where the app cannot request portrait
- **WHEN** the player holds it sideways on the game screen
- **THEN** the screen does not scroll and the mission can still be read and done
