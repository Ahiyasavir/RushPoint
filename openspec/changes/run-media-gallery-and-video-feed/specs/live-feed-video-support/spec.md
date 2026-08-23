## ADDED Requirements

### Requirement: Video submissions can enter the live media feed
The live media feed (`feedItems`) SHALL accept video submissions on the same completion paths that
already broadcast approved photo submissions (`submitStationPhoto` autoApprove and
`reviewStationSubmission` approve), subject to the same existing gates (feed enabled on the game,
task completed, hidden-location exclusion via `shouldFeedTask`). Audio submissions SHALL remain
excluded from the feed.

#### Scenario: Auto-approved video submission is broadcast to the feed
- **WHEN** a team submits a video to a task with `captureKind: 'video'` and `autoApprove: true`,
  the game has the photo feed enabled, and the task is not hidden-location
- **THEN** a feed item is written carrying that video's URL and a `mediaKind` of `'video'`

#### Scenario: Manager-approved video submission is broadcast to the feed
- **WHEN** a manager approves a pending video submission via `reviewStationSubmission`, the game
  has the photo feed enabled, and the task is not hidden-location
- **THEN** a feed item is written carrying that video's URL and a `mediaKind` of `'video'`

#### Scenario: Audio submissions still never reach the feed
- **WHEN** a team submits or has approved an audio submission (`captureKind: 'audio'`)
- **THEN** no feed item is written for that submission

#### Scenario: Hidden-location video is still excluded from the feed
- **WHEN** a video submission belongs to a task marked hidden-location
- **THEN** no feed item is written for that submission, exactly as already happens for photo

### Requirement: Feed renderers display video feed items as video
Every UI that renders `feedItems` (the participant/staff live feed panel and the creator-web Run
Console's feed panel) SHALL render an item whose `mediaKind` is `'video'` using a video player
control, not an image tag.

#### Scenario: Participant feed shows a playable video card
- **WHEN** a feed item has `mediaKind: 'video'`
- **THEN** the participant-facing feed panel renders it with a `<video>` element (controls,
  playable) instead of an `<img>` element

#### Scenario: Creator-web feed console shows a playable video card
- **WHEN** a feed item has `mediaKind: 'video'`
- **THEN** the Run Console's feed panel renders it with a `<video>` element instead of an `<img>`
  element

#### Scenario: Existing photo feed items are unaffected
- **WHEN** a feed item has no `mediaKind` field (written before this change) or `mediaKind: 'photo'`
- **THEN** it continues to render as an `<img>` exactly as before
