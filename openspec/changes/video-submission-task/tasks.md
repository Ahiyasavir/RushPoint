## 0. Prerequisite

- [x] 0.1 Confirm `stream-upload-write` is merged/deployed (its streaming `/upload`
      implementation) before starting task 3+ below — raising the participant size cap for
      video ahead of that fix reintroduces the RAM-scaling risk it exists to remove. If not
      yet landed, stop here and land it first.

## 1. Shared media-kind gate — RED

- [x] 1.1 Extend `scripts/test-media-kinds.ts` with FAILING assertions for the video branch:
      `isAllowedSubmissionContentType('video', 'video/webm')` → true;
      `('video', 'video/mp4')` → true; `('video', 'video/quicktime')` → true;
      `('video', undefined)` → false; `('video', 'image/jpeg')` → false;
      `('video', 'audio/webm')` → false; `('photo', 'video/webm')` → false;
      `('audio', 'video/webm')` → false. Run `npm test` and confirm these fail (the `'video'`
      kind and `VIDEO_CONTENT_TYPES` don't exist yet — expect a type/runtime error).

## 2. Shared media-kind gate — GREEN

- [x] 2.1 In `packages/shared/src/mediaKinds.ts`: widen `MediaKind` to
      `'photo' | 'audio' | 'video'`; add `VIDEO_CONTENT_TYPES = ['video/webm', 'video/mp4',
      'video/quicktime'] as const`; extend `isAllowedSubmissionContentType` with the video
      branch (requires a content-type, exact-matches the normalized value against
      `VIDEO_CONTENT_TYPES`, same shape as the audio branch). Add the "keep in sync with
      `ALLOWED_CONTENT_TYPES` in `functions/server.js`" comment already used for audio.
- [x] 2.2 In `packages/shared/src/types/index.ts`: widen
      `SmartStationConfig.captureKind?: 'photo' | 'audio'` to
      `'photo' | 'audio' | 'video'`.
- [x] 2.3 Run `npm test` — confirm the task-1.1 assertions now pass and nothing else broke.

## 2b. Video duration contract (pure shared) — RED → GREEN

- [x] 2b.1 RED: create `scripts/test-video-duration.ts` with FAILING assertions for a
      not-yet-existing `packages/shared/src/videoDuration.ts`:
      `resolveVideoDuration` returns platform defaults for absent/empty smart config;
      clamps an over-ceiling max down and an under-floor min up; resolves an inverted pair
      to a sane in-range result WITHOUT throwing; tolerates `NaN`/`Infinity`/negative/string
      inputs (total, fail-open). `videoDurationProblem` returns a problem for min >= max,
      for max above ceiling, for min below floor, for non-finite values, and for an
      insufficient min/max spread; returns `null` for a valid pair and for both-absent.
      Run `npm test`, confirm it fails (module does not exist).
- [x] 2b.2 GREEN: implement `packages/shared/src/videoDuration.ts` — `VIDEO_DURATION_LIMITS`
      (floor 5s / ceiling 60s / default min 0 / default max 40s / minimum spread, final
      values per design.md Open Questions), `resolveVideoDuration(smart)` (total, clamping,
      never throws — participant hot path) and `videoDurationProblem(min, max)` (strict
      authoring verdict). Export from the shared barrel. Run `npm test` — green.
- [x] 2b.3 Add `videoMinSeconds?: number` and `videoMaxSeconds?: number` to
      `SmartStationConfig` in `packages/shared/src/types/index.ts`.

## 3. Server: content-type + size cap — RED

- [x] 3.1 Write a failing vitest/integration test (extending or adjacent to the
      `stream-upload-write` change's upload test file) asserting: a `video/webm` PUT under
      the (not-yet-existing) `MAX_PARTICIPANT_VIDEO_BYTES` cap succeeds; the same content
      type is currently rejected because `ALLOWED_CONTENT_TYPES` doesn't include video yet.
      Confirm it fails for that reason.
- [x] 3.2 Write a failing test: a `video/webm` PUT between today's `MAX_PARTICIPANT_BYTES`
      (10MB) and the target video cap (~20MB, to be locked in task 3.4) is rejected today
      (falls back to the smaller shared cap) but SHOULD be accepted once the video-specific
      cap exists. Confirm current failure mode.
- [x] 3.3 Write a failing test: a `video/webm` PUT exceeding `MAX_PARTICIPANT_VIDEO_BYTES`
      is still rejected early (mirrors the existing oversized-upload test from
      `stream-upload-write`, just at the video cap threshold).

## 4. Server: content-type + size cap — GREEN

- [x] 4.1 Measure a handful of real 40-second `MediaRecorder` output sizes (webm/vp8+opus at
      typical mobile-camera resolution) to sanity-check the proposed 20MB cap; adjust the
      constant if real sizes suggest otherwise, and note the final value + rationale in
      `design.md`'s Open Questions resolution.
- [x] 4.2 In `functions/server.js`: widen `ALLOWED_CONTENT_TYPES` to include
      `video/(webm|mp4|quicktime)`; add `MAX_PARTICIPANT_VIDEO_BYTES` constant; in the
      `PUT /upload` handler, select the applicable cap based on the validated content-type
      (video → video cap, else → existing `MAX_PARTICIPANT_BYTES`/`MAX_CREATOR_BYTES` logic
      unchanged).
- [x] 4.3 Run the tests from step 3 — confirm all three now pass.

## 5. Server: submitStationPhoto kind handling — RED

- [x] 5.1 Extend `functions/src/runs/sanitizeTask.test.ts` with failing assertions:
      `captureKind: 'video'`, `videoMinSeconds` and `videoMaxSeconds` on a task's `smart`
      config all survive sanitization (present in the sanitized `smart` pick-list), same as
      today's `'audio'` assertion, while `secretCode`/`adminNotes` remain stripped.
- [x] 5.1b Add failing e2e assertions for server-side duration-range validation: an
      `updateGame` carrying `videoMinSeconds >= videoMaxSeconds` is rejected
      `invalid-argument`; one carrying a max above the platform ceiling is rejected; a valid
      pair is accepted. Run `npm run e2e`, confirm they fail (no validation exists yet).
- [x] 5.2 Add failing scenarios to `scripts/e2e-verify.mjs`'s station-photo section: a game
      with a `captureKind: 'video'` task; submitting with `contentType: 'video/webm'` should
      reach `pending` and stamp `mediaKind: 'video'`; submitting `contentType: 'image/jpeg'`
      against that task should reject `invalid-argument`; submitting
      `contentType: 'video/webm'` against the existing PHOTO task should reject
      `invalid-argument`. Run `npm run e2e` and confirm these fail for the expected reason
      (kind not recognized / mediaKind never set to `'video'`).

## 6. Server: submitStationPhoto kind handling — GREEN

- [x] 6.1 In `functions/src/runs/sanitizeTask.ts`: add `videoMinSeconds` and
      `videoMaxSeconds` to the explicit `smart` pick-list beside `captureKind` (they are
      participant-visible by necessity — the recorder cannot enforce a limit it cannot see).
      Mirror all three keys into `scripts/e2e-verify.mjs`'s `ALLOWED_SMART_KEYS` so the
      sanitizer allowlist guard stays green.
- [x] 6.1b In `functions/src/games/index.ts`: add duration-range validation to `updateGame`
      and `importGameFile` using the shared `videoDurationProblem()` — reject with
      `invalid-argument` on a problem, accept when it returns `null`. Follow the existing
      `requiredTaskCountProblem` validation pattern.
- [x] 6.2 In `functions/src/index.ts`'s `submitStationPhoto`: extend the
      `kind: MediaKind` derivation to recognize `task.smart?.captureKind === 'video'`;
      the existing `isAllowedSubmissionContentType(kind, contentType)` gate already handles
      the video branch once shared types are updated (task 2). Confirm the
      `taskSubmissions[taskId]` merge-write stamps `mediaKind: 'video'` correctly.
- [x] 6.3 Extend the feed-skip condition (currently `kind !== 'audio'`) to
      `kind !== 'audio' && kind !== 'video'` in both `submitStationPhoto`'s auto-approve path
      and `reviewStationSubmission`'s best-effort feed block.
- [x] 6.4 Run `npm test` (sanitizer vitest) and `npm run e2e` (station-photo scenarios) —
      confirm all now pass, including the new video negatives/positives from step 5.

## 7. play-web: video capture widget — RED (pure/logic slice first)

- [x] 7.1 The duration logic is already covered by the pure `videoDuration.ts` tests from
      task 2b — the recorder consumes `resolveVideoDuration(task.smart)` rather than owning
      any of its own arithmetic. Add a failing pure assertion for any NEW decision logic the
      widget needs that isn't already covered (e.g. a `canSubmitRecording(elapsedSeconds,
      range)` verdict, and the fail-open "duration unreadable ⇒ allow" rule for the
      native-picker path). If the widget ends up with no branching logic beyond
      `resolveVideoDuration`, note that here and rely on 2b's coverage plus preview-tool
      verification.

## 8. play-web: video capture widget — GREEN

- [x] 8.1 In `apps/play-web/src/services/firebase.ts`: add `uploadTaskVideo(blob, { runId,
      teamId, taskId, contentType })`, mirroring `uploadTaskAudio` — same path scheme
      (`runs/{runId}/teams/{teamId}/{safeTask}-{Date.now()}.{ext}`), normalized content-type,
      extension mapping (`video/webm` → `webm`, `video/mp4` → `mp4`,
      `video/quicktime` → `mov`).
- [x] 8.2 In `apps/play-web/src/components/TaskRunner.tsx`: add a `VideoEntry` component for
      `captureKind === 'video'` tasks — `getUserMedia({ video: true, audio: true })` →
      `MediaRecorder` preferring `video/webm`, record/stop/re-record, a visible countdown
      that auto-stops at `resolveVideoDuration(task.smart).maxSeconds`, a submit action
      disabled until `minSeconds` is reached (with "record Xs more" copy), `<video controls>`
      preview before submit, and a native-picker fallback
      (`<input type="file" accept="video/*" capture>`) when `MediaRecorder` is unsupported or
      its video constructor throws — mirroring `AudioEntry`'s fallback handling from
      `audio-recorder-fallback`.
- [x] 8.2b For the native-picker fallback path, read the picked file's duration via a
      `<video>` element's `loadedmetadata` event and refuse a below-minimum file with a clear
      message — but FAIL OPEN (allow the submission) when duration is unreadable/NaN, per the
      repo rule that client-side blocking guards must never trap a blameless participant.
- [x] 8.3 Wire the submit path: `services/calls.ts`'s `submitStationPhoto` wrapper already
      accepts `contentType?: string` (from audio-tasks) — no change needed unless the type
      needs widening to include the new video content-type values explicitly.
- [x] 8.4 Add EN/HE i18n strings for: the capture-kind label if reused, record/stop/re-record
      button labels (if not already shared with `AudioEntry`), the 40-second countdown copy,
      and any video-specific error/fallback messaging. Route every new string through `t.*`
      — zero hardcoded literals.

## 9. Staff review UI — GREEN

- [x] 9.1 In `apps/play-web/src/screens/StaffConsole.tsx`: extend the `PendingSubmission`
      row type and the `taskSubmissions` snapshot cast to include `mediaKind: 'video'` as a
      valid value; add a render branch showing `<video controls src={s.photoUrl}>` when
      `mediaKind === 'video'`, alongside the existing photo/audio branches. Approve/reject
      buttons and the `reviewStationSubmission` call stay unchanged.
- [x] 9.2 Add an EN/HE "video submission" label, matching the existing audio label pattern.

## 10. Builder UI — GREEN

- [x] 10.1 In `apps/creator-web/src/components/TaskWizard.tsx`: extend the existing
      Photo/Audio capture-kind selector to a three-option selector (Photo / Audio / Video),
      writing `task.smart.captureKind` via the existing `setSmart` merge helper (never
      top-level). Default stays Photo when absent.
- [x] 10.2 Add the duration sub-control, shown only when Video is selected: min + max
      seconds inputs writing `smart.videoMinSeconds` / `smart.videoMaxSeconds` via `setSmart`,
      with inline validation from `videoDurationProblem()` and the platform range shown as
      helper text. Clearing a field must set it to `undefined` (NOT `null` / not `0`) so
      `buildSavePayload` omits the key — per the callable-transport `undefined`→`null`
      footgun.
- [x] 10.3 Confirm `apps/creator-web/src/lib/savePayload.ts`'s `BUILDER_EDITABLE_FIELDS`
      already covers the whole `smart` object (it does, from audio-tasks) so the two new
      fields save — verify `scripts/test-game-presentation.ts` and
      `scripts/test-save-payload-undefined.ts` still pass.
- [x] 10.4 Add EN/HE i18n strings for the new Video option label, the min/max duration field
      labels, the platform-range helper text, and each validation message.

## 11. a11y / static-scan checks

- [x] 11.1 Run `scripts/test-play-a11y-scan.ts` (or the underlying `playA11yScan.ts` logic)
      against the new `VideoEntry`/`StaffConsole` video markup — confirm no icon-only
      buttons without accessible names, no physical-direction Tailwind classes, no
      onClick-on-non-interactive-element findings. Fix any that surface.

## 12. Full gate verification

- [x] 12.1 Run `npm run typecheck` — must pass across all workspaces.
- [x] 12.2 Run `npm run lint` — 0 errors.
- [x] 12.3 Run `npm test` — all vitest + `scripts/test-*.ts` green, including the widened
      `test-media-kinds.ts` and sanitizer vitest.
- [x] 12.4 Run `npm run creator:build` and `npm run play:build` — both pass.
- [x] 12.5 Run `npm run bundle:budget` — confirm no regression (no new heavy dependency was
      added; `MediaRecorder`/`<video>` are native browser APIs).
- [x] 12.6 Run `npm run e2e` — full lifecycle including the new video scenarios from step 5
      stays green; confirm the callable-coverage guard is unaffected (no new callable was
      added).
- [x] 12.7 Run `npm run i18n:check:strict` — clean, zero new PART B findings from the new
      Builder/TaskRunner/StaffConsole UI.
- [x] 12.8 Manual preview-tool verification: author a video mission with a min/max range in
      the Builder, confirm inline validation refuses an inverted/out-of-range pair; then in
      play-web record a clip — confirm submit stays disabled below the minimum, the countdown
      auto-stops at the maximum, submit works in range, the clip reaches the staff review
      queue and plays back, approval completes the task, and no feed item appears.
- [x] 12.9 Manual load sanity check (not a full 100-team simulation, but a smoke test): fire
      a handful of concurrent video-sized PUTs at `/upload` locally and confirm memory stays
      bounded (spot-check via the streaming-write behavior already proven in
      `stream-upload-write`'s own tests) rather than re-deriving that proof here.
