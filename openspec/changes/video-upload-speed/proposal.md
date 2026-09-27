## Why

The product owner, after `media-upload-reliability` shipped:

> "Figure out how videos can upload faster, even with the improvement you just made, WITHOUT making
> the server crash under load. I want videos to upload as fast as possible and to load fast in the
> organizer's dashboard. I also want the player to see an estimated time for the upload (based on
> the clip's length, with some account of their connection). All of this should be based on deep
> research into how other places do this."

`media-upload-reliability` made the upload start at capture, stopped killing slow uploads and made a
server stall retryable. What it did not change is the arithmetic every clip is subject to:

    upload time ≈ clip bytes / the phone's uplink, plus one full re-send per failure

1. **Clip bytes are high for what the clip is for.** The recorder encodes 1280x720 at 1.5 Mbps video
   + 96 kbps audio (`apps/play-web/src/lib/videoCapture.ts:31-50`): a default 40 s clip is 7.98 MB,
   a 60 s ceiling clip 11.97 MB. The organizer watches it to judge "did the team do the mission".
   Apple's own HLS authoring spec makes 640x360 at 730 kbps the default rung for cellular playback
   and WhatsApp sends ordinary videos at about 480x848. We send more bits than both.
2. **Nothing is sent while the player is filming.** The upload starts only after "stop"
   (`pendingUpload.ts`). The uplink sits idle for the whole recording. Loom's approach is to stream
   the recording to the cloud while it is being made, so it is already there when recording stops.
3. **A failure still costs the whole file again.** `uploadViaVps` is one `PUT` of the whole blob
   (`apps/play-web/src/services/firebase.ts:200-292`). A retry starts from byte zero, up to 3 times
   (`UPLOAD_ATTEMPTS`, `firebase.ts:189`). tus, Google Cloud Storage, S3 and Cloudflare Stream all
   solve this the same way: ask the server how many bytes it has, then send the rest.
4. **The player gets a percentage but no time.** `UploadProgress` (`TaskRunner.tsx:2176`) shows
   "uploading… 42%", which says nothing about whether to wait 10 seconds or 5 minutes. Before the
   upload starts there is nothing at all.
5. **The dashboard pulls video to draw a thumbnail.** Every clip tile in the Run Console
   (`RunConsolePage.tsx:2864`, `:3082`, `:3175`, `TeamPage.tsx:125`) is a `<video preload="metadata">`,
   so opening the photo queue or gallery makes one or more range requests per clip before anyone
   presses play. MediaRecorder WebM and fragmented MP4 have no up-front duration, which makes that
   worse (Chromium issue 642012, still open).
6. **The server has no global brake.** The upload route streams to disk with bounded memory
   (`stream-upload-write`), but nothing caps how many uploads run at once, nothing refuses an upload
   when the disk is nearly full (one 116 GB volume, already 61% used, per
   `docker-compose.api.yml:15-22`), and the media GET route does synchronous `fs` calls on the event
   loop that also serves every gameplay callable (`functions/mediaServing.js:268-291`).

## What Changes

In order of value per unit of work. Stages 1 to 3 are the change, stage 4 depends on measurements.

**Stage 1: fewer bytes, an honest ETA, a server brake (no protocol change)**
- The recorder's default profile becomes 960x540 at 1.0 Mbps video + 64 kbps audio, and the weak-link
  profile 640x360 at 600 kbps + 48 kbps. A 40 s clip goes from 7.98 MB to 5.32 MB (-33%); on a weak
  link from 5.48 MB to 3.24 MB (-41%). Upload time falls by the same fraction on every connection.
- The recorder prefers H.264 in MP4 where the browser offers it (Chrome 126+), after checking on real
  Android devices. The expected gains are lower encoder CPU and clips that every organizer browser
  can play. Otherwise it stays on VP8 WebM as today.
- The player sees an estimated sending time, given as a rounded range ("about 30 seconds",
  "1 to 2 minutes"). Before the upload starts it comes from the clip's length × the capture bitrate
  and the best available connection estimate. During the upload it comes from the throughput
  actually measured.
