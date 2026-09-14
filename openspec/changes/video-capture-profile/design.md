## Context

`apps/play-web/src/components/TaskRunner.tsx` opened the camera with:

```js
getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: true })
new MediaRecorder(stream, { videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 96_000 })
```

No `width`, no `height`, no `frameRate`. `apps/play-web/src/lib/videoCapture.ts` carried
the size arithmetic in a comment: *"(2_000_000 + 96_000) bits/s x 60s / 8 ≈ 15.7MB
against a 20MB cap"*.

The read path was fixed separately (`media-serving-correctness`). This is the capture
path.

## Goals / Non-Goals

**Goals:** a clip that is smaller, better looking and cheaper for the phone to produce;
the size ceiling asserted rather than commented; advice on an oversized clip that can
actually work.

**Non-Goals:** in-browser transcoding, resumable upload, poster thumbnails, changing
the upload cap, the audio recorder. See `proposal.md`.

## Decisions

### D1 — Constrain the frame, then size the bits to it

720p at 30fps, requested as `ideal`.

The two levers interact, which is why they move together. 2 Mbps spread over 1080p is
about 1.0 bits per pixel per second; the same 2 Mbps over 720p is about 2.9. So the old
configuration was simultaneously **starving** the encoder of bits AND **overworking**
it — and browser `MediaRecorder` on Android commonly encodes VP8/VP9 in software, which
is where the heat, the dropped frames and the pause after "stop" come from.

At 720p30, 1.5 Mbps is a visibly better picture than 2 Mbps at 1080p, and 25% smaller.

**Ceiling-length clip: 11.4MB, down from 15.0MB.** More headroom under the 20MB cap
than before, not less.

### D2 — Every constraint is `ideal`, never `exact`

An `exact` constraint a camera cannot satisfy throws `OverconstrainedError` and the
player gets **no camera at all** — a harder failure than the one being fixed. A device
that ignores the preference still records; it simply records what it would have
recorded before.

This is asserted by scanning the serialized constraint object for `"exact"`, so the
rule cannot be broken by a later edit that looks reasonable in isolation.

### D3 — The size arithmetic becomes a function, because a comment cannot fail

`predictedClipBytes(seconds)` replaces the comment, and the test asserts against the
real cap **and** against the previous budget: a future bitrate change cannot silently
push a ceiling-length clip past the upload limit, and cannot quietly reduce the
headroom this change bought.

Total by the same rule as everything else on the participant path: a garbage duration
yields 0, not `NaN`. It feeds an estimate, never a refusal.

### D4 — "Film a shorter clip" is only true where it is true

The in-app recorder's output is bounded by the pinned bitrate, so on THAT path the
length advice is correct and stays.

On the **picked native-camera** path it is not. A phone camera at 4K60 produces roughly
400MB per minute, so a ten-second clip can exceed a 20MB cap — and filming shorter at
that resolution will not bring it under. The player is told to do something that cannot
work, with no hint that their camera's resolution is the reason.

So that path now points at the in-app recorder, which cannot produce a file that size.
It falls back to the length advice only when the recorder is `unsupported` on this
device, because then length genuinely is the only lever the player has.

## Test Strategy

**Pure — `npm test`, `scripts/test-video-capture.ts`:** the profile declares bounded
width, height and frame rate; the serialized constraints contain `ideal` and contain no
`exact`; the rear-camera preference survived; the frame is 720p class at 30fps; a
ceiling-length clip fits under the cap; **headroom is not reduced versus the previous
budget** and is genuinely smaller; the default max length fits; the client cap mirrors
the server cap; and `predictedClipBytes` is total.

**i18n:** one new participant string in both languages, `i18n:check:strict`.

**Not e2e:** no callable, no server file and no stored shape changes. Stated so the
omission reads as a decision.

**Deliberately not asserted here:** that a real phone honours the preference. That is a
device behaviour no unit test can know, which is exactly why D2 makes the constraint a
preference rather than a requirement — the failure mode of a camera ignoring us is
today's behaviour, not a broken recorder.

## Risks / Trade-offs

- **[A creator who wanted 1080p footage]** → nobody asked for one. Clips are reviewed
  on a phone or in a small console tile; 720p is more than that surface resolves, and
  the current 1080p output is visibly worse because of the bitrate split.
- **[A camera that ignores the constraint]** → records exactly as it does today. The
  bitrate drop still applies, so the file is still smaller.
- **[The bitrate drop is perceptible on a large screen]** → possible at 1080p output on
  a device that ignored the frame constraint. Accepted: the common case improves and
  the uncommon case is no worse than the size it replaces.

## Migration Plan

Land, `npm run verify` green, ship by `deploy:hosting`. Existing clips are untouched —
this changes only what is recorded from now on. **Rollback:** revert; no stored shape.

## Open Questions

1. **Is a poster thumbnail still worth it for the review queue?** The queue already
   uses `preload="metadata"`, which could not work before `Accept-Ranges` shipped —
   the browser had no way to ask for just the header, so it fetched whole multi-megabyte
   objects. It should now be cheap. Whether a poster adds anything on top should be
   MEASURED after that deploys, not assumed.
2. **Should the creator be able to choose a quality tier per mission?** A monument
   close-up and a team dance have different needs. Not worth a control until someone
   asks.
