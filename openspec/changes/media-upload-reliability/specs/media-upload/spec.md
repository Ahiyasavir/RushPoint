## ADDED Requirements

### Requirement: Uploads start when the capture is ready
The participant app SHALL begin uploading a photo, audio clip or video clip as soon as the capture
is ready, before the participant presses send. Pressing send SHALL wait for that upload and then
record the submission. Replacing the capture SHALL cancel the upload in progress and upload the
replacement.

#### Scenario: Send after the clip already uploaded
- **GIVEN** a recorded clip whose background upload has finished
- **WHEN** the participant presses send
- **THEN** no media bytes are uploaded again
- **AND** the submission is recorded with the already-uploaded file

### Requirement: A slow upload is not treated as a failed upload
An upload that keeps making progress SHALL NOT be aborted for exceeding a fixed duration below a
limit derived from its size. Only an upload that makes no progress for the stall interval SHALL be
treated as failed. The upload server SHALL accept uploads that run for longer than five minutes.

#### Scenario: A large clip on a slow uplink
- **GIVEN** a 12 MB clip uploading steadily at 0.5 Mbps
- **WHEN** 180 seconds have elapsed and the upload is still progressing
- **THEN** the upload continues until it completes

### Requirement: A server-side stall is retryable
When the upload server abandons an upload because no bytes arrived for the stall interval, it SHALL
answer with a status the participant app treats as retryable, and the app SHALL retry.

#### Scenario: The phone paused sending
- **WHEN** the upload server stops an upload for inactivity
- **THEN** it answers 408
- **AND** the participant app retries the upload

### Requirement: Opening the camera cannot disable the recorder forever
The participant app SHALL leave the camera-opening state when the device has neither granted nor
denied camera access within the camera-open deadline, SHALL say that the camera did not open, and
SHALL offer the phone's own camera.

#### Scenario: Camera request never resolves
- **WHEN** the camera request has not settled after the deadline
- **THEN** the start control is enabled again
- **AND** the native camera option is offered

### Requirement: Every upload is measured
The upload server SHALL record, for every upload request, the media kind, byte count, duration and
outcome, without recording the uploader's identity.

#### Scenario: A successful upload is logged
- **WHEN** an upload completes
- **THEN** one log record carries its kind, bytes, duration and the outcome "ok"
- **AND** the record contains no user id
