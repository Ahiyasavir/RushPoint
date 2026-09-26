## Context

### What exists today (read 2026-09-26)

| Step | Where | What it does |
|---|---|---|
| Capture profile | `apps/play-web/src/lib/videoCapture.ts:31-39` | `ideal` 1280x720 @ 30 fps, rear camera |
| Bitrates | `videoCapture.ts:49-50` | video 1,500,000 bps, audio 96,000 bps |
| Weak-link profile | `videoCapture.ts:92-114` | `saveData` or `effectiveType` in {slow-2g, 2g, 3g} ⇒ 960x540 @ 1.0 Mbps |
| Byte prediction | `videoCapture.ts:63-66` | `predictedClipBytes(seconds)` from the DEFAULT constants only |
| Mime choice | `apps/play-web/src/components/TaskRunner.tsx:2759-2768` | `video/webm;codecs=vp8,opus` → `video/webm` → `video/mp4` |
| Recorder | `TaskRunner.tsx:3105-3131` | `new MediaRecorder(stream, {mimeType, videoBitsPerSecond, audioBitsPerSecond})`, `recorder.start()` with **no timeslice**: one blob at stop |
| Native picker fallback | `TaskRunner.tsx:3152-3175` | refuses > 20 MB, nudges to the in-app recorder |
| Upload on capture | `apps/play-web/src/lib/pendingUpload.ts` | one entry per task, begins when the capture exists, aborted on retake |
| Transport | `apps/play-web/src/services/firebase.ts:200-292` | ONE XHR `PUT {api}/upload?path=…` with the whole blob, 45 s stall abort, progress via `xhr.upload` |
| Retry | `firebase.ts:189`, `:364-412` | 3 attempts, each re-sends from byte 0, `attemptBudgetMs(size)` per attempt |
| Progress UI | `TaskRunner.tsx:2165-2197` | percent only (`uploadingPercent`), "retrying", "starting" |
| Edge | `deploy/Caddyfile`, `deploy/CLOUDFLARE.md` | client → Cloudflare Free (proxied, IL geo-block) → Caddy → Node :8080 |
| Proxy | `Caddyfile.api:16-47` | `request_body max_size 60MB` on `/upload`, `encode gzip` (default matcher excludes video, so clips are not recompressed) |
| Upload route | `functions/uploadRoute.js:100-184`, `:261-382` | auth → path → type → IDOR → Content-Length fast path → stream to `.tmp` with byte cap + 45 s stall → rename → `{url}` |
| Caps | `uploadRoute.js:30-45` | photo/audio 10 MB, participant video 20 MB, creator 50 MB |
| Telemetry | `uploadRoute.js:243-259` | one `{msg:'upload', kind, bytes, ms, outcome, runId}` line per upload |
| Server | `functions/server.js:289-298` | one Node process, `requestTimeout` 16 min, also serves every callable |
| Storage | `docker-compose.api.yml:129,145` | `/data/uploads` on the VPS disk. Firebase Storage is used only by the emulator lane (`firebase.ts:296`) |
| Serving | `functions/mediaServing.js:252-348` | `GET /uploads/*`: `existsSync`/`statSync` (`:268`, `:274`), sync 64 KB probe for `.webm` (`:287-291`), `Cache-Control: public, max-age=31536000, immutable` (`:307`), `Accept-Ranges` + 206 |
| Dashboard | `apps/creator-web/src/pages/RunConsolePage.tsx:2864`, `:3082`, `:3175`; `components/TeamPage.tsx:125` | `<video controls playsInline preload="metadata" src=…>`, no poster |
| Submission | `functions/src/index.ts:1682` (`submitStationPhoto`) | validates `photoUrl` with `requireStorageUrl` (same run + uid folder), stores `photoUrl` + `mediaKind` on the task record (~`:1840`) and the feed item (~`:1882`) |
| Retention | `openspec/changes/run-media-disk-retention` | run media on disk is deleted with the run's PII |

Production evidence available: `media-upload-reliability` design notes clips on disk of 6 to 14 MB,
and its field report ("uploading takes a long time"). Its telemetry task (4.4, p50/p95 by size band)
has not been read back yet. Several numbers below are therefore **arithmetic or assumptions, marked
as such**. Task 10.5 rereads them against that telemetry.

### The one equation

    time_to_done ≈ bytes_left / uplink_Bps + finalize          (per attempt)
    total        ≈ Σ attempts, each restarting from 0 today

Three levers exist and every product researched uses all three: **fewer bytes** (WhatsApp,
Instagram and TikTok re-encode on the device before sending), **start earlier** (Loom streams while
recording), **never re-send what arrived** (tus, GCS resumable, S3 multipart, Cloudflare Stream,
Vimeo, YouTube resumable). The server side ("don't crash") is a separate axis. At our scale it is
about bounding concurrency and disk, not bandwidth (D6).

---

## Decisions

### D1. Record fewer bytes: a profile sized for review, not for watching

> **Owner decision (task 0.2, 2026-09-26): "only on a weak network".** The table below was the
> proposal. What ships: default **1280x720 @ 1.5 Mbps + 64 kbps** (picture unchanged, audio trimmed);
> weak tier 1 (`3g`, `saveData`) **960x540 @ 1.0 Mbps + 48 kbps**; weak tier 2 (`2g`, `slow-2g`, or a
> recent measured uplink below `WEAK_UPLINK_BPS` = 100 KB/s, which also reaches iPhones that have
> no `navigator.connection`) **640x360 @ 600 kbps + 48 kbps**. The byte savings on good connections
> therefore come from D4 (send while filming) and resume, not from a softer picture.

