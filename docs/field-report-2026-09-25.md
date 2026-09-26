# Field report 2026-09-25 → root causes → 13 OpenSpec changes

A point-in-time record. Ahiya's field report (runs of 2026-09-10 through 2026-09-22) listed ten
problems. An earlier session turned it into plans "too quickly" and those plans were never found in
this repository, so this pass rebuilt them from scratch: every item was traced to a root cause in
the code, and where possible the cause was **reproduced in the real app** (local emulator, 375px
phone viewport) or **confirmed against production data** (read-only queries on the VPS). The
evidence is quoted in each change's `proposal.md`.

## The report, item by item

| # | Reported | Root cause (short) | Evidence | Change |
|---|---|---|---|---|
| 1 | Photos and videos "get stuck in the middle"; the player needs feedback about where they are | After a successful submit the entry keeps rendering `UploadProgress` with `busy = frozen`, so a fake "מתחיל להעלות…" bar and a "עובד…" button stay on screen for as long as the organizer has not approved. After a reload the pending submission is invisible and the player sends it again | Reproduced in the app; production disk holds the same 6.7 MB clip uploaded 5 times in 50 s | `submission-status-truth` |
| 1b | Uploads take a long time | Upload starts only on "send"; a single non-resumable PUT; the per-attempt cap (180 s) kills a slow but progressing upload and restarts it from zero; a server-side stall answers `400` which the client treats as permanent | Code + production file sizes (6–14 MB clips) | `media-upload-reliability` |
| 1c | "On one phone the button was grey and it could not upload" | Four independent causes: (a) after an organizer REJECTS, the `sentFor` latch never clears, so every control stays disabled under a card saying "try again"; (b) a non-controller phone renders every control disabled plus the fake upload bar, with the explanation below the mission; (c) `openCamera` awaits `getUserMedia` with no timeout, so `opening` can stay true forever; (d) **a second phone that took control cannot upload at all**: the app uploads into the TEAM's folder, while the upload server, `requireStorageUrl` and `storage.rules` all require the CALLER's own folder, so every upload from it is refused with 403 | (a) and (b) reproduced in the app; (d) proven against the real route module (`ownsUploadPath` → false) | `submission-status-truth`, `team-phones-simple`, `media-upload-reliability`, `attached-phone-uploads` |
| 2 | No flip-camera button for video or photo | Video: the in-app viewfinder hard-codes `facingMode: environment` and has no switch. Photo: the native `capture` input cannot select a camera on Chromium/Android | Code + browser compatibility research | `camera-switch` |
| 3 | Skipping a mission skips a whole stage | `applyStageCompletion` retires every mission gated (`unlockAfterTaskIds`) behind a *skipped* mission as unreachable, including an organizer skip. In a chained stage one skip retires the chain and the stage completes | Production audit log 2026-09-22: `task_skipped` → `stageCompleted: true` | `skip-keeps-the-stage` |
| 4 | No button that returns a team to a stage or a mission | Nothing can reopen a skipped/completed mission or an earlier stage; `forceAssignTask` refuses both and exists only in the staff app | Code | `send-team-back` |
| 5 | The Run Console's section strip is not prominent; people miss it | The rail renders after the whole pinned zone | Measured: top of rail at 1,665 px on a 375×812 phone (2 of 5 tabs visible), 885 px on a 1400×860 desktop | `run-console-tabs-up-front` |
| 6 | Click a team and see everything about it (media, location, points, message…) | Team rows are not interactive; the console already streams the full team documents and discards all but two fields | Code | `team-dossier-and-search` |
| 7 | Search teams | The console has no search; the staff app does (`staffTeamFilter.ts`) | Code | `team-dossier-and-search` |
| 8 | Limit what staff can do (e.g. no scoring) | `inviteStaff` stores a `permissions` array and mints it into the token, but **no server check ever reads it**; staff can call 14 privileged callables | Code | `staff-capabilities` |
| 8b | "חיוג מהיר" | Clarified with Ahiya: BOTH a tap-to-call button and a configurable quick-actions bar | Decision 2026-09-25 | `quick-dial-and-actions` |
| 9 | Multi-phone teams: simple, fun linking, easy hand-over of who sends content | Attaching needs two codes typed by hand; the device panel is inside the "more" drawer; every submission is controller-only | Code + reproduction of the viewer state | `team-phones-simple` |
| 10 | A question whose points depend on the answer | New capability; the `smart_weighted` preset never reads `pointValue` and `time_only` ignores points, so the meaning must be defined per preset | Code | `answer-scored-question` |

## Follow-up requests (2026-09-25, same day)

- **SOS → 101**: the SOS flow must lead players to call 101 for an injury or real danger →
  `sos-points-to-101`.
- **Staff permissions, refined**: a default in the GAME settings (e.g. "staff cannot add points"),
  and in the run several staff CODES, each reusable by several people with its own permissions,
  editable and revocable → folded into `staff-capabilities`.
- **A send-back button that actually exists**: on every team row of the console and in the staff
  app, not only on the future team page → folded into `send-team-back`.
- **Points by code, the defining example**: a station operator hands a team a code, "זעתר" is worth
  50 and "מרווה" 100 → `answer-scored-question` now covers station-code missions first.

## Order of work

1. `attached-phone-uploads` (smallest; a second phone cannot upload at all today)
2. `sos-points-to-101` (safety, tiny)
3. `submission-status-truth`
4. `skip-keeps-the-stage`
5. `send-team-back` (introduces the `scoreLedger` field and its append helper if
   `team-dossier-and-search` has not landed yet; the dossier change then only reads it)
6. `media-upload-reliability` stage A
7. `staff-capabilities`
8. `team-phones-simple`
9. `camera-switch`
10. `run-console-tabs-up-front`
11. `team-dossier-and-search`
12. `quick-dial-and-actions`
13. `answer-scored-question`

Then `media-upload-reliability` stage B only if the stage A telemetry says it is needed.

## What the "phases" can honestly be

The report asked for feedback such as "transcribing video" or "analysing image". Those processes do
not exist: the server stores the file and records the submission, nothing else. The status ladder
therefore shows only real phases (preparing, uploading N%, saving, waiting for approval, approved,
rejected). Inventing phases would be the same class of lie as the fake progress bar this batch removes.
