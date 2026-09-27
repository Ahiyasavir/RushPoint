## Why

Participant video in the 2026-09-10 run was slow to record, slow to upload and slow to
review. Clips were 6.9 to 14.7MB each, 68MB across 15 submissions, and player feedback
was *"the videos do not work well"*.

The read path is already fixed (`media-serving-correctness`: correct content type,
`Accept-Ranges`, `206`). What remains is the capture path, and it has a specific,
self-inflicted problem:

**The recorder pins the bitrate but never constrains the resolution.**

```js
getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: true })
new MediaRecorder(stream, { videoBitsPerSecond: 2_000_000, ... })
```

There is no `width`, no `height` and no `frameRate`. The browser therefore captures at
the camera's own default — 1080p on essentially every modern phone, higher on many —
and then encodes that at a fixed 2 Mbps. That is the worst of both worlds:

- **2 Mbps is under-provisioned for 1080p.** The bit budget is spread across four times
  the pixels of 720p, so the clip looks blocky at exactly the bitrate that would look
  clean at a smaller frame. The player films something and it comes back mushy.
- **Encoding 1080p is CPU-expensive**, and browser `MediaRecorder` on Android commonly
  encodes VP8/VP9 in software. That is the phone getting hot, frames being dropped, and
  the pause between "stop" and "here is your clip" — the part that reads as "not
  smooth".
- **And the file is still large**, because size is bitrate times duration regardless of
  how the bits were spent. A ceiling-length clip is ~15.7MB by the module's own
  arithmetic, and every one of those megabytes crosses a field data connection twice.

A second, sharper failure sits beside it. A clip picked from the phone's **native
camera app** is checked against a 20MB ceiling and refused with *"that video is too
large, film a shorter clip"*. A native camera at 4K60 produces roughly 400MB per
minute, so a **ten second** clip can exceed the cap — and the advice given is to film
shorter, which at that resolution will not help. The player is told to do something
that cannot work.

## What Changes

- **The in-app recorder asks for a resolution it can encode well.** Capture is
  constrained to a 720p-class frame at a normal frame rate, requested as a preference
  so a device that cannot provide it still yields a working camera rather than an error.
- **The bit budget is matched to that frame**, so a clip looks better than it does
  today while being smaller and cheaper to produce.
- **The clip-size ceiling stays derivable arithmetic**, with more headroom than before,
  not less.
- **A clip that is too large says something the player can act on.** Where the in-app
  recorder is available, it is offered as the route that works, instead of advice that
  cannot help at the resolution the clip was filmed at.

**BREAKING**: none. No stored shape, no callable, no server change. Existing clips are
untouched; only newly recorded ones change.

## Capabilities

### New Capabilities
- `video-capture-profile`: what the participant recorder asks the camera for, and how
  the resulting clip size is bounded.

## Impact

- **Surfaces**: `apps/play-web` only — `lib/videoCapture.ts` (the pure profile),
  `components/TaskRunner.tsx` (apply it to `getUserMedia` and `MediaRecorder`), and one
  piece of copy.
- **No server change, no callable, no Firestore shape, no rules, no env var.**
  `MAX_PARTICIPANT_VIDEO_BYTES` is unchanged; this change only makes it easier to stay
  under.
- **Test lanes**: the existing `scripts/test-video-capture.ts` gains the profile's
  arithmetic; no emulator involvement, so `npm run e2e` is unaffected.
- **Deployment**: `deploy:hosting` for the participant app.

## Non-goals

- **Transcoding or compressing a clip in the browser.** In-browser re-encoding is slow,
  memory-hungry and unreliable across the webviews this product actually runs in, and
  it would attack the same problem from the most expensive possible angle. Recording
  the right size in the first place is cheaper than fixing the wrong size afterwards.
- **Resumable or chunked upload.** That is flaky-connectivity work and belongs with
  `offline-outbox`.
- **Server-generated poster thumbnails.** The review queue already uses
  `preload="metadata"`, which only became genuinely cheap once `Accept-Ranges` shipped;
  whether a poster is still worth it should be measured after that lands, not assumed.
- **Raising or lowering `MAX_PARTICIPANT_VIDEO_BYTES`.**
- **Anything about the audio recorder**, whose bitrate is already appropriate.
