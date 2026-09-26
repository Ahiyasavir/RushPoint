## ADDED Requirements

### Requirement: Players can switch camera before capturing
The participant app SHALL offer a camera-switch control in the capture view of photo and video
missions whenever the device has more than one camera, and SHALL NOT show it while a video is
recording.

#### Scenario: Flip to the front camera before filming
- **GIVEN** a phone with a front and a rear camera, on a video mission's capture view
- **WHEN** the player taps the camera-switch control
- **THEN** the live view shows the front camera
- **AND** the next recording uses the front camera

#### Scenario: Take a selfie photo
- **GIVEN** a photo mission's capture view
- **WHEN** the player switches to the front camera and takes the photo
- **THEN** the photo is captured from the front camera and is not mirrored

### Requirement: The phone's own camera remains available
The participant app SHALL keep offering the phone's own camera for photo and video missions, and
SHALL use it automatically when the in-app camera cannot be opened.

#### Scenario: In-app camera refused
- **WHEN** camera access for the in-app camera is refused
- **THEN** the player is offered the phone's own camera to complete the mission

### Requirement: A mission can open on the front camera
A creator SHALL be able to mark a photo or video mission as a selfie mission, and that mission's
capture view SHALL open on the front camera unless the player has chosen a camera during this run.

#### Scenario: Selfie mission default
- **GIVEN** a photo mission marked as a selfie mission
- **WHEN** a player who has not switched camera during the run opens its capture view
- **THEN** the front camera is shown