- The upload route gets a global and a per-uploader concurrency cap (a retryable `503` +
  `Retry-After` once full) and refuses new uploads when free disk falls below a floor. The media GET
  route stops doing synchronous `fs` work on the event loop.

**Stage 2: the dashboard loads posters, not video**
- When a clip is recorded (or picked), the phone draws one frame into a small JPEG poster (about
  20 to 40 KB) and uploads it next to the clip. `submitStationPhoto` accepts an optional `posterUrl`
  (and the recorder-measured `mediaDurationSec`), validated like `photoUrl`.
- Run Console and team page render `<video poster preload="none">` when a poster exists. A clip then
  costs zero video bytes until the organizer presses play. Without a poster it stays on
  `preload="metadata"` as today.

**Stage 3: send while filming, resume instead of restart**
- A small resumable-upload session protocol on the VPS: a tus 1.0 subset (create, `HEAD` for the
  offset, `PATCH` append, `DELETE`). It reuses the route's existing auth, IDOR, content-type and cap
  checks.
- The recorder emits a chunk every few seconds (`MediaRecorder.start(timeslice)`). Each chunk is
  appended to the session while the player is still filming, so after "stop" only the last few
  seconds of media are left to send.
- A failed transfer asks the server for its offset and sends only the rest, for recorded clips and
  picked files alike. A retake deletes its session.

**Stage 4 (only if the measurements call for it)**
- Server-side copy-remux (`ffmpeg -c copy`: cues or faststart moved to the front, no re-encode) if
  duration or seeking is still poor in the dashboard after stage 2.
- Direct-to-object-storage (for example Cloudflare R2 with presigned multipart URLs), so video bytes
  never cross the VPS. This is the scale-out path. The trigger and the costs are in design D10.

## Non-goals

- In-browser transcoding (ffmpeg.wasm or a WebCodecs re-encode) of a clip the recorder already
  encoded. Recording at the right bitrate costs nothing. Re-encoding runs 10 to 50× slower than
  native, loads a large wasm or codec path onto a hot phone, and needs WebCodecs, which iOS has in
  full only from Safari 26. The one exception to consider later is a large file picked from the
  camera roll (design D2).
- HLS or any adaptive streaming for the dashboard. Clips are 5 to 60 s and 3 to 8 MB. Progressive
  playback with range requests, which already works, is the right tool (design D8).
- Changing `MAX_PARTICIPANT_VIDEO_BYTES` or the 60 s ceiling. Both still hold. Smaller clips only add
  headroom.
- Moving media off the VPS in this change (stage 4 is a separate decision).
- Photos and audio. They benefit from the server brake and from resume, but no profile changes.

## Surfaces

- play-web: `lib/videoCapture.ts` (profiles, mime preference, predicted bytes), new pure
  `lib/uploadEta.ts`, `lib/uploadResiliency.ts` (progress store carries bytes and time),
  `services/firebase.ts` (uplink sample, session transport), `components/TaskRunner.tsx`
  (`VideoEntry` timeslice + poster, `UploadProgress` ETA line), `lib/pendingUpload.ts` (session
  lifetime), `i18n.ts` (he/en).
- creator-web: `pages/RunConsolePage.tsx`, `components/TeamPage.tsx` (poster + preload), data
  mapping for `posterUrl`/`mediaDurationSec`.
- functions (callable): `submitStationPhoto` in `functions/src/index.ts` accepts two optional fields
  (stage 2). One callable changes shape. It is covered in `scripts/e2e-verify.mjs`.
- VPS API (not callables): `functions/uploadRoute.js` (caps, disk floor), new
  `functions/uploadSessionRoute.js` (stage 3), `functions/mediaServing.js` (async fs),
  `functions/server.js` (mounting, CORS preflight for the new verbs), `Caddyfile.api` (the new
  paths reach the API, `max_size` still covers them). Ships by VPS rebuild, before hosting.
- No Firestore rule or index change. `storage.rules` unchanged (the emulator path keeps Firebase
  Storage's own resumable upload).
