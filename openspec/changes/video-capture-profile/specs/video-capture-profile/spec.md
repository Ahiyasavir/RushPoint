## ADDED Requirements

### Requirement: The recorder asks for a frame it can encode well

The participant video recorder SHALL request a capture resolution and frame rate rather
than accepting the camera's default, and its bit budget SHALL be chosen for that frame.

The request SHALL be expressed as a preference, never as a hard requirement, so a
device that cannot provide the preferred frame still yields a working camera instead of
failing to open one. A camera that ignores the preference SHALL still produce a usable
recording.

#### Scenario: The recorder states a preferred frame

- **WHEN** the in-app recorder opens the camera
- **THEN** it asks for a bounded resolution and frame rate
- **AND** it asks for them as preferences, so an unusual device is not refused a camera

#### Scenario: A device that cannot honour the preference still records

- **WHEN** the camera cannot provide the preferred frame
- **THEN** the recorder still opens and still produces a clip

### Requirement: The clip size ceiling stays derivable

The largest clip the recorder can produce SHALL remain calculable from the pinned
bitrates and the maximum clip length, and SHALL stay below the participant upload
ceiling with headroom.

Changing the bit budget SHALL NOT be able to silently push a ceiling-length clip past
the upload limit: the arithmetic SHALL be asserted, not commented.

#### Scenario: A ceiling length clip fits under the upload cap

- **WHEN** a clip is recorded at the maximum permitted length
- **THEN** its predicted size is below the participant video upload ceiling

#### Scenario: The headroom is not reduced

- **WHEN** the bit budget changes
- **THEN** the predicted ceiling length clip is no larger than it was before the change

### Requirement: An oversized clip gives advice that can work

A clip picked from the device's own camera app that exceeds the upload ceiling SHALL
leave the player with a route that can actually succeed.

Advice to film a shorter clip SHALL NOT be the only thing offered when the in-app
recorder is available, because a clip filmed at a very high resolution can exceed the
ceiling in a few seconds and filming shorter will not bring it under.

#### Scenario: A large picked clip routes to the in-app recorder

- **WHEN** a picked clip is refused for being too large and the in-app recorder is
  available on this device
- **THEN** the player is pointed at the in-app recorder as the way through

#### Scenario: A device with no in-app recorder still gets usable advice

- **WHEN** a picked clip is refused for being too large and the in-app recorder is not
  available
- **THEN** the player is still told what they can do
