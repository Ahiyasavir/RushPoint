## 1. Establish the defect from the code

- [x] 1.1 Confirmed `getUserMedia` asked only for `facingMode` — no `width`, no
  `height`, no `frameRate` — so the browser captured at the camera's own default.
- [x] 1.2 Confirmed `MediaRecorder` pinned 2 Mbps regardless, so the bit budget was
  spread over roughly four times the pixels of 720p.
- [x] 1.3 Confirmed the size arithmetic lived only in a COMMENT, which cannot fail.
- [x] 1.4 Confirmed the picked-file path refuses over 20MB with "film a shorter clip",
  advice that cannot work for a 4K60 native clip (~400MB per minute).
- [x] 1.5 Confirmed the review console already uses `preload="metadata"` — which could
  not work before `Accept-Ranges` shipped in `media-serving-correctness`, because the
  browser had no way to ask for just the header.

## 2. The profile — RED

- [x] 2.1 Extend `scripts/test-video-capture.ts`: the profile declares a bounded width,
  height and frame rate. Run; confirm RED because the export does not exist.
- [x] 2.2 Assert the serialized constraints contain `ideal` and contain NO `exact` — an
  `exact` a camera cannot meet throws `OverconstrainedError` and leaves the player with
  no camera at all. Still RED.
- [x] 2.3 Assert the frame is 720p class at 30fps and that the rear-camera preference
  survived. Still RED.
- [x] 2.4 Assert `predictedClipBytes` against the REAL cap, against the PREVIOUS budget
  (headroom must not shrink), and for totality. Still RED.

## 3. The profile — GREEN

- [x] 3.1 `CAPTURE_VIDEO_CONSTRAINTS`, `MAX_PARTICIPANT_VIDEO_BYTES` and
  `predictedClipBytes` in `apps/play-web/src/lib/videoCapture.ts`; bitrate 2 Mbps to
  1.5 Mbps.
- [x] 3.2 Suite green. **Ceiling-length clip 11.4MB, down from 15.0MB** — 57% of the
  cap where it used to be 75%, at a better picture.

## 4. Apply it

- [x] 4.1 `getUserMedia` takes `CAPTURE_VIDEO_CONSTRAINTS` instead of a bare
  `facingMode`.
- [x] 4.2 `MediaRecorder` keeps reading the pinned constants, which now describe a
  frame it can actually encode.
- [x] 4.3 The picked-file oversize message routes to the in-app recorder, falling back
  to the length advice only when that recorder is `unsupported` on this device.
- [x] 4.4 Hebrew and English copy for the new message.

## 5. Gates

- [x] 5.1 `npm run verify` — **299/299 pure-logic unit files green**, every build
  green, lint 0 errors. The only red gate is the pre-existing `check-marketing-output`
  failure on the untracked `_kit-b83f9d2e` kit, outside this change.
- [x] 5.2 `npm run i18n:check:strict` — PART A and PART B both clean.
- [x] 5.3 No callable, no server file and no stored shape changed, so `npm run e2e`
  is deliberately not re-run for this change. (It was run green earlier in the same
  working tree for `arrival-needs-a-usable-fix`, which DID touch the server.)

## 6. Ship

- [ ] 6.1 `deploy:hosting` for the participant app. Existing clips are untouched; only
  newly recorded ones change.
- [ ] 6.2 Post-deploy: record a ceiling-length clip on a real phone and confirm it is
  meaningfully smaller than before, that the picture is not worse, and that the phone
  does not heat the way it did.

## 7. Follow-ups filed, not built

- [ ] 7.1 MEASURE whether a poster thumbnail still helps the review queue now that
  `preload="metadata"` can actually issue a range request (design Open Question 1).
- [ ] 7.2 A per-mission quality tier, if anyone asks (design Open Question 2).
- [ ] 7.3 Resumable / chunked upload for flaky field connectivity — belongs with
  `offline-outbox`, not here.
