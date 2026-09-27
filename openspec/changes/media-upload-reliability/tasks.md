# Tasks: media-upload-reliability

## 1. RED

- [x] 1.1 Extend `scripts/test-upload-resiliency.ts`: `attemptBudgetMs` table and cap (design D2).
      Confirm RED (missing export).
- [x] 1.2 Extend `functions/uploadRoute.test.ts`: stall ⇒ 408, io ⇒ 500, telemetry line shape, no uid
      in it. Confirm RED (today stall ⇒ 400, no line).
- [x] 1.3 Extend `scripts/test-video-capture.ts`: `CAMERA_OPEN_DEADLINE_MS`, `captureProfileFor`, the
      lighter profile fits the cap at 60 s. Confirm RED.
- [x] 1.4 Source guard: no submit handler in `TaskRunner.tsx` calls `uploadTask*` directly. Confirm RED.

## 2. GREEN (stage A)

- [x] 2.1 `attemptBudgetMs` in `uploadResiliency.ts`; `uploadResilient` takes the blob size and uses it. 1.1 → green.
- [x] 2.2 `uploadRoute.js` status mapping + telemetry line; `server.js` sets `requestTimeout`. 1.2 → green.
- [x] 2.3 `PendingUpload` in `TaskRunner` (design D1): created on capture for photo, audio, video;
      aborted and replaced on retake; awaited by send. 1.4 → green.
- [x] 2.4 Camera deadline in `VideoEntry.openCamera` and `AudioEntry.start` (design D5), including stopping
      a stream that arrives after the deadline. 1.3 (deadline part) → green.
- [x] 2.5 Wake lock + "keep the app open" line + immediate retry on return to visible (design D6).
- [x] 2.6 `captureProfileFor` and its use in `openCamera` (design D9). 1.3 → green.
- [x] 2.7 i18n he/en for the new lines.

## 3. REFACTOR

- [x] 3.1 Collapse the three submit handlers' upload branches into the one `PendingUpload` path.
- [x] 3.2 Update the `MAX_PARTICIPANT_VIDEO_BYTES` sizing comment in `uploadRoute.js` (it still says 2 Mbps).

## 4. Verify and ship

- [ ] 4.1 Preview with "Slow 3G" throttling: a 20 s clip's upload starts in review; send only saves.
      Kill the network mid-upload for 50 s, restore: the attempt retries and completes.
- [x] 4.2 D8 retention check against `runRetention.ts` and the VPS disk; record the finding here and open
      a separate change if run media on disk is never deleted.
- [ ] 4.3 `npm run verify`, `npm run e2e` green (exit codes captured to a file).
- [ ] 4.4 Deploy hosting (play) and rebuild the VPS API from the main checkout; after the next real run,
      summarise the `upload` log lines (size bands, p50/p95 ms, failure rate) in this file and decide
      stage B.

## 5. Stage B (only if 4.4 meets the trigger in design)

- [ ] 5.1 Write its own design addendum and tasks before any code.

## Progress notes (2026-09-26)

- 1.1/2.1: `attemptBudgetMs` is size derived. My first test table was wrong, not the code: 12 MB at
  the 12 KB/s floor needs 1084 s, which is ABOVE the 15 minute cap, so 12 MB is held at the cap and
  6 MB (572 s) is the scaling row.
- 1.2/2.2: `uploadFailureResponse` (stalled 408, io 500, too-large 400) and `uploadLogRecord` (no uid,
  no filename, runId parsed from the path), vitest 32/32. `server.requestTimeout` is 16 min. Checked
  the layers in front: Caddy sets no proxy timeout, and Cloudflare's 100 s limit (524) counts only
  the wait for the response after the body arrived, so Node's 300 s default was the cutter.
- 1.3/2.4/2.6: `CAMERA_OPEN_DEADLINE_MS` (12 s) + `withCameraDeadline`, which also stops a stream
  that arrives after the deadline (the camera light must not stay on). Used by `VideoEntry.openCamera`
  AND `AudioEntry.start`; a timeout says "did not open" (not "denied") and offers the native picker.
  `captureProfileFor` gives 960x540 at 1.0 Mbps on saveData/slow-2g/2g/3g; the recorder's bitrate
  now follows the chosen profile.
- 1.4/2.3/3.1: `lib/pendingUpload.ts` (`scripts/test-pending-upload.ts`, incl. the source guard: no
  `uploadTask(Photo|Audio|Video)` in TaskRunner). All three kinds begin at capture, a retake aborts
  the old transfer through an `AbortSignal` that reaches the XHR (`upload/aborted`, never retried),
  send `take`s the upload and forgets it only after the submit succeeds. Entries announce captures
  from ONE effect on `blob` that skips the mount, so a remount mid-send cannot abort the send's own
  upload. A too-short video is not uploaded. `services/firebase.ts` has one entry point,
  `uploadTaskMedia`. The newest upload owns the progress store, so an aborted one cannot blank the
  bar of its replacement. Three older source guards that pinned the old call shape were updated to
  pin the same intent (photo-survives-remount, participant-upload-path, video-upload-parity).
- 2.5: the screen wake lock already exists for the whole race (`useWakeLock` in PlayScreen), so no
  second one. Added the "keep the app open" line while a transfer runs and a retry backoff that ends
  as soon as the tab is visible again (`interruptibleSleep`, tested).
- 4.2 (D8) FINDING: run media on the VPS disk was NEVER deleted by retention. `pruneRunPII` called
  only `storage.bucket().deleteFiles`; production has no bucket, so it threw, logged, stamped the run
  pruned and left every photo, clip and recording on disk, against the Privacy Policy's 90 day
  promise. Fixed test-first as its own change: `openspec/changes/run-media-disk-retention`. Its
  one-off cleanup of already-pruned runs is an operator step there.
- Still owed: 4.1 (throttled preview), 4.3 gates, 4.4 deploy + real-run telemetry.
