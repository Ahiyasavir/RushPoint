## ADDED Requirements

### Requirement: Any attached phone that may submit can upload its media
The participant app SHALL upload a device's media into the storage folder of that device's own
signed-in identity, so that every attached device permitted to submit for its team can upload
successfully.

#### Scenario: A second phone takes control and submits a photo
- **GIVEN** a team with a founding phone and a second phone attached with the device join code
- **AND** the second phone has taken control
- **WHEN** the second phone captures and sends a photo for a photo mission
- **THEN** the upload succeeds
- **AND** the submission is recorded for the team

### Requirement: A refused upload says why
The participant app SHALL tell the participant, in their language, that this phone is not
permitted to send for the team when the upload server refuses an upload for folder ownership,
rather than showing a generic failure.

#### Scenario: Folder refusal
- **WHEN** the upload server answers 403 to a media upload
- **THEN** the participant sees the specific "not allowed from this phone" message
