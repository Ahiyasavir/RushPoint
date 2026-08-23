## ADDED Requirements

### Requirement: Manager can view all run media regardless of review status
The Run Console SHALL provide a media gallery panel listing every task submission that carries a
renderable photo or video URL, for every team in the run, regardless of that submission's review
status (pending, approved, or rejected) and regardless of whether it was auto-approved.

#### Scenario: Auto-approved photo is visible in the gallery
- **WHEN** a team submits a photo to a task configured with `autoApprove`, so the submission is
  immediately `approved` and never enters the pending review queue
- **THEN** the gallery panel still shows that photo as a thumbnail

#### Scenario: Rejected submission is still visible in the gallery
- **WHEN** a manager rejects a team's photo submission via `reviewStationSubmission`
- **THEN** the gallery panel continues to show that photo (it is not removed just because it was
  rejected)

#### Scenario: Video submissions render as playable video, not a broken image
- **WHEN** a team submits a video to a task whose capture kind is `video`
- **THEN** the gallery panel renders it with a `<video>` player (controls, playable), not an
  `<img>` tag

#### Scenario: Submission without usable media is skipped
- **WHEN** a team's `taskSubmissions` entry has no valid Storage-hosted URL (e.g. malformed or
  missing)
- **THEN** the gallery panel omits that entry rather than rendering a broken thumbnail

### Requirement: Manager can download all run media
The Run Console's media gallery SHALL provide an action that lets the manager download every
media file currently shown in the gallery.

#### Scenario: Download-all triggers a browser download per file
- **WHEN** the manager clicks the gallery's "download all" action while N media items are shown
- **THEN** the client initiates a browser download for each of the N files

#### Scenario: Individual item can be downloaded on its own
- **WHEN** the manager interacts with a single gallery card
- **THEN** they can download or open that item's media file independently of the bulk action
