# Tasks: video-upload-speed

Ordered by value: each stage ships on its own and makes uploads faster or the server safer by
itself. Stage 1 needs no protocol change. See design.md for every constant and rationale.

## 0. Before code

- [ ] 0.1 Read back `media-upload-reliability` task 4.4 telemetry if a real run has happened since
      (the `upload` log lines: p50/p95 ms by size band, failure rate). Record the numbers here as the
      baseline D1 is measured against. If there is no run yet, record "no baseline" and carry on.
- [x] 0.2 Product owner go-ahead on D1's picture trade-off. **Answer (2026-09-26): "only on a weak
      network".** The default stays 1280x720 @ 1.5 Mbps; only its audio drops 96 → 64 kbps (speech
      does not need more, design D1). A weak link goes lower in two tiers: `3g` or `saveData` ⇒
      960x540 @ 1.0 Mbps; `2g`/`slow-2g`, or this phone's own recent uplink sample under
      `WEAK_UPLINK_BPS` (the only weak signal an iPhone has) ⇒ 640x360 @ 600 kbps. Light audio 48 kbps.

## 1. Stage 1: fewer bytes, an honest ETA, a server brake

### RED

- [x] 1.1 (adapted to 0.2: default stays 720p, tiers 540p/360p only on a weak link) Extend `scripts/test-video-capture.ts` (design D1): default profile 960x540 @ 1.0 Mbps +
      64 kbps; light profile 640x360 @ 600 kbps + 48 kbps; `predictedClipBytesFor(seconds, profile)`
      for both; a ceiling clip on both profiles is under `MAX_PARTICIPANT_VIDEO_BYTES` with ≥ 50%
      headroom; replace the "720p class" assertion (`:138-142`) with the 540p one and a comment
      pointing at design D1; still no `exact`. Confirm RED.
- [x] 1.2 New `scripts/test-upload-eta.ts` (design D5): `uplinkPrior` layer order and totality;
      `meterStart`/`meterUpdate` warm-up discard, EWMA half-life, restart when `loaded` goes backwards;
      `estimateUploadEta` worked example (±1 s), `low ≤ high`, band narrows with progress, `stalled`
      after 5 s, `almost-done` at 97%, cap 900 s, seeded fuzz never yields NaN/Infinity; `etaLabel`
      bucket table, the 2 s hold, +30% needed to move up, `range` only when high/low > 2. Confirm RED
      (module missing).
- [x] 1.3 Extend `functions/uploadRoute.test.ts` (design D6): the 129th concurrent upload gets `503` +
      `Retry-After`; a third concurrent upload from one uid gets `503`; slots are released after ok,
      too-large, stalled and aborted; with an injected `statfs` below the floor, `PUT /upload` gets
      `507` and logs `outcome:'disk-floor'`. Confirm RED.
- [ ] 1.4 Device check for design D3 (no code): on two Android phones (one mid-range) and with an
      iPhone as the viewer, record 20 s with `video/mp4;codecs=avc1.42E01E,mp4a.40.2` vs VP8 WebM at
      the new profile. Compare blob sizes (is the bitrate honoured?), phone heat and the pause after
      stop, and playback in the Run Console on iPhone Safari and desktop Chrome. Record the result
      here. It decides whether 2.2 flips the order.
- [ ] 1.5 Source guard in `scripts/test-video-recorder-guards.ts`: the mime preference comes from one
      exported constant in `videoCapture.ts` (not an inline list in `TaskRunner.tsx`). Confirm RED.

### GREEN

- [x] 2.1 `videoCapture.ts`: new profile constants, `predictedClipBytesFor`, `predictedClipBytes`
      kept as the default wrapper. `TaskRunner` `VideoEntry` passes the chosen profile's bitrates
      (already does via `profileRef`). 1.1 → green. Update the sizing comment in `uploadRoute.js:36-43`
      and the `MAX_VIDEO_BYTES` comment in `TaskRunner.tsx:2757`.
- [ ] 2.2 `VIDEO_MIME_PREFERENCE` constant in `videoCapture.ts`; `pickVideoMimeType` reads it. Put
      H.264/MP4 first only if 1.4 passed, otherwise keep today's order and note why. 1.5 → green.
