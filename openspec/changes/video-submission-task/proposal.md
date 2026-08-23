## Why

`audio-tasks` proved that a photo-type mission can capture non-photo media by widening
`task.smart.captureKind` and reusing the existing submit → review/auto-approve pipeline
instead of inventing a new task type or callable. The same pattern extends naturally to
short video responses (e.g. "act out a clue," "give a 40-second team update") — a capture
mode field-game creators frequently want and RushPoint currently cannot express at all.
Video is heavier than audio, so this change is scoped to a **creator-configurable min/max
duration within a fixed platform range** (default max 40s, no minimum) rather than one
hardcoded cap, and depends on `stream-upload-write` having landed first, so the larger
per-file size this requires does not reintroduce the memory-scaling risk that change fixes.

## What Changes

- **`task.smart.captureKind: 'photo' | 'audio' | 'video'`** — widen the existing union
  (currently `'photo' | 'audio'`) to add `'video'`. Everything else on the photo pipeline
  (`autoApprove`, pending/review states, retry, `completeTaskForTeam` on approval) is
  reused unchanged, exactly as audio did.
- **`task.smart.videoMinSeconds?: number` / `task.smart.videoMaxSeconds?: number`** — new
  optional creator-authored fields (photo-task, `captureKind: 'video'` only). Both are
  bounded server-side to a fixed platform range (`VIDEO_DURATION_LIMITS`, proposed
  min-floor 5s / max-ceiling 60s); defaults when absent are `videoMinSeconds: 0` (no
  minimum) and `videoMaxSeconds: 40` (today's originally-planned cap, now just the default
  rather than a hardcoded value).
