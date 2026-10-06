## Why

Ahiya, 2026-10-06 (issues 23 and 24 in docs/ISSUES-2026-10-05.md):

- After the organizers reject a photo, the big orange button on the team's phone is "send the
  photo", which sends the rejected picture again, and "retake" sits under it as a faint ghost. The
  rejection card above says "try again and send something else", and the buttons say the opposite.
- A team can send the very same picture again and again. He wants a small warning the first time
  ("this is the photo that was rejected, are you sure?"), and once he rejects that same picture a
  second time, the team cannot send it any more.

## What Changes

- **Retake comes first after a rejection.** When the photo on screen is one the organizers already
  rejected, "צלמו שוב" is the primary button and sending is the secondary one.
- **The same picture is recognised by its bytes.** The phone hashes the photo it is about to send
  (SHA-256 of the file, `crypto.subtle`) and sends `mediaHash` with `submitStationPhoto`. The server
  stores it on the submission. A rejection counts it: `taskSubmissions[taskId].rejectedHashes[hash]`.
- **Rejected once:** sending it again asks first, on the phone ("זו התמונה שהמארגנים דחו. לשלוח
  אותה שוב?"), and a second press sends.
- **Rejected twice:** the server refuses it (`failed-precondition`, `same-media-rejected-twice`) and
  the phone says so without sending.
- Fails open: no hash (an old phone, `crypto.subtle` missing, a hash that is not 64 hex characters)
  is never a refusal. A NEW photo of the same thing is a different file and is never blocked.
- Photo missions only. Video and audio keep today's behaviour.

## Capabilities

### New Capabilities
- `rejected-photo-resend`: what a team sees and may send after a photo is rejected.

## Impact

- `packages/shared/src/mediaResend.ts` (`isMediaHash`, `resendVerdict`), exported from the barrel.
- `functions/src/index.ts` (`submitStationPhoto` stores and checks `mediaHash`,
  `reviewStationSubmission` counts a rejected hash).
- play-web `TaskRunner.tsx` (`PhotoEntry`), `services/calls.ts`, i18n HE/EN.
- The participant projection already copies `taskSubmissions` whole; the hash is of the team's own
  photo, so nothing secret reaches the phone.
- Tests: `scripts/test-media-resend.ts`, `scripts/e2e-verify.mjs`.