- [x] 2.3 `apps/play-web/src/lib/uploadEta.ts` exactly as design D5. 1.2 → green.
- [x] 2.4 Progress store: add the `{loaded, total, atMs}` channel beside `pct` in
      `uploadResiliency.ts`, published from `uploadViaVps` and `uploadViaFirebaseStorage`. On
      success, write the `UplinkSample` to `localStorage['rp-uplink']` (try/catch, uploads ≥ 200 KB
      only). Nothing that reads `pct` changes.
- [x] 2.5 (browser check owed: the demo seed has no video mission; real phone check owed too) UI: `UploadProgress` shows percent · ETA label, "waiting for signal" when `stalled`,
      re-evaluated on progress and published at most every 2 s. The `VideoEntry` review screen shows
      "sending takes about X" from the blob's real size + prior (or measured when the capture-time
      upload is already running). No ETA while filming.
- [x] 2.6 i18n he/en for every new line (Hebrew first; buckets "כמה שניות", "בערך חצי דקה",
      "1–2 דקות", "מחכים לקליטה", "כמעט סיימנו"). `npm run i18n:check:strict` clean.
- [x] 2.7 `uploadRoute.js`: process-local in-flight counter (global 128, per uid 2) → `503` +
      `Retry-After: 3`, released in `finally`; `statfs` disk floor (`max(2 GiB, 5%)`, cached 10 s) →
      `507`. Both added to `uploadFailureResponse`/`uploadLogRecord`. Injected dependencies so the
      test can drive them. 1.3 → green.
- [x] 2.8 `mediaServing.js`: replace `existsSync`/`statSync`/`openSync`/`readSync` with
      `fs.promises.stat` + `FileHandle.read`, keeping every guard and header.
      `scripts/test-range-request.ts`, `test-media-content-type.ts` and `test-content-disposition.ts`
      stay green unchanged.
- [x] 2.9 (logged only for a minute with uploads or a loop p99 ≥ 100 ms, so an idle API stays quiet) `server.js`: one `{msg:'uploads', inFlight, peak, loopDelayP99Ms}` line per minute from
      `perf_hooks.monitorEventLoopDelay` (reset each minute, never throws).

### REFACTOR

- [x] 3.1 Remove the duplicate `MAX_VIDEO_BYTES` in `TaskRunner.tsx`; import
      `MAX_PARTICIPANT_VIDEO_BYTES` from `videoCapture.ts`.
- [ ] 3.2 One helper for "is this a retryable HTTP status" shared by `uploadViaVps` and the session
      transport of stage 3 (408, 429, 5xx), with a test row for 503 and 507.

## 2. Stage 2: the dashboard loads posters, not video

### RED

- [x] 4.1 (reshaped: the poster uploads as `<taskId>-poster` through the same per-phone folder helper, so the pure test is `scripts/test-poster-frame.ts` for sizing + the id) New `scripts/test-poster-path.ts`: `posterUploadPath(videoPath)` replaces the extension with
      `.poster.jpg`, stays in the same `runs/{run}/teams/{uid}/` folder, and is total on odd input.
      Confirm RED.
- [x] 4.2 `scripts/e2e-verify.mjs`, video-submission scenario: a valid `posterUrl` + `mediaDurationSec`
      are stored on the task record and the feed item; a `posterUrl` in another team's folder →
      `invalid-argument`; `null` for either is accepted as absent; `mediaDurationSec` of `-1`/`9999`/
      `NaN` is dropped, not refused. Confirm RED with `npm run e2e` (exit code captured to a file,
      never piped through `tail`).
- [x] 4.3 Source guard (`scripts/test-video-recorder-guards.ts` or a new creator-web scan): every media
      `<video` in `RunConsolePage.tsx` and `TeamPage.tsx` passes `poster` and derives `preload` from
      it. Confirm RED.

### GREEN

