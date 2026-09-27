## Context

The upload path, end to end: capture (PhotoEntry compresses; Video/AudioEntry record with
`MediaRecorder`) → player presses send → `uploadTaskPhoto/Audio/Video` → `uploadResilient`
(3 attempts, 45 s stall abort, 180 s absolute abort, jittered backoff) → `uploadViaVps`
(XHR `PUT {apiOrigin}/upload?path=runs/{runId}/teams/{uid}/{task}-{ts}.{ext}`) → Cloudflare →
Caddy → Node `uploadRoute.js` (streams to `.tmp`, rename) → `{url}` → `submitStationPhoto`.

## Decisions (stage A)

### D1: upload on capture, submit on press

A per-mission `PendingUpload` (in `TaskRunner`, keyed by task id beside `capturedRef`):
`{ blob, promise, abort(), url?, error? }`. Created by the entry's `onCaptured` callback, for all
three kinds. `send` awaits `promise` (showing the real phase from `submission-status-truth`) and
then calls `submitStationPhoto` with the url. A retake aborts the pending upload and starts a new
one.

The upload path already includes `Date.now()`, so a retake never overwrites the previous object; an
abandoned capture leaves one orphan file. Bounded by retakes; see D8 for retention.

A viewer phone (if `team-phones-simple` lets it submit media) uses the same mechanism.

### D2: kill stalls, not slowness

`UPLOAD_MAX_MS` becomes a SIZE-DERIVED ceiling: `max(180 s, bytes / 12 KB/s + 60 s)` (a ~100 kbps
floor, far below any usable field connection), capped at 15 minutes. The 45 s no-progress stall
detector is the real "dead" signal and stays. Pure: `attemptBudgetMs(bytes)` in
`uploadResiliency.ts`.

Server: set `requestTimeout` on the Node server to 16 minutes (above the client's cap), leaving
`headersTimeout` at its default, and keep the per-upload 45 s stall timer in `uploadRoute.js` as
the dead-connection guard. `server.js`: `const server = app.listen(...); server.requestTimeout = …`.

### D3: a server stall is retryable

`uploadRoute.js`: `reason === 'stalled'` → `408`; `io` → `500`; `aborted` → no body (the client is
gone). Client unchanged: 408 is already retryable. A test pins the mapping.

### D4: reuse the finished upload for every kind

`audio()` and `video()` get the same `cached?.url ?? await upload…` shape as `photo()`, through the
single `PendingUpload` of D1 (which removes the three copies).

### D5: a camera that never answers

`openCamera` races `getUserMedia` against a 12 s deadline (pure constant in `videoCapture.ts`).
On timeout: stop any late stream when it arrives, clear `opening`, show "the camera did not open"
and offer the native camera input (the existing `unsupported` fallback). Same for `AudioEntry`.

### D6: keep the upload alive

While a `PendingUpload` is in flight: request a screen wake lock (reuse `hooks/useWakeLock.ts`),
show "keep the app open until it is sent", and on `visibilitychange → visible` with a stall
already detected, retry immediately rather than waiting out the backoff. iOS suspends network work
in a backgrounded tab; nothing can prevent that, so the honest remedy is telling the player and
recovering fast.

### D7: upload telemetry

`uploadRoute.js` emits one structured log line per request: `{ msg: 'upload', kind, bytes, ms,
outcome: 'ok'|'too-large'|'stalled'|'aborted'|'io'|'refused', runId }` (runId parsed from the
path; no uid, no filename). This is the evidence stage B needs, and it answers "how long do uploads
take" for the first time. Size: one line per upload, negligible against the existing log caps.

### D8: retention check

Stage A includes a verification task: confirm whether run-media on the VPS disk
(`/data/uploads/runs/{runId}`) is deleted by the run retention sweep
(`functions/src/maintenance/runRetention.ts` deletes a Storage prefix). If not, record it as a
separate change; orphan uploads from D1 make the question slightly more relevant, not new.

### D9: lighter recorder profile on a weak link

If `navigator.connection?.saveData` or `effectiveType ∈ {slow-2g, 2g, 3g}`, the recorder asks for
960×540 at 1.0 Mbps. `ideal` constraints only (the existing rule: never `exact`). Pure decision in
`videoCapture.ts`, `captureProfileFor(connection)`, total on a missing API (iOS has none ⇒ default).

## Stage B (only if D7 shows it is needed)

Trigger: over one real run, more than 5% of uploads over 5 MB end `stalled`/`aborted` after all
retries. Then: `POST /upload/session` → `{id}`; `PUT /upload/session/{id}` with `Content-Range`
appending to `.tmp/{id}`; `HEAD` returns the committed offset; the final chunk renames into place and
returns `{url}`. Same auth, IDOR and size checks, per chunk. Designed then, not now.

## Risks

- Background upload spends data on a capture the player then discards. Accepted: it is the same
  bytes they were about to send, and D9 shrinks them on weak links.
- A longer server request timeout holds a socket longer. Bounded by the 45 s stall guard.

## Test strategy

- Pure (`scripts/test-upload-resiliency.ts`, extend): `attemptBudgetMs` table (0 bytes, 1 MB, 12 MB,
  100 MB → cap); `captureProfileFor` for each connection shape and for `undefined`.
- Vitest (`functions/uploadRoute.test.ts`, extend): stalled → 408, io → 500, too-large → 400
  unchanged, the telemetry line's shape and that it carries no uid.
- Pure (`scripts/test-video-capture.ts`, extend): `CAMERA_OPEN_DEADLINE_MS` exists and is under 15 s;
  the lighter profile still fits `MAX_PARTICIPANT_VIDEO_BYTES` at the ceiling length.
- Source guard: `audio()` and `video()` go through the shared `PendingUpload` (no direct
  `uploadTaskVideo` call left in a submit handler).
- UI via preview with network throttling (DevTools "Slow 3G"): record a 20 s clip, watch the upload
  start in review and finish before "send"; press send and confirm only the save step remains.
- Post-deploy: after the next real run, read the `upload` log lines and write the numbers into the
  change (median/p95 ms by size band, failure rate). This decides stage B.
