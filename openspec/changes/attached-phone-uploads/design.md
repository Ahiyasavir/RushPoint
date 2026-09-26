## Decisions

### D1: the folder is the caller's uid, decided in ONE place

`uploadTaskPhoto/Audio/Video` stop taking a `teamId`. They derive the folder from
`auth.currentUser.uid` inside `services/firebase.ts` (it already awaits `ensureAuth()`), so no call
site can pass the wrong id again. A pure `participantUploadPath({ runId, uid, taskId, ext, nowMs })`
builds the path and is shared by all three, so the scheme has one definition on the client.

Why not change the server to accept the team folder: both server checks already key on the caller,
and that is the stronger IDOR rule (a device can only ever write under its own identity). Keeping
it means zero server risk and no migration.

### D2: storage.rules parity

`storage.rules` (`match /runs/{runId}/teams/{teamId}/{allPaths=**}`) governs the emulator path.
Verified 2026-09-25: its write condition is `request.auth.uid == teamId` (`storage.rules:37`), i.e.
the folder segment must be the CALLER, so all three server-side gates already agree with D1 and none
changes.

### D3: a legible 403

`uploadViaVps` maps 403 to a distinct code `storage/not-your-folder`; `submitError` renders
`t.task.uploadNotAllowedHere`. It should never fire after D1, which is exactly why it must be
loud if it does.

## Test strategy

- Pure (`scripts/test-participant-upload-path.ts`): the path uses the uid argument; a guard over
  `TaskRunner.tsx` that no `uploadTask*` call passes `teamId`.
- e2e (`scripts/e2e-verify.mjs`, new scenario "attached controller submits media"): team joins,
  second anonymous user `joinTeamAsDevice`, `claimController`, uploads through the Storage emulator
  under ITS uid, `submitStationPhoto` succeeds; and the negative: uploading under the TEAM folder as
  that device is refused (pins the server rule D1 relies on).
- Vitest (`functions/uploadRoute.test.ts`): `ownsUploadPath` true for own uid, false for another
  team member's folder (pins current behaviour).
- Manual after deploy: two real phones, hand over control, submit a photo from the second.
