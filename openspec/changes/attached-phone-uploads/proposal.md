## Why

Field report 2026-09-25: *"on one phone the button was simply grey and it could not upload"*.

Found during the final research pass on 2026-09-25: **a phone that joined a team as an extra device
and then holds control cannot upload any photo, audio or video.** Every media upload from it is
refused.

The three places that decide the upload folder disagree:

| Where | Folder it uses / requires |
|---|---|
| play-web `TaskRunner.tsx:853/875/896` → `uploadTaskPhoto/Audio/Video` | `runs/{runId}/teams/{state.team.id}/…`, the TEAM id |
| VPS upload route `functions/uploadRoute.js` `ownsUploadPath` | `parts[3] === uid`, the CALLER's uid |
| `submitStationPhoto` → `requireStorageUrl` (`packages/shared/src/validation.ts:686`) | `runs/{runId}/teams/{uid}/`, the CALLER's uid |

For the founding phone `uid === teamId`, so everything agrees and it works. For an attached phone
(`joinTeamAsDevice`, then `claimController` or a hand-over), `uid !== teamId`. Proven against the
real route module:

```
founder phone (uid==teamId):                    true
second phone holding control (uid!=teamId):    false   → HTTP 403 "Cannot upload to another team folder"
```

The client maps 403 to the non-retryable `storage/unauthorized`, and `submitError` shows the generic
"upload failed". So a team that hands the phone to whoever is filming finds that the new phone
cannot submit any media mission, with no explanation. No e2e scenario covers an attached controller
submitting media, which is why every gate stayed green.

## What Changes

- A participant device uploads media into ITS OWN folder (`runs/{runId}/teams/{myUid}/`), which is
  what both server checks already require. Nothing on the server changes.
- An e2e scenario covers an attached device that takes control and submits a photo.
- A 403 from the upload route is reported to the player as "this phone is not allowed to send for
  the team", not as a generic failure, so the next occurrence of any folder mismatch is legible.

## Non-goals

- Letting non-controller phones submit (`team-phones-simple`).
- Any server, rules or path-scheme change. Existing stored media keeps its URLs.

## Surfaces

play-web only (`components/TaskRunner.tsx`, `services/firebase.ts`, `i18n.ts`) + `scripts/e2e-verify.mjs`.
