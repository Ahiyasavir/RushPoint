## ADDED Requirements

### Requirement: A media mission shows one truthful status
The participant app SHALL show, for a photo, audio or video mission, exactly one status derived
only from facts the system holds: the local capture/upload/submit state of this device and the
server's stored submission record for this team and mission.

The app SHALL NOT display a phase that the platform does not perform.

#### Scenario: The upload bar appears only while bytes are moving
- **WHEN** a submission has finished uploading and the submit call has returned
- **THEN** no upload progress indicator is displayed
- **AND** no control reads as "working"

#### Scenario: Waiting for approval is shown after a reload
- **GIVEN** a team whose submission for the current mission is stored as pending
- **WHEN** the participant app is reloaded on any attached device
- **THEN** the mission shows that the submission is waiting for the organizer's approval
- **AND** it shows what was sent and when

### Requirement: A rejected submission can be answered immediately
When the organizer rejects a submission, the participant app SHALL re-enable the mission's capture
and submit controls on the next state update, without a reload, and SHALL show the organizer's note
when one was given.

The app SHALL NOT re-submit the rejected file unless the participant chooses to send it again.

#### Scenario: Retake after a rejection
- **GIVEN** a submission that the organizer has just rejected with a note
- **WHEN** the team's state reaches the device
- **THEN** the rejection and its note are shown
- **AND** the capture control is enabled
- **AND** sending a new capture stores a new pending submission

### Requirement: A pending submission can be replaced on purpose
While a submission waits for approval, the participant app SHALL offer to send a different one, and
doing so SHALL replace the pending submission.

#### Scenario: Replace a pending photo
- **GIVEN** a pending photo submission
- **WHEN** the participant chooses to send a different one and submits a new photo
- **THEN** the stored submission points at the new photo and is pending
