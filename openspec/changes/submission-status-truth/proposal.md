## Why

Field report 2026-09-25: *"images and videos still get stuck in the middle … the player needs
feedback from the app about where they are"*, and *"on one phone the button was simply grey and it
could not upload"*.

Reproduced in the real app on 2026-09-25 (local emulator, 375×812, a photo mission that needs
organizer approval). Three defects, all in `apps/play-web/src/components/TaskRunner.tsx`:

1. **A fake upload bar after a successful submit.** Six seconds after the upload finished and
   `submitStationPhoto` returned `pending`, the screen showed, at the same time:
   `"הוגש. ממתין לאישור."`, a progress bar reading `"מתחיל להעלות…"`, a primary button stuck on
   `"עובד…"` and a disabled "retake". Cause: `frozen = busy || readOnly || sentFor === task.id`
   (`TaskRunner.tsx:408`) is passed into every entry as `busy`, and `UploadProgress` renders whenever
   `busy` is true (`TaskRunner.tsx:2031`) with `pct === null`, i.e. the "starting upload" copy. A
   pending review can last minutes, so for minutes the app says it is uploading. This **is** the
   "stuck in the middle".
2. **A rejection the player cannot answer.** With the organizer's rejection on screen (the card
   reads *"נסו שוב ושלחו משהו אחר"*), "retake" stayed disabled and the button stayed on
   `"עובד…"`. `sentFor` is cleared only when the assigned task id changes (`TaskRunner.tsx:302`); a
   rejection keeps the same task id, so the latch never clears and the only escape is reloading the
   app. This is one of the three causes of "the button was grey".
3. **A pending submission vanishes on reload.** After a reload the same team saw an empty mission
   (`"צלמו תמונה"` / `"שלח תמונה"`) with no trace of the submission waiting for approval. The
   "waiting for approval" line only ever lived in local `msg` state; the server's
   `taskSubmissions[taskId].status === 'pending'` is read by nothing on the participant side
   (`lib/submissionVerdict.ts` only understands `rejected`). So players re-send. Production agrees:
   the VPS upload directory holds the SAME 6,775.4 KB `.webm` uploaded five times within 50 seconds
   for one mission (run `ijI9JMITSf8C9heN1Cwp`), and several photos uploaded three times each.

## What Changes

- The participant sees ONE status line per media mission, derived from real facts only:
  `preparing` (compressing / finalising the clip), `uploading` with a real percentage,
  `retrying` (slow network), `saving` (the submit call), `waitingForApproval` (with the time it was
  sent), `approved`, `rejected` (with the organizer's note) or `failed` (with a retry). No phase is
  shown that the system does not perform.
- The upload bar renders only while bytes are actually in flight.
- A submission waiting for approval is shown from the SERVER'S record, so it survives a reload,
  a reconnect or a second phone opening the team.
- A rejection re-opens the mission's controls immediately; the previous capture stays available to
  re-send or replace.
- While waiting for approval the player is told what they can do: wait, message the organizer, or
  replace the submission (replacing re-submits and resets the wait).

## Non-goals

- Making uploads faster or resumable (`media-upload-reliability`).
- The non-controller phone's state (`team-phones-simple`), except that it inherits the honest
  status line and no longer renders a fake upload bar.
- Changing who approves or auto-approval policy.
- Showing phases the platform does not perform (transcription, image analysis).

## Surfaces

- play-web only: `components/TaskRunner.tsx`, a new pure `lib/submissionStatus.ts`,
  `lib/submissionVerdict.ts`, `i18n.ts`.
- No callable changes: `taskSubmissions` already reaches the participant through the sanitizer
  allow-list (verified: the rejection card reads it today). No rules change, no new reads or writes.
