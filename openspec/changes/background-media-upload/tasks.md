# Tasks: background-media-upload

## 1. RED

- [x] 1.1 e2e scenario "deferred media" (design, test strategy). Confirm RED.
- [x] 1.2 `scripts/test-background-media.ts` against the missing queue. Confirm RED.
- [x] 1.3 `handOff` assertions in `scripts/test-pending-upload.ts`; `mediaPending` in the photo queue test. Confirm RED.

## 2. GREEN

- [x] 2.1 Server: `mediaDeferred` in `submitStationPhoto`; `attachSubmissionMedia` (+ export, rate
      limit, hardening lists); `run.autoApproveAllMedia` in getMyTeamState. 1.1 → green.
- [x] 2.2 `lib/backgroundMedia.ts` + IndexedDB store + `handOff`. 1.2, 1.3 → green.
- [x] 2.3 TaskRunner: photo, audio and video try the fast path when the mission or run auto
      approves; hand the upload to the queue; the pill and `beforeunload`. i18n he/en.
- [x] 2.4 Console: "still uploading" tile in the gallery and the team page. i18n he/en.

## 3. Verify

- [x] 3.1 (2026-09-26, video at a 40 KB/s uplink: next mission after 0.8 s, file + poster + feed item attached 12 s later; a reload mid upload resumed from IndexedDB and attached, without the poster, which is not stored; console team page and gallery show the "still uploading" tile, download all counts 3 of 4) Browser: photo and video route on at once, file attaches, console shows it; reload resumes.
- [x] 3.2 typecheck, lint, test, i18n strict, e2e scenario plus lifecycle.
