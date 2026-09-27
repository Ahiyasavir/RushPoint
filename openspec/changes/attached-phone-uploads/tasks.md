# Tasks: attached-phone-uploads

## 1. RED

- [x] 1.1 `scripts/test-participant-upload-path.ts`: `participantUploadPath` uses the uid; source guard
      that no `uploadTask*` call in `TaskRunner.tsx` passes `teamId`. Confirm RED.
- [x] 1.2 e2e scenario "attached controller submits media" (design, test strategy). Run `npm run e2e`;
      confirm it fails at the upload step with a permission error.
- [x] 1.3 Vitest `ownsUploadPath` rows (should already pass; pins behaviour).

## 2. GREEN

- [x] 2.1 `participantUploadPath` + `uploadTaskPhoto/Audio/Video` derive the folder from the signed-in uid
      (design D1); drop the `teamId` parameter and update the three call sites. 1.1, 1.2 → green.
- [x] 2.2 403 → `storage/not-your-folder` → `t.task.uploadNotAllowedHere` (he/en) (design D3).
- [x] 2.3 Verify `storage.rules` write condition (design D2): `request.auth.uid == teamId` (storage.rules:37), verified 2026-09-25 during planning.

## 3. Verify and ship

- [ ] 3.1 `npm run verify`, `npm run e2e` green (exit codes to a file).
- [ ] 3.2 Deploy play hosting from the main checkout. On two real phones: attach, hand over control,
      submit a photo and a video from the second phone.

## Progress notes (2026-09-25)

- 1.2 did not go RED: the e2e drives the Storage emulator directly, so it pins the SERVER contract
  (own folder uploads + submits, team folder refused) that the client fix relies on. The RED proof is
  1.1 (the pure path test failed on the old client). 3 new assertions pass in the full e2e run.
- 1.3 lives in `scripts/test-participant-upload-path.ts` (tsx lane) rather than vitest.
- Critical review added: a 403 counts as "not your folder" ONLY when our route's own JSON message
  says so (`isFolderRefusal`), because Cloudflare also answers 403 (geo-block, bot protection) with
  an HTML page. Tested.
- 3.1 green except the pre-existing `test-no-dashes` failure in the marketing devlog-6 post (not this change).