| Profile | Frame | Video | Audio | 40 s clip | 60 s clip | vs today |
|---|---|---|---|---|---|---|
| today default | 1280x720@30 | 1.5 Mbps | 96 kbps | 7.98 MB | 11.97 MB | — |
| **new default** | **960x540@30** | **1.0 Mbps** | **64 kbps** | **5.32 MB** | **7.98 MB** | **-33%** |
| today light | 960x540@30 | 1.0 Mbps | 96 kbps | 5.48 MB | 8.22 MB | — |
| **new light** | **640x360@30** | **600 kbps** | **48 kbps** | **3.24 MB** | **4.86 MB** | **-41%** |

(MB = 10^6 bytes; `(video + audio) × seconds / 8`.)

Rationale:
- Upload time is linear in bytes. -33% bytes means -33% wait on every connection, with no protocol
  work. It is the largest win per line changed in this document.
- Reference points. Apple's HLS authoring spec for Apple devices lists H.264 960x540 at 2000 kbps as
  the Wi-Fi default and 640x360 at 730 kbps as the cellular default. Those numbers are for
  *entertainment* playback from offline two-pass encoders.
  ([Apple HLS authoring spec](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices),
  ladder summarised in [jonathaneoliver/infinite-streaming#868](https://github.com/jonathaneoliver/infinite-streaming/issues/868)).
  WhatsApp's standard quality sends about 476x848, and even "HD" caps at 1280x720
  ([snapvid](https://snapvid.org/blog/why-whatsapp-lowers-video-quality-and-what-actually-works),
  [compresto](https://compresto.app/blog/compress-video-for-whatsapp-without-quality-loss)). A
  reviewer judging a mission clip needs less than either.
- Audio: Opus is near fullband for speech from about 16 to 24 kbps, and 64 to 96 kbps is the
  *stereo music streaming* range ([Xiph Opus recommended settings](https://wiki.xiph.org/Opus_Recommended_Settings)).
  64 kbps (48 kbps light) is still generous for field audio and removes 32 to 48 kbps of pure
  overhead.
- Quality trade-off (honest): a realtime MediaRecorder encoder is less efficient than an offline one.
  1.0 Mbps at 960x540@30 is 0.064 bits per pixel per frame, which is soft but legible for a phone
  clip. **This supersedes `video-capture-profile`'s "720p class to read a sign" intent**, so its test
  (`scripts/test-video-capture.ts:138-142`) changes deliberately, not accidentally. It is the one
  product decision in this change: task 0.2 records the owner's go-ahead, and the constants stay in
  one place so a one-line change can revert it.
- Still `ideal`, never `exact` (the existing rule, `videoCapture.ts:28-30`).
- `predictedClipBytes` becomes `predictedClipBytesFor(seconds, profile)`, and the old name is kept
  as the default-profile wrapper. The ETA (D5) must predict with the profile that is actually
  recording, not the default.

Safari caveat: WebKit added bitrate options to MediaRecorder (changesets
[265328](https://trac.webkit.org/changeset/265328/webkit),
[287613](https://trac.webkit.org/changeset/287613/webkit)), but developers still report
`videoBitsPerSecond` being ignored on some versions. So the ETA uses the **real blob size** whenever it
exists, and uses predicted bytes only before the blob exists (D5).

### D2. No in-browser transcoding of recorded clips; one guarded exception later

- A recorded clip is already encoded at the target bitrate. Re-encoding it only adds a delay.
- ffmpeg.wasm runs 10 to 50× slower than native, is single-threaded by default and cannot use
  hardware encoders ([ffmpeg.wasm performance](https://ffmpegwasm.netlify.app/docs/performance/),
  [RenderIO guide](https://renderio.dev/blogs/ffmpeg-wasm-guide)). That rules it out on a phone in the
  field.
- WebCodecs (e.g. via [Mediabunny](https://mediabunny.dev/guide/converting-media-files)) can do
  hardware-accelerated transcodes, but full WebCodecs on iOS arrived only with Safari 26. 16.4 to 18.x
  shipped video interfaces only ([MDN WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)).
- **The exception** is the native-picker path (`TaskRunner.tsx:3152`). A camera-roll clip can be
  4K/HEVC and is refused above 20 MB today. A WebCodecs downscale for that path alone, behind
  capability detection and failing open to today's refusal, is a reasonable *follow-up change*. It is
  not part of this one. (iOS historically downscaled library picks to 720p itself, but that
  behaviour changed around iOS 13 ([addpipe](https://blog.addpipe.com/video-quality-when-recording-videos-from-safari-on-ios-through-html-media-capture/)),
  so do not rely on it.)

### D3. Prefer H.264/MP4 where Chrome offers it (device-verified toggle)

- Chrome 126+ MediaRecorder records MP4 (H.264 + AAC, fragmented MP4)
  ([chromestatus 5163469011943424](https://chromestatus.com/feature/5163469011943424),
  [blink-dev intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/p1OMVj1FrMI)).
- Why it matters:
  1. Playback. VP8 WebM plays on iOS Safari only from 17.4 ([caniuse webm](https://caniuse.com/webm)),
     so an organizer on an older iPhone cannot watch an Android clip. H.264 MP4 plays everywhere.
  2. Heat and CPU. `video-capture-profile` recorded that Android commonly encodes VP8 in software.
     **Assumption to verify:** Chrome routes MediaRecorder H.264 to the platform hardware encoder on
     most Android devices.
- The new order is `video/mp4;codecs=avc1.42E01E,mp4a.40.2` → `video/webm;codecs=vp8,opus` →
  `video/webm` → `video/mp4`, behind one exported constant. The server allowlist
  (`uploadRoute.js:26`) and `uploadTaskVideo`'s extension map already accept `video/mp4`. **Shipped
  only after task 1.4**: record, upload and play on two real Android phones plus an iPhone viewer,
  and compare blob sizes at equal settings. If bitrate is not honoured or the files misbehave, the
  constant stays on WebM and the finding goes in tasks.md.

### D4. Send while filming, and resume instead of restart (stage 3)

**Protocol: a tus 1.0 subset, implemented in our own route module.**
- tus is the open standard for this ([tus protocol 1.0.x](https://tus.io/protocols/resumable-upload)),
  and Cloudflare Stream and Vimeo use it. The two operations that matter: `HEAD` returns
  `Upload-Offset`, the bytes the server has *stored*, and `PATCH` with `Upload-Offset: n` appends
  from exactly there. GCS resumable does the same ("query the server for the persisted offset and
  resume uploading remaining bytes from that offset",
  [GCS resumable uploads](https://docs.cloud.google.com/storage/docs/resumable-uploads)).
- Why our own module and not `@tus/server`: the route must reuse `classifyUploadPath`,
  `ownsUploadPath`, `contentTypeAllowed`, `maxBytesFor` and `streamToFileWithLimit`, which are the
  exact checks that already guard `PUT /upload`. The repo's rule is "by calling those very functions,
  not by restating them" (`server.js:176-178`). About four handlers, no dependency. Keeping the wire
  format tus-shaped means `tus-js-client` could replace our client later without a server change.
- Routes, all behind the same bearer-token auth:
  - `POST /upload/sessions?path=…` with `Content-Type` of the media (+ optional `Upload-Length`).
    Validates path, type, IDOR and cap exactly as `PUT /upload`. Creates `.tmp/s-{id}` plus a
    small JSON sidecar `{uid, path, contentType, maxBytes, createdAt}`. Answers
    `201 {id}` + `Location`.
  - `HEAD /upload/sessions/{id}` → `Upload-Offset` = temp file size. Only the owning uid may ask.
  - `PATCH /upload/sessions/{id}`, `Upload-Offset: n`, optional `Upload-Length: total` on the last
    one. `n` ≠ stored ⇒ `409` + current offset. Otherwise the body is appended through
    `streamToFileWithLimit` in append mode with the **cumulative** cap. When
    `Upload-Length` is reached: rename to the final path and answer `200 {url}` (same URL shape as
    `PUT /upload`).
    **On stall or abort the received bytes are KEPT.** Today's route deletes them
    (`uploadRoute.js:337`). Keeping them is what makes resume possible.
  - `DELETE /upload/sessions/{id}` → removes temp + sidecar (retake, discard).
  - One PATCH at a time per session (a second one gets `409`). A per-uid cap of 4 live sessions.
    Sessions older than `TMP_TTL_MS` (1 h) are swept by the existing `sweepStaleTempUploads`.
- Single process is assumed and already true on the VPS (`docker-compose.api.yml:90-99`). The
  session lock is an in-memory `Map`, and the sidecar lets a restart resume. **Do not run this route
  with `replicas > 1`.** It gets the same warning comment as `RUSHPOINT_DOC_CACHE`.
- `PUT /upload` stays unchanged for photos, audio, creator media and as the fallback when
  `POST /upload/sessions` answers 404 (old server during a deploy).

**Chunking: none after stop, one PATCH per recorder slice before it.**
- tus-js-client's own guidance: leave `chunkSize` at `Infinity` (one request) "unless you are being
  forced to", because chunks add overhead and hurt performance. It also found no performance gain from
  parallel uploads "for the average user"
  ([tus-js-client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md)). GCS says the
  same: "avoid breaking a transfer into smaller chunks" when possible. Cloudflare Stream's 5 MiB
  minimum and 256 KiB multiple are *their* storage constraint, not ours. Mux UpChunk's dynamic sizing
  (256 KB to 512 MB) solves huge desktop files
  ([UpChunk](https://github.com/muxinc/upchunk)).
- So: after stop, the rest of the clip goes in ONE PATCH, and a failure is resumed from the
  offset. One connection, never parallel. The phone's radio uplink is the bottleneck, and parallel
  streams only split it.
- While recording: `recorder.start(RECORDER_TIMESLICE_MS = 4000)`. Each `dataavailable` chunk (about
  530 KB at 1.06 Mbps) is pushed to BOTH `chunksRef` (the local review blob, unchanged) AND a
  sequential PATCH queue. After stop, only the backlog plus the final slice remain. On a link at least
  as fast as the capture bitrate, that is about one slice, under a second at 5 Mbps. This is Loom's
  model ("from the moment you start recording, Loom will immediately stream and store your video in
  the cloud", [podfeet on Loom](https://www.podfeet.com/blog/2020/09/loom-video-recording/)).
  4 s instead of 1 to 2 s keeps the request rate low: 100 teams filming at once is about 25 PATCH/s.
- The chunks of one recording concatenate to the recording, and only the first carries the
  container header ([MDN dataavailable](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event),
  [w3c/mediacapture-record#195](https://github.com/w3c/mediacapture-record/issues/195)). The server
  never needs to understand them: it appends bytes in order, which is exactly what offsets enforce.
- Cost: Chrome writes Duration only for non-chunked recordings. Chunked ones have neither Duration
  nor Cues ([addpipe on Chrome WebM duration](https://blog.addpipe.com/duration-in-webm-videos-produced-by-chrome/)).
  So D7 sends the recorder's own measured duration to the dashboard, and D9 is the fallback.
- iOS Safari: WebKit had timeslice-era MediaRecorder bugs that produced invalid files
  ([WebKit 216832](https://bugs.webkit.org/show_bug.cgi?id=216832)). Timeslice is enabled per
  engine through a pure `recorderTimesliceFor(userAgentFamily)`, **off for WebKit until task 10.2
  verifies it on a device**. WebKit still gets resume, just not send-while-filming.
- Retake: `pending.forget` → abort the queue → `DELETE` the session. The bytes already sent for a
  discarded take are spent. That is the same accepted cost as `media-upload-reliability` D1, now
  bounded by one take.

### D5. The ETA: a pure function over bytes and a layered throughput estimate

**Why this shape.** Download managers and CLI progress bars estimate "time remaining" as bytes left
over an exponentially weighted moving average of throughput, because the instantaneous rate
jumps around ([exponential smoothing](https://en.wikipedia.org/wiki/Exponential_smoothing),
[progressbar2 widgets](https://progressbar-2.readthedocs.io/en/latest/progressbar.widgets.html)).
NN/g: show percent-done or time remaining for waits over about 10 s, and details such as time remaining
make long waits more tolerable ([NN/g progress indicators](https://www.nngroup.com/articles/progress-indicators/),
[response time limits](https://www.nngroup.com/articles/response-times-3-important-limits/)).
Before any byte moves there is no measurement, so a prior is needed, and its source degrades by
platform:

- **Network Information API.** `downlink` is a **download** estimate in Mbps, rounded to 25 kbps,
  from "recently observed application layer throughput". `effectiveType` buckets RTT and downlink
  (3g: RTT ≥ 270 ms, downlink ≤ 700 kbps) ([WICG netinfo](https://wicg.github.io/netinfo/)). Chrome
  caps `downlink` at 10 Mbps ([mdn/content#18277](https://github.com/mdn/content/issues/18277)).
  **Safari and Firefox do not implement `navigator.connection`**
  ([caniuse](https://caniuse.com/mdn-api_networkinformation_downlink)). So on every iPhone there is
  no hint at all, and on Android the hint is about the *other* direction.
- **Our own past uploads** are the best prior: they measure *this phone's uplink to our server*.
  Every photo or clip upload leaves a sample.
- **XHR upload progress** is the right live signal ([Jake Archibald, 2025](https://jakearchibald.com/2025/fetch-streams-not-for-progress/):
  "If you want progress events today, the best way is to use XHR"). Its known faults: progress
  can jump to 100% when the network drops just before `error`
  ([whatwg/xhr#361](https://github.com/whatwg/xhr/issues/361)), and the first burst reports bytes
  handed to the OS, not bytes delivered (**assumption**, commonly observed). Hence the warm-up and
  the stall state below.

**Module:** `apps/play-web/src/lib/uploadEta.ts`, pure, total, no DOM, no clock. The clock is
passed in.

```ts
export type EtaBasis = 'measured' | 'recent' | 'network-hint' | 'default';

export interface ThroughputPrior { bytesPerSecond: number; basis: Exclude<EtaBasis, 'measured'>; spread: number; }

export interface ConnectionHint { effectiveType?: unknown; downlink?: unknown; saveData?: unknown; }

export interface UplinkSample { bytesPerSecond: number; atMs: number; bytes: number; }

/** Best prior before anything is measured. Total: every garbage input degrades to the next layer. */
export function uplinkPrior(p: { recent?: UplinkSample | null; connection?: ConnectionHint | null; nowMs: number }): ThroughputPrior;

/** Folds one progress event into the EWMA. Pure: returns the next state. */
export interface MeterState { firstAtMs: number | null; lastAtMs: number; lastLoaded: number; ewmaBps: number | null; warmedUp: boolean; lastProgressAtMs: number; }
export function meterStart(nowMs: number): MeterState;
export function meterUpdate(s: MeterState, loaded: number, nowMs: number): MeterState;

export interface EtaInput {
  totalBytes: number;            // blob.size when known, else predictedClipBytesFor(seconds, profile) × OVERSHOOT
  sentBytes: number;             // committed offset + current attempt's loaded
  meter?: MeterState | null;     // null before the first byte
  prior: ThroughputPrior;
  nowMs: number;
}
export interface UploadEta {
  state: 'estimating' | 'stalled' | 'almost-done';
  lowSeconds: number;            // finite, ≥ 0
  highSeconds: number;           // finite, ≥ lowSeconds, capped at ETA_CAP_SECONDS
  basis: EtaBasis;
}
export function estimateUploadEta(i: EtaInput): UploadEta;

/** What the player reads. Stable buckets, never a per-second countdown. */
export type EtaLabel =
  | { kind: 'seconds'; }                       // "a few seconds" (high < 10)
  | { kind: 'about'; seconds: 15 | 30 | 45 | 60 | 90 | 120 | 180 | 300 }
  | { kind: 'range'; lowMinutes: number; highMinutes: number }
  | { kind: 'stalled' } | { kind: 'almost-done' };
export function etaLabel(eta: UploadEta, previous?: EtaLabel | null): EtaLabel;
```

**Behaviour (all constants exported and pinned by the test):**

1. **Bytes.** `totalBytes` is the blob's real size once it exists (recorded or picked). Before that,
   for example in the recorder's review hint, it is `predictedClipBytesFor(elapsedSeconds, profile) ×
   BITRATE_OVERSHOOT (1.15)`. The 1.15 covers container overhead plus the encoder overshoot some
   Android devices show; `uploadRoute.js:36-43` measured a similar margin.
   `remaining = max(0, totalBytes - sentBytes)`.
2. **Prior** (`uplinkPrior`), first match wins:
   - `recent`: an `UplinkSample` from this device younger than `RECENT_SAMPLE_MAX_AGE_MS`
     (15 min: the player moves, the cell changes), taken from an upload of at least
     `MIN_SAMPLE_BYTES` (200 KB). Small photos under-measure because of TCP slow start and RTT, which
     errs pessimistic, which is the safe side. `spread = 1.6`.
   - `network-hint` (Chromium only): `saveData` ⇒ the 3g row. `effectiveType` → uplink table in
     bytes/s: `slow-2g` 4,000; `2g` 8,000; `3g` 50,000; `4g` →
     `clamp(min(downlink, 10) × 125,000 × UPLINK_TO_DOWNLINK (0.3), 60,000, 1,250,000)`. The 0.3
     ratio is an **assumption** (mobile uplink is usually a fraction of downlink). Task 10.5 recalibrates
     it from our own telemetry (`bytes/ms` by effectiveType). `spread = 2.0`.
   - `default` (iOS, Firefox, anything unreadable): `DEFAULT_UPLINK_BPS = 150,000` (1.2 Mbps).
     That is deliberately pessimistic against a national mobile median upload of about 35.6 Mbps
     ([SpeedOf.Me Israel, June 2026](https://speedof.me/internet-speed/israel)), because a field game
     is one crowded cell, not a median. `spread = 2.5`.
3. **Measured** (`meterUpdate`): samples before `WARMUP_BYTES` (128 KiB) **and** `WARMUP_MS` (1000 ms)
   are ignored (the socket-buffer burst). After that, an EWMA of `Δloaded/Δt` with half-life
   `EWMA_HALF_LIFE_MS = 3000`: `α = 1 − 0.5^(Δt/3000)`. Time-based, so irregular progress events
   do not bias it. A `loaded` that goes backwards (a new attempt) restarts the meter.
4. **Blend.** `w = clamp((now − firstWarmAt) / BLEND_FULL_MS (6000), 0, 0.9)`. The blend is
   **harmonic**: `bps = 1 / (w / measured + (1 − w) / prior)`. That averages *seconds per byte*,
   so one fast burst cannot make the ETA optimistic. The prior never drops below 10% weight, which
   keeps a noisy EWMA from swinging the label.
5. **Seconds.** `mid = remaining / bps + FINALIZE_SECONDS (2)`: last byte → rename → `{url}` →
   `submitStationPhoto` round trip.
   Range: `low = mid / f`, `high = mid × f`, where
   `f = 1 + (spread(basis) − 1) × (1 − fractionDone)`, `measured` spread = 1.3, so the band narrows as
   the upload proceeds. Clamp to `[0, ETA_CAP_SECONDS = 900]`, the same 15 min as `ATTEMPT_BUDGET_CAP_MS`.
6. **States.** No progress for `STALL_SHOW_MS` (5 s) ⇒ `stalled`. The UI says "waiting for signal"
   and shows no number, because a number during a stall is a guess dressed as a measurement.
   `fractionDone ≥ 0.97` ⇒ `almost-done`. If the XHR jumped to 100% and then errored, the retry
   restarts the meter (3.), so a false "almost done" lasts only until the error.
7. **Label** (`etaLabel`): `high < 10` ⇒ `seconds`. If `high / low ≤ 2`, `about` with the geometric
   mean snapped to {15, 30, 45, 60, 90, 120, 180, 300}. Otherwise `range` in whole minutes (`1–2`,
   `2–4`). **Hysteresis:** a new label replaces `previous` only if its bucket differs by at least one
   step *and* it has held for 2 s (the caller re-evaluates on progress, and publishes at most every
   2 s). An upward move needs the estimate to exceed the old bucket's upper bound by 30%, so the
   number does not creep up and down.
8. **Totality.** NaN, negative, `Infinity` or a missing prior yields `default` basis numbers, never
   NaN. `totalBytes ≤ 0` ⇒ `seconds`. Matches the rest of the participant hot path
   (`predictedClipBytes` "feeds an estimate and never a refusal").

**Worked example (arithmetic, not measurement).** iPhone, no hint, no recent sample, a 40 s clip on
the new default profile: `total = 5.32 MB × 1.15 = 6.12 MB`, `mid = 6.12e6 / 150e3 + 2 = 42.8 s`,
`f = 2.5` ⇒ 17 to 107 s ⇒ ratio > 2 ⇒ `range` "about 1 to 2 minutes" (rounded outward). Four
seconds into the upload, the meter reads 600 KB/s: `w = 0.5`, `bps = 1/(0.5/600e3 + 0.5/150e3) =
240 KB/s`, `mid ≈ 22 s` (minus bytes sent), `f ≈ 1.25` ⇒ "about 30 seconds". Two seconds later the
weight has risen and the label drops to "about 15 seconds".

**Where the sample comes from.** `uploadViaVps` (and the session transport) records
`{bytesPerSecond: bytes / (lastProgressAt − firstWarmAt), atMs, bytes}` on success into
`localStorage['rp-uplink']`, wrapped in try/catch (private mode ⇒ no prior, still works). Per-device
convenience only, as the artifact rules and CLAUDE.md prescribe for browser storage. The progress
store (`uploadResiliency.ts:492-512`) grows a sibling `{loaded, total, atMs}` channel. `pct` stays as
it is, so nothing that reads it changes.

**Where it is shown.**
- Review screen after stop (before or while sending): "sending takes about X". Total is the real
  blob size, prior only, or measured when the capture-time upload has already started.
- `UploadProgress`: the percent line gains the ETA label ("42% · about 30 seconds left"),
  "waiting for signal" when stalled, and the existing "retrying" wording is unchanged.
- In stage 3, after stop the remaining bytes are often under a second's worth. The label then reads
  "a few seconds", which is the honest answer and the point of D4.
- No ETA while filming. The countdown is already the one number on that screen.

### D6. Server load: bound concurrency and disk, keep the event loop free

**What the box can take (arithmetic from stated specs, not a load test).** IONOS VPS: 4 vCore, 4 GB
(`stream-upload-write` design), 1 Gbit/s port with unlimited traffic
([IONOS VPS](https://www.ionos.com/servers/vps)). Worst synchronized burst we design for: 100 teams
each send a 40 s clip within 2 minutes.

| Quantity | Today | After D1 |
|---|---|---|
| Bytes in the burst | 100 × 7.98 MB = 798 MB | 532 MB |
| Mean ingress over 120 s | 53 Mbps (5% of the port) | 35 Mbps |
| RAM for 100 concurrent streams | ~100 × (64 KB socket + 16 KB fs buffer) ≈ 8 MB | same |
| Disk written | 0.8 GB | 0.53 GB |
| Retries in the worst case | ×3 whole-file (2.4 GB) | ×1 + tails with D4 |

So at our scale bandwidth, RAM and CPU are not the risk. The phones' uplinks are the bottleneck,
not the server. Cloudflare's default request-body mode streams to the origin rather than buffering
(`media-upload-reliability`, citing the 2026-01-27 Cloudflare changelog), so a slow phone does hold a
Node socket for the whole transfer. Idle sockets cost almost nothing in Node. The real ways the box
falls over are:

1. **Disk full.** A full root filesystem stops the API and every callable with it
   (`docker-compose.api.yml:15-22` already calls this out for logs). New rule: `PUT /upload` and
   `POST /upload/sessions` check free space with `fs.promises.statfs(UPLOAD_DIR)` (Node ≥ 18.15;
   the container is on Node 20), cached for 10 s. Below `DISK_FLOOR_BYTES = max(2 GiB, 5% of
   volume)` they answer `507 INSUFFICIENT_STORAGE` and log `outcome:'disk-floor'`. A 5xx is already
   retried by the client up to 3 times, which is bounded, and the log line is what an operator greps
   for.
2. **Unbounded concurrency** (a retry storm, a bug, or abuse from an authenticated device).
   `MAX_CONCURRENT_UPLOADS = 64` streams per process and `MAX_UPLOADS_PER_UID = 2`. Over either:
   `503` + `Retry-After: 3`, retryable by the client's existing 5xx rule (`firebase.ts:267`). Counted
   in a process-local counter, released in `finally`, which is correct because the API is one
   process (the `rateLimitStore.ts` reasoning). 64 × 20 MB = 1.28 GB is the worst case of temp disk
   in flight, well inside the floor.
3. **The event loop.** Gameplay callables share it with media. `mediaServing.js` does `existsSync`,
   `statSync` and, for every `.webm`, `openSync`/`readSync` of 64 KB on each GET (`:268-291`). Each
   call is fast on NVMe, but it is synchronous work multiplied by every tile of every open dashboard.
   It moves to `fs.promises.stat` + `FileHandle.read`, which changes no behaviour and keeps the
   existing tests. Telemetry gets one `{msg:'uploads', inFlight, peak, loopDelayP99Ms}` line per
   minute from `perf_hooks.monitorEventLoopDelay`, so "did uploads starve the callables" becomes a
   number instead of a feeling.
4. **Retry amplification.** Today a failure costs a whole-file re-send, up to 3×. D4 turns that into
   "send the rest", which cuts bytes on the box in exactly the bad-network case.

Not recommended now: a queue in front of uploads (they are I/O-bound streams, and a queue would only
add latency), a second Node process (breaks `RUSHPOINT_DOC_CACHE` and the session map), or rate
limits beyond the concurrency caps (uploads are already authenticated and IDOR-bound).

### D7. Dashboard: posters and `preload="none"`, measured duration

- Per [web.dev on preload](https://web.dev/articles/fast-playback-with-preload): with many videos on
  one page, use `preload="none"` with a `poster`. Chrome already forces `metadata` on cellular and
  `none` under Data Saver. Posters are how every video grid (YouTube, Loom, Instagram) shows many
  clips without pulling video.
- **Poster capture (play-web).** At stop, draw the preview `<video>`'s current frame into a canvas,
  480 px wide, `toBlob('image/jpeg', 0.7)`, about 20 to 40 KB (**estimate**). For a picked file, use
  a hidden `<video>` after `loadeddata`, seeked to 0.5 s. All of it fails open: an error or a timeout
  after 3 s means no poster, never a blocked submission. It uploads through the same
  `uploadTaskMedia` pipeline as a photo, at the video's path with `.poster.jpg`
  (`posterUploadPath(videoPath)`, pure). It starts right after stop, in parallel with the clip's tail,
  and at about 30 KB it adds under a second even at 300 kbps.
- **Submission.** `submitStationPhoto` gets two optional fields: `posterUrl` (validated with the same
  `requireStorageUrl(url, runId, uid, …)` as `photoUrl`, image content only) and `mediaDurationSec`
  (finite, 0 < x ≤ ceiling + 5, else dropped). They are stored beside `photoUrl` on the task record
  and the feed item. The client **omits** them when absent (the CLAUDE.md `undefined`→`null`
  transport trap). The server treats `null` as absent too, because a `null` from an older client must
  not refuse a submission.
- **Rendering (creator-web).** In all four places: `poster={posterUrl}`,
  `preload={posterUrl ? 'none' : 'metadata'}`, and a small duration badge from `mediaDurationSec`
  (MediaRecorder output often has no up-front duration, see D4). A clip without a poster keeps today's
  behaviour exactly, so old runs do not regress.
- **Edge caching.** `/uploads/*` is already `immutable` for a year (`mediaServing.js:307`) and
  Cloudflare caches `mp4`/`webm`/`jpg` by extension by default
  ([Cloudflare default cache behaviour](https://developers.cloudflare.com/cache/concepts/default-cache-behavior)),
  so a second viewer is an edge hit. **Risk, not a decision:** Cloudflare's terms restrict serving
  video that is not hosted on a Cloudflare product through the Free-plan CDN, and it may act when a
  site serves "a disproportionate amount" of it
  ([Delivering videos with Cloudflare](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/),
  [2023 ToS update](https://blog.cloudflare.com/updated-tos)). At a few GB per run this is unlikely to
  be enforced. Posters (D7) and smaller clips (D1) reduce video egress anyway, and R2 (D10) is
  explicitly allowed. This goes into DEPLOY notes rather than code.

### D8. Progressive download, not HLS

HLS or DASH exists for long content and bitrate switching. A 5 to 60 s clip of 3 to 8 MB fits in one
or two range requests, and the route already answers `Accept-Ranges`/206 correctly
(`media-serving-correctness`). Packaging HLS would need server transcoding (D9-scale CPU) for no
gain the reviewer would notice. Faststart matters only for MP4 with `moov` at the end. MediaRecorder
MP4 is fragmented (an `moov` init segment first). A native-camera `.mov` may carry `moov` last, and
Chrome then range-fetches the tail, which our 206 support already serves.

### D9. Server copy-remux only on evidence (stage 4)

`ffmpeg -i in.webm -c copy -cues_to_front 1 out.webm` (or `-movflags +faststart` for MP4) rebuilds
duration and the seek index without re-encoding ([addpipe](https://blog.addpipe.com/duration-in-webm-videos-produced-by-chrome/)).
It is cheap but not free: a child process per clip, an ffmpeg binary in the image, and it must finish
**before** the URL is returned. The URL is `immutable` and edge-cached, so rewriting bytes after the
fact would let one range request read version A and the next read version B. Gate: do it only if,
after D7, reviewers still cannot seek or see duration on real clips (task 10.1). If adopted: a
concurrency of 1, a 3 s timeout, serve the raw file on timeout.

### D10. Direct-to-object-storage: the scale-out path, with a trigger

Presigned or direct uploads (S3 or R2 multipart, GCS resumable, Cloudflare Stream "direct creator
uploads" over tus, [Cloudflare Stream tus](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/))
keep video bytes off the application server entirely. That is how every large product does it.
R2's free tier is 10 GB-month storage, 1 M class A and 10 M class B operations, with no egress fees
([Cloudflare R2](https://www.cloudflare.com/products/r2/)), and R2-hosted video is allowed on the
CDN. It is **not** chosen now, because it:
- reintroduces a billed account, which is the exact surprise-billing vector the VPS move removed
  (`server.js:3-7`);
- changes the media origin, which touches `RUSHPOINT_UPLOAD_ORIGINS`, the accept-set and the
  "never silently delete a stored URL" lesson (`task-media-durability`);
- needs retention (`run-media-disk-retention`), account deletion and game purge to reach a second
  store.

**Trigger** to open that change: the per-minute telemetry (D6.3) shows event-loop p99 above 100 ms
during upload peaks, or peak upload ingress above 30% of the port, or disk-floor refusals in a real
run, or Cloudflare flags the zone for video.

---

## Risks

- **Lower picture quality (D1).** Mitigated by a one-place constant, a device check (task 0.2) and
  the owner's explicit go-ahead. Revert is a one-line change.
- **H.264 surprises (D3).** Bitrate not honoured, or fMP4 quirks. It ships only after the device
  check, and the constant falls back to WebM.
- **Timeslice files (D4).** No Duration/Cues. Mitigated by `mediaDurationSec` (D7) and, if needed,
  D9. WebKit keeps timeslice off until verified.
- **Session route state (D4).** Single-process assumption, disk sidecars. It carries the same warning
  as the doc cache, is swept after 1 h, and has a per-uid cap.
- **Data spent on retakes (D4).** One take's worth at most. It is the same trade-off
  `media-upload-reliability` accepted.
- **ETA wrong at the start (D5).** It is shown as a range, it narrows as data arrives, it goes blank
  during a stall, and the priors are pessimistic by design.
- **`507`/`503` read as a failure by an older client.** Both are 5xx and already retried. The
  message the player sees stays "the network is slow, retrying".
- **Cloudflare video policy (D7).** Documented, low likelihood at our volume, exit path D10.

## Test strategy (repo TDD lanes)

**Pure lane (`npm test`, `scripts/test-*.ts`, no emulator):**
- `scripts/test-upload-eta.ts` (new): `uplinkPrior` layer order (recent fresh, recent stale,
  recent too small, each `effectiveType`, `saveData`, `downlink` over the 10 cap, garbage, missing ⇒
  default). `meterUpdate` warm-up discard, EWMA half-life (one 3 s step moves halfway), restart on a
  backwards `loaded`. `estimateUploadEta`: the D5 worked example to ±1 s, `low ≤ mid ≤ high`, the
  band narrows as `fractionDone` rises, `stalled` after 5 s of no progress, `almost-done` at 97%,
  cap 900 s, NaN/negative/Infinity totality (seeded fuzz like the property lane). `etaLabel`:
  bucket table, hysteresis (no flip without the 2 s hold, an upward move needs +30%), `range` only
  when the ratio is above 2.
- `scripts/test-video-capture.ts` (extend): new constants; 540p default; the light profile is
  360p; `predictedClipBytesFor` for both profiles; a ceiling clip for both profiles fits
  `MAX_PARTICIPANT_VIDEO_BYTES` with ≥ 50% headroom; the old 720p assertion is replaced, with a
  comment pointing here; still no `exact`; the mime preference order constant; and
  `recorderTimesliceFor` is off for WebKit.
- `scripts/test-poster-path.ts` (new): `posterUploadPath` swaps any extension for `.poster.jpg`, stays
  inside the same folder, total on odd input.
- A source guard in `scripts/test-video-recorder-guards.ts`: every `<video` in creator-web media
  panels passes `poster` and chooses `preload` from it (the grep style the repo already uses for
  `lazyWithRetry`).

**Server lane (vitest in `functions/`, real HTTP on a bare express app, as
`functions/uploadRoute.test.ts` and `scripts/test-uploads-route.ts` already do; the emulator does not
serve `/upload`):**
- `uploadRoute.test.ts` (extend): the 65th concurrent stream gets `503` + `Retry-After`, a third
  stream from one uid gets `503`, and slots are released after success, failure and abort. The disk
  floor yields `507` + an `outcome:'disk-floor'` log line (with `statfs` injected).
- `functions/uploadSessionRoute.test.ts` (new): create validates path, type, IDOR and cap exactly like
  PUT (table shared with the PUT tests); PATCH appends; a wrong offset gives `409` + the true offset;
  a mid-stream abort keeps the bytes and `HEAD` reports them; a resumed PATCH completes and the file is
  byte-identical to the source; the cumulative cap trips across PATCHes; a concurrent PATCH gets
  `409`; another uid's HEAD/PATCH/DELETE gets `403`; DELETE removes temp + sidecar; the sweep removes
  stale sessions; the final URL shape equals PUT's.
- `scripts/test-range-request.ts` / `test-media-content-type.ts`: unchanged and still green after the
  async-fs rewrite (a behavioural no-op).

**Callable lane (`scripts/e2e-verify.mjs`, `npm run e2e`):** extend the video-submission scenario.
`submitStationPhoto` with a valid `posterUrl` + `mediaDurationSec` stores both on the task record and
the feed item; a `posterUrl` in another team's folder is refused `invalid-argument`; `null` for either
field is accepted as absent; an out-of-range duration is dropped, not refused. No new callable, so the
coverage guard is unaffected. Neither field is a `Task` field, so `ALLOWED_TASK_KEYS` does not change.

**UI lane (preview tools, DevTools throttling):** "Slow 3G" and a custom 1 Mbps-up profile. Record
20 s: the review screen shows an ETA range. The upload shows percent + ETA, the ETA narrows, and it
goes to "waiting for signal" when the network is cut for 10 s and resumes afterwards. In stage 3,
throttled to 2 Mbps up: the network panel shows PATCHes during recording and one short PATCH after
stop. The Run Console queue with 10 clips shows posters and makes no `/uploads/*.webm` requests until
play. `npm run i18n:check:strict` is clean.

**Post-deploy:** read the `upload` and `uploads` log lines from the next real run (p50/p95 ms by size
band, failures, peak in-flight, loop p99). Record them in tasks.md. This checks D1's saving, calibrates
D5's constants and decides D9/D10.