- [x] 5.1 (stored on `taskSubmissions[taskId]`, where the media already lives, plus the feed item; the length rule is `mediaDurationForRecord` in shared/videoDuration.ts, scripts/test-media-duration-record.ts) `submitStationPhoto` (`functions/src/index.ts:1682`): optional `posterUrl` (validated with
      `requireStorageUrl`, same run + uid) and `mediaDurationSec` (finite, 0 < x ≤ ceiling + 5, else
      dropped). Stored beside `photoUrl` at the task record and the feed item writes. `null` counts as
      absent. 4.2 → green.
- [x] 5.2 play-web: `posterUploadPath` (4.1 → green); poster capture at stop from the preview
      `<video>` (480 px, JPEG 0.7) and for picked files after `loadeddata` + seek 0.5 s, 3 s timeout,
      fails open. Poster upload through `uploadTaskMedia` in parallel with the clip. The submit
      payload **omits** `posterUrl`/`mediaDurationSec` when absent (the `undefined`→`null` rule).
      `mediaDurationSec` comes from the recorder's own elapsed counter, or the picked file's
      readable duration.
- [x] 5.3 creator-web: map `posterUrl`/`mediaDurationSec` through the photo-review queue, media gallery,
      feed and team dossier view models. `<video poster preload={poster ? 'none' : 'metadata'}>` plus a
      duration badge in all four places. 4.3 → green. i18n for the badge's aria label.

### REFACTOR

- [x] 6.1 Extract one `<ClipTile>` in creator-web used by all four places, so the poster/preload rule
      lives once (update the guard in 4.3 to pin the component instead of four call sites).

## 3. Stage 3: send while filming, resume instead of restart

### RED

- [x] 7.1 New `functions/uploadSessionRoute.test.ts` (design D4): create validates path, type, IDOR and
      cap with the SAME table as the PUT tests; PATCH appends; a wrong `Upload-Offset` → `409` + true
      offset; a mid-stream abort keeps the bytes and `HEAD` reports them; a resumed PATCH completes
      byte-identical to the source; the cumulative cap trips across PATCHes; a concurrent PATCH →
      `409`; another uid's HEAD/PATCH/DELETE → `403`; DELETE removes temp + sidecar; a session older
      than `TMP_TTL_MS` is swept; the final `{url}` equals PUT's shape; the stage-1 concurrency and
      disk caps apply to create and PATCH. Confirm RED.
- [x] 7.2 (the engine got its own suite, scripts/test-stream-upload.ts; pendingUpload.ts stayed unchanged because the video starter consults the stream) Extend `scripts/test-pending-upload.ts`: a streaming entry accepts appended chunks before the
      final blob exists; `forget` aborts the queue and issues the session DELETE; a transport failure
      resumes from the reported offset and never re-sends committed bytes (a fake transport records
      byte ranges). Confirm RED.
- [x] 7.3 Extend `scripts/test-video-capture.ts`: `RECORDER_TIMESLICE_MS === 4000`;
      `recorderTimesliceFor('webkit')` is `undefined` (off) until 10.2; Chromium gets 4000. Confirm RED.

### GREEN

- [x] 8.1 `functions/uploadSessionRoute.js` (create/HEAD/PATCH/DELETE), built from `uploadRoute.js`'s
      exported checks and `streamToFileWithLimit` (append mode, bytes kept on stall/abort). In-memory
      per-session lock, JSON sidecar, per-uid cap 4. The same "single process only" warning comment as
      `RUSHPOINT_DOC_CACHE`. 7.1 → green.
- [x] 8.2 (+ Dockerfile.api copies the new module; scripts/test-api-image-contents.ts caught it) `server.js`: mount the routes, CORS preflight for `POST, HEAD, PATCH, DELETE` with
      `Upload-Offset, Upload-Length, Tus-Resumable` allowed and `Upload-Offset, Location` exposed.
      `Caddyfile.api`: make sure `/upload/sessions*` gets the raised `request_body` limit (extend the
      `@upload` matcher to `path /upload /upload/sessions*`).
- [x] 8.3 play-web session transport in `services/firebase.ts`: create → sequential PATCH queue → on
      failure `HEAD` + resume, inside the existing `runWithRetry`/stall/abort envelope. Fall back to
      `PUT /upload` when create answers 404. Progress = committed + in-flight, feeding the stage-1
      meter.
