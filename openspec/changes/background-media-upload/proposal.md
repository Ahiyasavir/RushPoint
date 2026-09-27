# Proposal: background-media-upload

## Why

On an auto-approved photo or video mission nobody is going to look at the picture before the team
may go on, yet the team still waits for every byte to reach the server. On a weak connection a
30 second clip holds a whole team at the mission for a minute or more. The owner's request
(2026-09-26): "approve it for them first, then upload in the background without them waiting".

## What changes

- `submitStationPhoto` accepts `mediaDeferred: true` with no `photoUrl`. The server runs its usual
  auto-approve decision (per task switch, run-wide switch, and the clip length rule). When the
  submission would be auto-approved it approves now, completes the task (the team is routed on)
  and stores the submission as `mediaPending: true`. When it would NOT be approved it writes
  nothing and answers `deferred: false`, so the phone falls back to upload first, submit second.
- New callable `attachSubmissionMedia`: the phone that sent the submission attaches the uploaded
  file (and the clip's poster) once it has landed. The live photo feed item is written then, not
  before, because there was nothing to show before.
- play-web: a background queue owns the upload after the approval. It keeps the file in
  IndexedDB so a reload or a killed tab resumes, retries on its own with backoff, and shows the
  player a small "sending in the background" note with a warning before closing the app.
- getMyTeamState ships `run.autoApproveAllMedia`, so the phone knows when to try the fast path.
- The organizer's console shows an approved submission whose file is still on the way as
  "still uploading" instead of an empty or broken tile.

## Out of scope

- Missions that need an organizer's review: they keep "upload, then send" (the organizer must see
  the file to decide).
