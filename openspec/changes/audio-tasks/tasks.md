## 1. Shared media-kind gate — RED then GREEN (pure logic, TDD)

- [ ] 1.1 RED: `scripts/test-media-kinds.ts` (pattern: `scripts/test-storage-url.ts`) asserting `normalizeContentType` + `isAllowedSubmissionContentType`: photo+`image/jpeg` ok, photo+undefined ok (legacy clients), photo+`audio/webm` rejected; audio + each of `audio/webm|mp4|mpeg|ogg` ok (both bare and with `;codecs=opus` params), audio+undefined rejected, audio+`image/png` rejected, junk strings rejected. Ensure the aggregator picks it up; confirm it FAILS (module missing).
- [ ] 1.2 GREEN: `packages/shared/src/mediaKinds.ts` — `MediaKind`, `AUDIO_CONTENT_TYPES`, `normalizeContentType`, `isAllowedSubmissionContentType`; export from `@rushpoint/shared`. `npm test` → 1.1 passes.

## 2. Shared types + sanitizer
- [ ] 2.1 Add `captureKind?: 'photo' | 'audio'` to `SmartStationConfig` (packages/shared/src/types/index.ts, beside `autoApprove`) with a doc comment (photo-type tasks only; default photo). `npm run typecheck`.
- [ ] 2.2 RED: extend `functions/src/runs/sanitizeTask.test.ts` — `smart.captureKind` passes through to the participant payload; `secretCode`/`adminNotes` still stripped. Fails (pick-list omits it).
- [ ] 2.3 GREEN: add `captureKind: smart.captureKind` to the explicit `smart` pick-list in `functions/src/runs/sanitizeTask.ts`. Vitest green.

## 3. Server (functions/src/index.ts) — same callable, no new reads
- [ ] 3.1 `submitStationPhoto`: accept optional `contentType`; extend the EXISTING game-snapshot task cast with `smart?.captureKind`; derive `kind` from the task; `validate()` the kind/content-type pair via `isAllowedSubmissionContentType` (invalid-argument on mismatch, audio requires a declared audio type); write `mediaKind: kind` into the `taskSubmissions[taskId]` merge object (real nested object, never dotted keys).
- [ ] 3.2 Feed skip: auto-approve path gates `writeFeedItem` on `kind !== 'audio'`; `reviewStationSubmission` approval path reads the stored submission's `mediaKind` (already fetching the team doc) and skips the feed write for audio. `npm run typecheck`.
- [ ] 3.3 `storage.rules`: widen the `runs/{runId}/teams/{teamId}` write contentType match to `'image/.*|audio/(webm|mp4|mpeg|ogg)'`; keep the 10 MB cap. `npm run test:rules` lane (via `verify:emulator`) stays green.

## 4. e2e — extend the station-photo scenario (no new callable)
- [ ] 4.1 Add `captureKind` to `ALLOWED_SMART_KEYS` in `scripts/e2e-verify.mjs` (:191) — the anti-drift copy of the sanitizer pick-list.
- [ ] 4.2 In scenario 8c: add an audio task (`smart: { enabled: true, verificationType: 'photo_upload', captureKind: 'audio' }`); assert the sanitized payload exposes `smart.captureKind === 'audio'`; upload real audio bytes to the Storage emulator under `runs/{runId}/teams/{uid}/` with `contentType: 'audio/webm'`; `submitStationPhoto` (with `contentType`) → pending + `taskSubmissions[taskId].mediaKind === 'audio'`; staff `reviewStationSubmission` approve → completion + points; no feed item written for it.
- [ ] 4.3 Negatives in the same scenario: `contentType: 'image/jpeg'` on the audio task → invalid-argument; missing `contentType` on the audio task → invalid-argument; `contentType: 'audio/webm'` on the existing photo task → invalid-argument.
- [ ] 4.4 `npm run e2e` — green (callable coverage guard count unchanged; batch gate).

## 5. play-web — recorder + submit + review queue
- [ ] 5.1 `services/firebase.ts`: `uploadTaskMedia(blob, { runId, teamId, taskId, contentType })` sharing the photo path scheme (`runs/{runId}/teams/{teamId}/{safeTask}-{ts}.{webm|m4a}`); upload with the NORMALIZED contentType. `services/calls.ts`: `submitStationPhoto` wrapper gains `contentType?: string`.
- [ ] 5.2 `TaskRunner.tsx`: new `AudioEntry` (MediaRecorder; `isTypeSupported` webm/opus → mp4 fallback; record/stop with 60 s auto-stop + countdown; re-record; `<audio controls>` playback; submit → upload + `submitStationPhoto` with `contentType`; unsupported-browser + mic-denied error states). Render it instead of `PhotoEntry` when `task.smart?.captureKind === 'audio'`; photo path untouched.
- [ ] 5.3 `StaffConsole.tsx`: `PendingSubmission` + snapshot cast gain `mediaKind?`; render `<audio controls src={photoUrl}>` for audio rows, `<img>` otherwise.
- [ ] 5.4 play-web i18n keys (recorder labels: record/stop/reRecord/countdown/micDenied/unsupported/audioSubmission) EN + HE.

## 6. creator-web — Builder selector
- [ ] 6.1 `TaskWizard.tsx` `InteractionStepBody`, photo block (~:741): Photo/Audio capture-kind segmented selector → `setSmart({ verificationType: 'photo_upload', captureKind })` (pitfall: `task.smart`, never top-level); default Photo when absent.
- [ ] 6.2 creator-web i18n keys (`captureKindLabel`, `captureKindPhoto`, `captureKindAudio`, `captureKindAudioHint`) EN + HE.

## 7. Gates
- [ ] 7.1 `npm run typecheck`
- [ ] 7.2 `npm run lint`
- [ ] 7.3 `npm test`
- [ ] 7.4 `npm run creator:build` + `npm run play:build`
- [ ] 7.5 `npm run e2e`
- [ ] 7.6 `npm run i18n:check` (clean; zero new PART B warnings via `i18n:check:strict`)
