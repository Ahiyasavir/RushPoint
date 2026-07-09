## Why

Missions like "record your team chant" or "interview a passer-by" are a staple of
field-game design that RushPoint cannot express — the only media a team can hand in
is a photo. The entire ingest machinery already exists (Storage upload scoped by
`requireStorageUrl`, `submitStationPhoto` → pending/auto-approve, staff review queue,
`completeTaskForTeam` on approval); audio needs only a different capture widget and
a wider content-type gate, so it rides the photo pipeline instead of adding a new
task type or callable. MediaRecorder is built into every target browser — zero paid
dependencies.

## What Changes

- **`task.smart.captureKind?: 'photo' | 'audio'`** (default `'photo'`; only
  meaningful on `photo`-type tasks). Everything else — `autoApprove`, the review
  queue, retry, intro/pending screens — reuses the photo machinery unchanged.
- **play-web capture:** for `captureKind: 'audio'` the TaskRunner swaps the photo
  picker for a MediaRecorder widget — record / stop / re-record / `<audio>` playback
  before submit; `audio/webm;codecs=opus` with an `audio/mp4` fallback (Safari);
  client-enforced 60 s cap (auto-stop + countdown). The blob uploads to the SAME
  Storage path scheme as photos (`runs/{runId}/teams/{teamId}/{taskId}-{ts}.{ext}`).
- **Server:** `submitStationPhoto` extended — callable NAME unchanged, so the e2e
  callable-coverage guard stays at its current count. Payload gains an optional
  `contentType`; the server derives the task's `captureKind` from the game snapshot
  it ALREADY reads (for `autoApprove`) and rejects a kind/content-type mismatch via
  a shared pure helper. The submission record gains `mediaKind: 'photo' | 'audio'`
  (server-derived from the task, never client-claimed) so review UIs know how to
  render.
- **storage.rules:** the `runs/{runId}/teams/{teamId}` write rule's content-type
  match widens from `image/.*` to also allow `audio/webm`, `audio/mp4`,
  `audio/mpeg`, `audio/ogg`; the existing 10 MB size cap is kept and now covers
  audio too.
- **Review UIs:** the StaffConsole photo queue renders `<audio controls>` instead of
  `<img>` when `mediaKind === 'audio'`. (RunConsolePage has no review queue — staff
  review lives in StaffConsole only; RunConsole's feed panel is unaffected, see
  non-goals.)
- **Sanitizer:** `captureKind` is participant-visible (the client must know to show
  the recorder) — added to the explicit `smart` pick-list in
  `sanitizeTaskForParticipant`, its vitest, and the e2e script's
  `ALLOWED_SMART_KEYS` copy.
- **Builder:** the TaskWizard photo-task interaction step gains a capture-kind
  selector (Photo / Audio) writing `task.smart.captureKind` (repo pitfall: this
  lives on `task.smart`, NOT top-level — same as `secretCode`/`autoApprove`).

## Capabilities

### New Capabilities
- `audio-tasks`: `captureKind` config on photo tasks; the pure
  `isAllowedSubmissionContentType(kind, contentType)` gate (shared, RED-first
  tested); `submitStationPhoto` kind validation + `mediaKind` on submissions;
  MediaRecorder capture UI; audio rendering in the staff review queue; Builder
  selector; widened storage.rules.

## Non-goals

- No transcription, no waveform rendering, no video capture.
- Audio submissions do NOT enter the live photo feed in v1 — `writeFeedItem` is
  simply skipped for `mediaKind: 'audio'` on both the auto-approve and review paths.
- No server-side max-duration enforcement — the 60 s cap is client-side only; the
  server bound is the existing 10 MB Storage size cap.
- No new task type, no new callable, no change to scoring/routing — an approved
  audio submission completes the task via the exact same `completeTaskForTeam` call.

## Surfaces touched

- **shared:** `packages/shared/src/mediaKinds.ts` (new: `MediaKind`,
  `AUDIO_CONTENT_TYPES`, `normalizeContentType`, `isAllowedSubmissionContentType`);
  `SmartStationConfig.captureKind?` in `types/index.ts`.
- **functions:** `submitStationPhoto` in `functions/src/index.ts` (kind gate +
  `mediaKind` on the submission + feed skip); `reviewStationSubmission` (feed skip
  for audio); `functions/src/runs/sanitizeTask.ts` smart pick-list + its vitest.
- **storage.rules:** widened content-type match on the run/team path.
- **play-web:** `TaskRunner.tsx` (AudioEntry widget), `services/firebase.ts`
  (audio upload), `services/calls.ts` (`contentType` on the wrapper),
  `StaffConsole.tsx` (audio in the review queue), i18n EN/HE.
- **creator-web:** `TaskWizard.tsx` capture-kind selector, i18n EN/HE.
- **Tests:** `scripts/test-media-kinds.ts` (pure lane, RED first); sanitizer vitest;
  extended station-photo e2e scenario in `scripts/e2e-verify.mjs` (real audio bytes
  to the Storage emulator, `mediaKind` assertion, kind-mismatch negative,
  `ALLOWED_SMART_KEYS` update).
