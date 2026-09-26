# Design: background-media-upload

## D1. Two phases, the server decides

`submitStationPhoto({ mediaDeferred: true, contentType, mediaDurationSec? })`, no `photoUrl`.

- The approval decision is the existing one, unchanged: `smart.autoApprove`, else the run's
  `autoApproveAllMedia`, then the clip length rule (`autoApproveLengthVerdict`). The length is
  known on the phone before the upload, so the rule works without the file.
- Not approved ⇒ `{ submitted: false, deferred: false, autoApproved: false, lengthHold? }` and NO
  write. The phone uploads and submits the ordinary way; nothing about the review path changes.
- Approved ⇒ the submission is written `{ status: 'approved', mediaPending: true, mediaKind,
  submittedBy, submittedAt, mediaDurationSec? }` without `photoUrl`, the task completes through
  `completeTaskForTeam` exactly as today, and `feedPending: true` is stored when the feed would
  have received the item. Returns `{ submitted: true, autoApproved: true, deferred: true }`.
- Every guard that runs today still runs first (team held, IDOR, stage active, schedule gate,
  content type against the capture kind, already completed ⇒ idempotent `already`).

## D2. `attachSubmissionMedia`

`{ ownerUid, gameId, runId, taskId, photoUrl, contentType?, posterUrl? }`.

- `requireAuth`, rate limited, the caller's team via `resolveCallerTeam(requireController:false)`.
- `photoUrl` and `posterUrl` obey the same folder rule as a submission (`requireStorageUrl`, this
  run, the CALLER's folder).
- The submission must exist; its `submittedBy.uid` must be the caller (only that phone holds the
  file, and the folder rule already ties the URL to the caller).
- `contentType` is checked against the stored `mediaKind`.
- Inside a transaction: when `mediaPending` is set, write `photoUrl` (+ `posterUrl` for a video)
  and delete `mediaPending` and `feedPending`. When it is not set, return `{ attached: false,
  already: true }` and write nothing (a retry after a lost reply must not move the file).
- After commit, and only when this call cleared `feedPending` and the submission is still
  `approved`, write the feed item. An organizer who reversed the approval meanwhile still gets
  the file attached (it is evidence) but no feed post.

## D3. The phone's background queue

`apps/play-web/src/lib/backgroundMedia.ts`, framework free, dependencies injected
(upload, attach, store, sleep, now). A job is `{ id, ctx, taskId, kind, contentType, blob,
durationSec?, createdAt }`. The first attempt may reuse the capture-time upload already in
flight (`firstTry`), so no byte is sent twice; later attempts upload from the blob.

- Retryable failures back off 5 s, 10 s, 20 s, 40 s, then every 60 s, forever, sleeping while the
  tab is hidden. Permanent refusals (folder refused, invalid argument, permission denied, not
  found, failed precondition) drop the job and count it as failed.
- The store is IndexedDB (`rp-bg-media`); a failure to open it degrades to memory only. Jobs are
  written before the approval call returns to the UI and deleted on success or a permanent
  refusal. On start the stored jobs are resumed.
- The UI subscribes to `{ pending, failed }`: a quiet pill while anything is pending, a
  `beforeunload` prompt, and one visible notice if a job was refused for good.

`PendingUploads.handOff(taskId, blob, contentType)` returns the in-flight promise and forgets the
entry WITHOUT aborting it; `forget` would abort the transfer the queue now owns.

## D4. Console

`photoQueue` rows carry `mediaPending`. The media gallery and the team page render a "still
uploading" tile for such a row. The review queue never sees one (it lists pending status only,
and these are approved).

## Test strategy

- e2e scenario "deferred media" (callable behaviour): approve + advance with no file, no feed
  item yet; not-approved task and out-of-range clip answer `deferred:false` and write nothing;
  attach refuses another folder, a wrong content type and another phone; attach fills the url and
  posts the feed item once; a repeat attach is `already`.
- `scripts/test-background-media.ts`: the queue (first try reuse, retry and backoff, permanent
  drop, restore from store, counts, store failure degrades).
- `scripts/test-pending-upload.ts`: `handOff` does not abort.
- `scripts/test-photo-queue` style assertion that a `mediaPending` row is carried.
- Browser: an auto-approved photo and video routes on at once, the file lands, the console shows
  it; a reload mid-upload resumes.