- [x] 8.4 (reshaped: `lib/streamUpload.ts` holds the streaming state; pendingUpload keeps its contract and the video starter finishes the matching stream) `pendingUpload.ts`: streaming entries (`beginStream`, `append`, `finish(blob)`), keeping
      `begin/take/forget/ready` semantics for photos, audio and picked files. 7.2 → green.
- [x] 8.5 `VideoEntry`: `recorder.start(recorderTimesliceFor(engine))`; each `dataavailable` goes to
      `chunksRef` AND `pending.append`; stop → `finish(blob)`. A too-short clip still does not submit,
      and its session is deleted. 7.3 → green.

### REFACTOR

- [x] 9.1 (a picked or one-blob clip gets a stream at send) `PUT /upload` for picked video files goes through the session transport too (resume for
      large camera-roll clips). The PUT route stays for photos, audio, creator media and the fallback.
- [x] 9.2 (the PUT path remains only as the fallback for no session route) Delete any leftover whole-file retry path for recorded video in `TaskRunner.tsx`.

### Owner decision 2026-09-26: ship stage 3 without an on/off switch

The owner asked for send-while-filming now, without a toggle; a live simulation follows the next
day. Verified locally against the REAL API server (functions/server.js on the auth emulator) and a
play-web build pointed at it, in Chromium:

| Scenario | Clip | After stop | Result |
|---|---|---|---|
| clean link, 1 s slices | 4.79 MB | 23 ms | byte-identical on disk |
| 3 s offline mid-recording | 5.92 MB | 18 ms | resumed by HEAD, byte-identical |
| 2.5 s offline right after stop | 3.01 MB | 3.0 s | resumed, byte-identical |
| 2 Mbps up, 100 ms latency, 4 s slices, 20 s 720p | 2.27 MB | 2.3 s (whole clip after stop: 9.1 s) | the stitched file plays, 1280x720 |

Still owed: iPhone (WebKit records one blob, so it gets resume but not send-while-filming until
10.2) and a real Android phone.

## 4. Verify and ship

- [ ] 10.1 Preview (DevTools throttling), per design "UI lane": ETA range on review, ETA narrowing
      during upload, "waiting for signal" on a 10 s cut, then recovery. In stage 3, at 2 Mbps up:
      PATCHes during recording and one short PATCH after stop, with a 30 s cut mid-recording resuming
      from the offset. Run Console with 10 clips: posters shown, zero `/uploads/*.webm` requests
      before play.
- [ ] 10.2 WebKit timeslice device check (iPhone, current iOS): does a 4 s-timeslice recording
      concatenate to a playable file in the Run Console? Only if yes, turn it on in
      `recorderTimesliceFor` with a test row.
- [ ] 10.3 Gates: `npm run verify` then `npm run e2e`, then `npm run verify:emulator`, run SEQUENTIALLY
      (never two gauntlets at once: the shared `dist` rewrite). Exit codes redirected to files and
      read, never piped through `tail`.
- [ ] 10.4 Deploy order: VPS API rebuild first (new routes, caps, 503/507 behaviour), then hosting
      (play, creator). Old clients keep using `PUT /upload`. New clients fall back to it on 404.
- [ ] 10.5 After the next real run: summarise the `upload` + `uploads` lines (p50/p95 ms by size band,
      failures by outcome, peak in-flight, loop p99) here against the 0.1 baseline. Recalibrate
      `UPLINK_TO_DOWNLINK` and `DEFAULT_UPLINK_BPS` in `uploadEta.ts` if the medians say so, with a
      test update.

## 5. Stage 4 (only on evidence; each needs its own design addendum first)

- [ ] 11.1 D9 remux: only if 10.1/10.5 show reviewers cannot seek or see duration on real clips
      despite `mediaDurationSec`.
- [ ] 11.2 D10 direct-to-object-storage: only if a D10 trigger fires (loop p99 > 100 ms at upload
      peak, ingress > 30% of the port, any disk-floor refusal in a real run, or a Cloudflare video
      notice). Open a separate change.
- [ ] 11.3 D2 follow-up: a WebCodecs downscale for oversized camera-roll picks, only if the telemetry
      shows `too-large` refusals from the picker path.