- **play-web capture:** a new `VideoEntry` widget (mirroring `AudioEntry`) using
  `MediaRecorder` with both video+audio tracks — record / stop / re-record / `<video>`
  preview before submit — enforcing the TASK's configured `videoMaxSeconds` (auto-stop +
  visible countdown, matching the audio widget's UX pattern) and blocking submit until
  `videoMinSeconds` of recorded duration is reached (a visible "keep recording — Xs more"
  affordance below the minimum). Falls back to the device's native camera/video picker
  (`<input type="file" accept="video/*" capture>`) when `MediaRecorder` is unavailable or
  its video constructor throws, mirroring the existing `audio-recorder-fallback`
  precedent — the fallback path cannot enforce a minimum (no in-browser control over a
  native camera app's recording), so a below-minimum picked file is caught by a
  post-selection duration read (`<video>` element `loadedmetadata` duration check) rather
  than blocked during capture.
- **Shared:** `packages/shared/src/mediaKinds.ts` gains `VIDEO_CONTENT_TYPES` (the
  `MediaRecorder` video/webm output plus native-picker outputs: `video/mp4`,
  `video/quicktime`, `video/3gpp`) and `MediaKind` widens to `'photo' | 'audio' | 'video'`;
  `isAllowedSubmissionContentType` gains the video branch. A new pure
  `packages/shared/src/videoDuration.ts` owns the duration contract in ONE place:
  `VIDEO_DURATION_LIMITS` (platform floor/ceiling + defaults),
  `resolveVideoDuration(smart)` → the effective `{minSeconds, maxSeconds}` a client should
  enforce (total, never throws, clamps nonsense into range), and
  `videoDurationProblem(min, max)` → the Builder/save-validation verdict (e.g. min > max,
  out of platform range) — the single source both the creator-web Builder and the server's
  `updateGame`/`importGameFile` validation read, so a bad range can't be authored.
- **Server:** `submitStationPhoto` (name unchanged, no new callable) derives `captureKind`
  from the game snapshot as it already does, validates video content-types via the shared
  gate, and stamps `mediaKind: 'video'` on the submission record. A **video-specific size
  cap** (`MAX_PARTICIPANT_VIDEO_BYTES`, proposed 20MB — enough for a compressed 40s clip
  with margin) applies only when the declared/derived kind is video; the existing 10MB
  `MAX_PARTICIPANT_BYTES` is unchanged for photo/audio.
- **`functions/server.js` `/upload`:** widen `ALLOWED_CONTENT_TYPES` to accept the video
  MIME types above, and apply the video-specific size cap — built on the streaming write
  path from `stream-upload-write` so a larger cap does not reintroduce buffered-memory risk.
- **Review UIs:** `StaffConsole.tsx`'s submission queue renders `<video controls>` instead
  of `<img>`/`<audio>` when `mediaKind === 'video'`.
- **Sanitizer:** `'video'` is a valid `captureKind` value in `sanitizeTaskForParticipant`'s
  explicit `smart` pick-list, and `videoMinSeconds`/`videoMaxSeconds` are added to that
  pick-list too — they are **participant-visible by necessity** (the recorder cannot
  enforce a limit it can't see) and carry no secret information.
- **Builder:** `TaskWizard.tsx`'s capture-kind selector gains a third option (Photo / Audio /
  Video), writing `task.smart.captureKind` exactly like the existing two. When Video is
  selected, a duration sub-control appears (min + max seconds) writing
  `smart.videoMinSeconds` / `smart.videoMaxSeconds`, with inline validation driven by
  `videoDurationProblem()` and the platform range surfaced as helper text. Clearing either
  field must send it ABSENT (not `null`) per the callable-transport footgun —
  `buildSavePayload` already drops `undefined` keys inside `stages`, so the controls clear
  to `undefined`.
- **Server validation:** `updateGame` / `importGameFile` reject an out-of-range or inverted
  duration pair via the same shared `videoDurationProblem()` — a client can't bypass the
  Builder's inline check.
- i18n: new EN/HE strings for the video capture UI, capture-kind selector option, the
  duration controls + their validation messages, the participant-side "record at least Xs"
  / countdown copy, and any review-queue label changes — no hardcoded literals.

## Non-goals

- No transcription, no thumbnail generation, no video compression/transcoding on the
  server — the client sends whatever `MediaRecorder`/the native picker produces, gated only
  by content-type and size.
- Video submissions do **not** enter the live photo feed in v1, matching the audio
  precedent (`writeFeedItem` skipped for `mediaKind: 'video'`) — video is heavier than the
  feed is designed for.
- No server-side enforcement of the *submitted clip's actual* duration — the server
  validates that the creator's configured RANGE is sane (via `videoDurationProblem`) and
  bounds bytes, but it does not decode the uploaded video to verify its real length. Same
  posture as audio: duration is a client-enforced authoring/UX contract, the byte cap is
  the hard server bound. (Decoding video server-side to verify duration would require a
  transcoding dependency on the VPS — explicitly out of scope.)
- No new task type, no new callable, no scoring/routing change — an approved video
  submission completes the task via the same `completeTaskForTeam` call as photo/audio.
- Not increasing concurrency/scale guarantees beyond what `stream-upload-write` already
  establishes — this change assumes that fix has landed; it does not itself re-verify
  100-group-scale behavior (that's covered by that change's own memory-bound tests, plus
  this change's own concurrent-upload e2e scenario at a moderate scale).

## Capabilities

### New Capabilities
(none as a fresh capability — `vps-media-upload`, introduced by `stream-upload-write`,
already models the upload endpoint's behavior; this change is additive to it)

### Modified Capabilities
- `vps-media-upload`: gains a video-specific size cap and widened content-type allowlist,
  applied only when the upload targets a `captureKind: 'video'` submission path.

## Impact

- **Sequencing dependency:** requires `stream-upload-write` to have landed first (raises the
  effective per-file size ceiling on the streaming-write endpoint; doing so before that fix
  reintroduces the RAM-scaling risk it was built to remove).
- **Shared:** `packages/shared/src/mediaKinds.ts`, new
  `packages/shared/src/videoDuration.ts`, `types/index.ts`
  (`SmartStationConfig.captureKind` + `videoMinSeconds` + `videoMaxSeconds`).
- **Functions:** `submitStationPhoto` in `functions/src/index.ts`; `reviewStationSubmission`
  (feed-skip for video); `functions/src/runs/sanitizeTask.ts` smart pick-list + vitest
  (`captureKind`, `videoMinSeconds`, `videoMaxSeconds`); `functions/src/games/index.ts`
  (`updateGame`/`importGameFile` duration-range validation); `functions/server.js`
  (`ALLOWED_CONTENT_TYPES`, video size cap).
- **play-web:** `TaskRunner.tsx` (new `VideoEntry` honoring min/max), `services/firebase.ts`
  (`uploadTaskVideo`, mirroring `uploadTaskAudio`), `services/calls.ts` (contentType on the
  submission wrapper), `StaffConsole.tsx` (video in review queue), i18n EN/HE.
- **creator-web:** `TaskWizard.tsx` capture-kind selector (third option) + duration
  sub-control, `lib/savePayload.ts` `BUILDER_EDITABLE_FIELDS` (verify `smart` coverage),
  i18n EN/HE.
- **Tests:** extend `scripts/test-media-kinds.ts` (pure lane) for the video branch; NEW
  `scripts/test-video-duration.ts` (pure lane) for `resolveVideoDuration` /
  `videoDurationProblem`; extend the sanitizer vitest (duration fields survive
  sanitization); extend `scripts/e2e-verify.mjs`'s station-photo scenario with real video
  bytes, a kind-mismatch negative case, size-cap enforcement at the video-specific limit, an
  invalid-duration-range `updateGame` rejection, and the `ALLOWED_SMART_KEYS` update for the
  three new smart keys.
