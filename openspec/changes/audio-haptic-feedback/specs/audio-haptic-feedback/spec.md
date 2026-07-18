## ADDED Requirements

### Requirement: Synthesized event cues

The play-web app SHALL play a short cue for each of these events: task completed, stage completed,
SOS sent, staff received an SOS alert, and the team's leaderboard rank improved. Each cue's sound
SHALL be synthesized in-code via the Web Audio API (oscillator/gain envelopes) and MUST NOT fetch or
bundle any audio asset file.

#### Scenario: Task completion plays a cue

- **WHEN** a participant successfully completes a task and audio is enabled and unlocked
- **THEN** the app plays the short synthesized "task complete" sound
- **AND** triggers device vibration where the Vibration API is supported

#### Scenario: SOS send plays a distinct cue

- **WHEN** a participant triggers SOS and audio is enabled and unlocked
- **THEN** the app plays a distinct "alert" sound that is not the same as the task-complete sound

#### Scenario: Staff receives an SOS alert

- **WHEN** the staff console receives a new SOS alert and audio is enabled and unlocked
- **THEN** the app plays the alert cue so staff are notified without watching the screen

#### Scenario: Rank-up plays a cue only on improvement

- **WHEN** the team's leaderboard rank changes to a better (lower-numbered) position
- **THEN** the app plays the "rank up" cue
- **WHEN** the team's rank stays the same or gets worse
- **THEN** no cue plays

### Requirement: iOS-safe autoplay unlock

The app SHALL create/resume the Web Audio context on the first user interaction (e.g. the Join tap)
so that later cues are audible under the iOS/Safari autoplay policy. Cues requested before the
context is unlocked SHALL be silently dropped, never queued for later playback.

#### Scenario: Cue before unlock is dropped

- **WHEN** an event cue is requested before any user interaction has unlocked the audio context
- **THEN** no sound plays and the cue is not queued or replayed after unlock

#### Scenario: First interaction unlocks audio

- **WHEN** the participant makes their first interaction (such as tapping Join)
- **THEN** the audio context is created or resumed
- **AND** subsequent cues play normally while audio remains enabled

### Requirement: Persistent mute toggle

The app SHALL expose a sound on/off toggle whose state is persisted across sessions (localStorage-
backed) and defaults to on. When sound is off, no cue SHALL play any sound and no cue SHALL trigger
vibration. The toggle's label SHALL be provided in both English and Hebrew through the translation
maps (no hardcoded string).

#### Scenario: Muting silences sound and vibration

- **WHEN** the participant turns the sound toggle off
- **THEN** subsequent event cues produce neither sound nor vibration

#### Scenario: Preference persists across reloads

- **WHEN** the participant sets the sound toggle and reloads or reopens the app
- **THEN** the previously chosen state is restored

#### Scenario: Toggle label is bilingual

- **WHEN** the app language is Hebrew
- **THEN** the sound-toggle label renders in Hebrew
- **WHEN** the app language is English
- **THEN** the label renders in English

### Requirement: Graceful degradation

Missing or unsupported browser capabilities SHALL degrade silently without throwing. If the Web
Audio API is unavailable the app SHALL skip sound; if the Vibration API is unavailable the app SHALL
skip vibration; neither absence SHALL break the surrounding user flow.

#### Scenario: No Vibration API

- **WHEN** a cue fires on a browser without the Vibration API (such as iOS Safari)
- **THEN** the sound still plays (if enabled) and no error is thrown

#### Scenario: No Web Audio API

- **WHEN** a cue fires on a browser without the Web Audio API
- **THEN** no error is thrown and the surrounding flow (task completion, SOS, etc.) proceeds normally
