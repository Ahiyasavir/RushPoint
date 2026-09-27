# Tasks: submission-status-truth

## 1. RED

- [x] 1.1 Write `scripts/test-submission-status.ts` against the not-yet-existing
      `apps/play-web/src/lib/submissionStatus.ts`: the full precedence table of design D1, garbage
      inputs (non-string status, unparsable `submittedAt`, non-object record), the
      "rejected then re-sent" ordering, the auto-approved instant. Run
      `node --import tsx scripts/test-submission-status.ts`; confirm it fails because the module is
      missing.
- [x] 1.2 In the same file add the source guard: `UploadProgress` declares no `busy` prop and no
      `<UploadProgress` call site passes `frozen`/`busy`. Confirm it fails on today's source
      (`TaskRunner.tsx:2022`, `:2208`, `:2470`, `:3014`).
- [x] 1.3 Extend the photo-review scenario in `scripts/e2e-verify.mjs`: after a rejection,
      `getMyTeamState` carries `status: 'rejected'` + the note, and a second `submitStationPhoto`
      for the same task returns `submitted: true` and leaves `status: 'pending'`. Run `npm run e2e`;
      these assertions should PASS already (behaviour exists). Record that, because the UI now
      depends on it.

## 2. GREEN

- [x] 2.1 Implement `lib/submissionStatus.ts` (design D1). Re-run 1.1 → green.
- [x] 2.2 Rewrite `UploadProgress` to render from the upload store only (design D2). Re-run 1.2 → green.
- [x] 2.3 In `TaskRunner`: derive `phase` per media mission from local flags + `state.team.taskSubmissions[task.id]`;
      delete the `sentFor` term from `frozen` (design D3); keep `begin()`/`end()`.
- [x] 2.4 Track `preparing` (compression / clip finalise) and `saving` (the submit call) as local flags
      in the three handlers `photo`, `audio`, `video`.
- [x] 2.5 Render ONE status line component from `phase` in `PhotoEntry`, `AudioEntry`, `VideoEntry`;
      remove the `showProgress(pendingReview/approved)` writes that duplicated it.
- [x] 2.6 The waiting card (design D5) with the sent media from `photoUrl`, sent time, elapsed line
      after 3 min, "message the organizer" (opens the chat tab via the existing drawer API) and
      "send a different one" (design D4).
- [x] 2.7 On `rejected`: capture controls enabled, previous capture still loaded, its cached upload url
      dropped from `capturedRef` so a re-send never silently re-submits the rejected file.
- [x] 2.8 Copy: `t.task.phase.*` in both dictionaries (he/en), no phase the system does not perform.

## 3. REFACTOR

- [ ] 3.1 Fold `submissionVerdict` into `submissionStatus` if nothing else reads it; otherwise make it a
      thin projection of the new module so there is one reading of `taskSubmissions`.
- [x] 3.2 Remove the now-dead `sentFor` state and its comments; keep the live-run 2026-09-17 note
      beside the phase gate that replaced it.

## 4. Verify

- [x] 4.1 Preview at 375×812 with a review-required photo mission: (a) after send, the waiting card,
      no progress bar, no "עובד…"; (b) after an organizer rejection, controls enabled and the note shown;
      (c) after a reload while pending, the waiting card again. Screenshot each.
- [ ] 4.2 Same three for a video mission.
- [ ] 4.3 `npm run verify` (typecheck · lint · test · both builds · bundle:budget · base:check ·
      origin:check · i18n:check:strict) and `npm run e2e`. Capture exit codes to a file, never through
      a pipe.

## Progress notes (2026-09-25)

- 4.1 verified in the running app (emulator, 375×812, review-required photo mission), all three
  reproductions of 2026-09-25 now end correctly: after send → the waiting card, no bar, no "עובד…";
  after a reload → the waiting card with the sent photo; after an organizer rejection (real callable)
  → rejection card with the note, capture and send ENABLED; retake + send → waiting again.
  A viewing phone no longer shows the fake bar or "עובד…" (its disabled capture control is the
  subject of team-phones-simple).
- 4.2 (video) NOT verified in a browser: recording needs a camera. The video path shares the phase
  logic and the waiting card; a real-phone check is owed.
- `scripts/test-photo-survives-remount.ts` was updated to pin the replacement mechanism (`justSent` +
  waiting card) with the same intent as the `sentFor` latch it replaced.
- Known limit: after a rejection a VIDEO mission reopens empty (a photo keeps the capture); a rejection
  means "film something else", so this is accepted.
- 3.1 not done: `submissionVerdict` still exists beside the new module.
