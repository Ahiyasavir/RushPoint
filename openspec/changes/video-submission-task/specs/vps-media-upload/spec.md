## MODIFIED Requirements

### Requirement: Content-type allowlist enforcement
The system SHALL reject any upload whose `Content-Type` header does not match the
applicable allowlist (participant vs. creator) before accepting body bytes beyond what is
needed to read the header. The participant allowlist SHALL include image types (existing),
audio types (existing), and video types: `video/webm`, `video/mp4`, and `video/quicktime`.

#### Scenario: Disallowed content type
- **WHEN** a participant PUTs with `Content-Type: application/x-msdownload`
- **THEN** the server responds `400 INVALID_ARGUMENT` and does not write any file to disk

#### Scenario: Allowed video content type accepted
- **WHEN** a participant PUTs a body with `Content-Type: video/webm` (or `video/mp4` or
  `video/quicktime`) targeting a `runs/{runId}/teams/{callerUid}/...` path
- **THEN** the content-type check passes and the request proceeds to size validation

### Requirement: Bounded-memory streaming write
The system SHALL write the request body to disk via a streaming pipeline whose peak
additional memory usage does not scale with the total file size, and SHALL NOT materialize
the complete file body as a single in-memory buffer before validating or writing it. The
applicable size cap for a video-content-type upload SHALL be a distinct, higher limit
(`MAX_PARTICIPANT_VIDEO_BYTES`) than the limit applied to non-video participant uploads
(`MAX_PARTICIPANT_BYTES`), selected based on the request's validated content-type.

#### Scenario: Large video upload within the video-specific cap
- **WHEN** an authenticated, authorized participant request with `Content-Type: video/webm`
  PUTs a body at or under `MAX_PARTICIPANT_VIDEO_BYTES` but over `MAX_PARTICIPANT_BYTES`
- **THEN** the server accepts and streams the body to completion (does not apply the
  smaller photo/audio cap to a validated video upload)

#### Scenario: Video upload exceeding the video-specific cap is still rejected early
- **WHEN** an authenticated, authorized participant request with a video content-type
  exceeds `MAX_PARTICIPANT_VIDEO_BYTES` partway through transmission
- **THEN** the server aborts the stream and deletes the partial temp file as soon as the
  video-specific cap is crossed, per the existing early-rejection requirement

## ADDED Requirements

### Requirement: Photo-task video capture kind
A `photo`-type task's `smart.captureKind` field SHALL accept the value `'video'` in addition
to the existing `'photo'` and `'audio'` values, selecting a video-capture participant
experience while reusing the existing submission lifecycle (pending/auto-approve, staff
review, task completion) unchanged.

#### Scenario: Task configured for video capture
- **WHEN** a creator sets a photo-type task's capture kind to Video in the Builder
- **THEN** the sanitized task payload sent to participants includes
  `smart.captureKind === 'video'`

#### Scenario: Participant submits a video clip
- **WHEN** a participant on a `captureKind: 'video'` task records or picks a video clip and
  submits it with a valid video content-type and a URL under their own team's upload path
- **THEN** the submission is accepted, `taskSubmissions[taskId].mediaKind` is server-set to
  `'video'`, and the task enters the same pending/auto-approve flow a photo or audio
  submission would

#### Scenario: Content-type/kind mismatch is rejected
- **WHEN** a participant submits a video content-type against a task whose `captureKind` is
  `'photo'` or `'audio'` (or vice versa — a photo/audio content-type against a
  `captureKind: 'video'` task)
- **THEN** the submission callable rejects with `invalid-argument`, unchanged from the
  existing photo/audio cross-kind rejection behavior

#### Scenario: Approved video submission completes the task
- **WHEN** staff approve a pending video submission via the existing review action
- **THEN** the task completes for the team via the same `completeTaskForTeam` path used for
  photo/audio approvals, and no live-feed item is written for the video submission

#### Scenario: Video submissions are participant-visible but never enter the live feed
- **WHEN** a `captureKind: 'video'` task's submission is auto-approved or staff-approved
- **THEN** the run's live photo/activity feed does not receive an entry for that submission,
  matching the existing audio behavior

### Requirement: Creator-configurable video duration range
A `captureKind: 'video'` task SHALL support optional creator-authored
`smart.videoMinSeconds` and `smart.videoMaxSeconds` fields bounding the participant's clip
length. The system SHALL bound both values to a fixed platform range
(`VIDEO_DURATION_LIMITS`) and SHALL apply documented defaults when either is absent.

#### Scenario: Creator sets a duration range
- **WHEN** a creator selects Video capture and sets a minimum and maximum clip length in the
  Builder
- **THEN** those values are saved to `smart.videoMinSeconds` / `smart.videoMaxSeconds` and
  are present in the sanitized task payload delivered to participants

#### Scenario: Defaults apply when unset
- **WHEN** a `captureKind: 'video'` task has no `videoMinSeconds` or `videoMaxSeconds`
- **THEN** the effective range resolves to the platform defaults (no minimum, and the
  default maximum), and the participant recorder enforces that default maximum

#### Scenario: Clearing a duration field sends it absent
- **WHEN** a creator clears a previously-set duration field in the Builder
- **THEN** the saved payload omits that key entirely rather than sending `null`, so the
  server's optional-field guards accept the save and the field reverts to its default

### Requirement: Video duration range validation
The system SHALL reject an invalid creator-authored duration range — a minimum greater than
or equal to the maximum, a value outside the platform floor/ceiling, or a non-finite value —
at authoring time, in both the Builder's inline validation and the server's `updateGame` /
`importGameFile` guards, using a single shared verdict function.

#### Scenario: Inverted range is refused
- **WHEN** a creator (or an imported game file) specifies `videoMinSeconds` greater than or
  equal to `videoMaxSeconds`
- **THEN** the Builder surfaces an inline validation problem and the server rejects the save
  with `invalid-argument`

#### Scenario: Out-of-platform-range value is refused
- **WHEN** a creator specifies a maximum above the platform ceiling or a minimum below the
  platform floor
- **THEN** the Builder surfaces an inline validation problem and the server rejects the save
  with `invalid-argument`

#### Scenario: Malformed stored range resolves safely for participants
- **WHEN** a participant is served a task whose stored duration values are absent, malformed,
  non-finite, or out of range
- **THEN** the participant-side resolver clamps them into the valid platform range and the
  recorder operates normally, never throwing or blocking the mission

### Requirement: Participant recorder enforces the configured duration range
The participant video capture experience SHALL auto-stop recording at the task's effective
maximum duration and SHALL prevent submission of a clip shorter than the task's effective
minimum duration, while surfacing the remaining/required time to the participant.

#### Scenario: Recording auto-stops at the maximum
- **WHEN** a participant recording a video reaches the task's effective `videoMaxSeconds`
- **THEN** recording stops automatically and the captured clip is offered for preview and
  submission

#### Scenario: Submission blocked below the minimum
- **WHEN** a participant stops recording before reaching the task's effective
  `videoMinSeconds`
- **THEN** the submit action is unavailable and the interface indicates how much additional
  recording time is required

#### Scenario: Native-picker fallback with unreadable duration fails open
- **WHEN** a participant uses the native camera-picker fallback and the selected file's
  duration cannot be determined from its metadata
- **THEN** the submission is allowed to proceed rather than blocked, consistent with the
  platform rule that client-side blocking guards must fail open
