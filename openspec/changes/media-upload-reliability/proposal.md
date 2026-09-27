## Why

Field report 2026-09-25: *"uploading takes a long time"*, and on one phone *"the button was simply
grey"*. `submission-status-truth` removes the fake "uploading" state; this change makes the real
upload faster, sturdier and self-explaining. What the code does today
(`apps/play-web/src/services/firebase.ts`, `functions/uploadRoute.js`):

1. **Nothing starts until "send".** The clip is recorded, reviewed, and only then uploaded as one
   request. The seconds a player spends watching their own clip are wasted.
2. **One whole-file PUT, no resume.** Any failure restarts from byte zero.
3. **A progressing upload is killed.** `UPLOAD_MAX_MS = 180_000` caps each attempt regardless of
   progress. The recorder's own ceiling clip is ~12 MB (1.5 Mbps + 96 kbps × 60 s); at a congested
   0.5 Mbps uplink that needs ~190 s, so it is aborted at 180 s and re-sent from zero, three times.
   Production clips on disk range 6–14 MB. Behind it, Node 20's default `server.requestTimeout`
   (300 s) would cut it anyway (`functions/server.js` never overrides it; the container runs
   `v20.20.2`).
4. **The server's own stall answer is treated as final.** On a 45 s stall the route replies
   `400 INVALID_ARGUMENT "Upload failed"` (`uploadRoute.js`, `streamToFileWithLimit` rejection
   path); the client maps every non-408/429 `4xx` to the NON-retryable
   `storage/invalid-argument` (`firebase.ts`, `uploadViaVps`). A phone that paused for 45 s (screen
   locked, app switched) gets "upload failed" with no retry.
5. **Only photos reuse a finished upload.** If `submitStationPhoto` fails after a successful upload,
   `photo()` reuses the stored URL, but `audio()` and `video()` re-upload the whole file.
6. **The camera can hang the button.** `VideoEntry.openCamera` sets `opening = true` and awaits
   `getUserMedia` with no timeout; a device that never answers (a dismissed permission sheet on some
   Android builds, a camera held by another app) keeps "start recording" disabled forever. One of
   the three causes of "the button was grey".
7. **No evidence is recorded.** The API logs nothing about uploads that succeed, so "how long do
   uploads take in the field" cannot be answered from production today. The only trace is file
   mtimes.

Ruled out: Cloudflare buffering. The default "Standard" request-body mode streams to the origin,
inspecting only a prefix (Cloudflare changelog 2026-01-27, body buffering settings).

## What Changes

**Stage A (P0):**
- The upload starts in the background the moment a capture is ready (photo compressed, clip
  stopped); "send" only waits for it and then records the submission.
- A progressing upload is never killed for being slow; only a stalled one is. The server allows long
  uploads on the upload route.
- A server-side stall is answered as a retryable condition; the client retries.
- Audio and video reuse a finished upload exactly like photos.
- Opening the camera has a deadline; past it the player is offered the phone's own camera.
- While an upload is in flight the screen stays awake and the player is told to keep the app open;
  returning to the app resumes a stalled attempt immediately.
- The API records every upload's size, duration and outcome.
- On a slow or data-saver connection the in-app recorder uses a lighter profile.

**Stage B (conditional):** resumable chunked uploads, built only if stage A's telemetry shows
material failure of large uploads after retries.

## Non-goals

- The status line and the rejection latch (`submission-status-truth`).
- Server-side transcoding, thumbnails, any media analysis.
- Changing upload size caps.

## Surfaces

- play-web: `services/firebase.ts`, `lib/uploadResiliency.ts`, `lib/videoCapture.ts`, `components/TaskRunner.tsx`, `hooks/useWakeLock.ts`, `i18n.ts`.
- VPS API (not a callable): `functions/uploadRoute.js`, `functions/server.js`. Ships by VPS rebuild (`vps-api-deploy-procedure`), expect the known ~40 s 503 window.
- No Firestore rule, index or callable change in stage A. Stage B adds two HTTP routes.
