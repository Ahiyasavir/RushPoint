## 1. RED

- [ ] 1.1 `scripts/test-media-resend.ts`: `isMediaHash` (64 lowercase hex only), `resendVerdict`
  (no hash or junk ⇒ `new`; counted once ⇒ `rejectedOnce`; twice or more ⇒ `rejectedTwice`); the
  photo screen makes retake primary on a rejected photo, asks before resending it, and sends the hash.
- [ ] 1.2 `scripts/e2e-verify.mjs`: a rejected photo's hash is counted; sending it again is accepted
  once; after a second rejection it is `failed-precondition`; a different hash is accepted; a junk
  hash is ignored, never refused.

## 2. GREEN

- [ ] 2.1 shared `mediaResend.ts`.
- [ ] 2.2 `submitStationPhoto` stores `mediaHash` and refuses a twice-rejected one;
  `reviewStationSubmission` counts the rejected hash.
- [ ] 2.3 play-web: hash at capture, send it, retake primary, confirm before a resend, refusal copy.

## 3. Verify

- [ ] 3.1 Browser at 375px: reject, see retake first, resend the same photo (warning), reject again,
  the third send is refused with a sentence.
- [ ] 3.2 Gates: `npm run verify`, `npm run e2e`.
