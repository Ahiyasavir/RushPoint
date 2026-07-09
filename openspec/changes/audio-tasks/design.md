# Design — audio-tasks

## Data model

**`SmartStationConfig.captureKind?: 'photo' | 'audio'`**
(packages/shared/src/types/index.ts, next to `autoApprove`) — default absent =
`'photo'`. Only meaningful on `type: 'photo'` tasks; ignored elsewhere. NOT secret
(the client must render the right capture widget), but the sanitizer's `smart`
object is an explicit pick-list, so it must be added there or it silently vanishes.

**Submission record** (the inline `taskSubmissions[taskId]` shape written by
`submitStationPhoto` and read by StaffConsole) gains
`mediaKind: 'photo' | 'audio'` — **server-derived from the task's `captureKind`**,
never taken from the client payload. Existing records have no `mediaKind`; readers
treat absent as `'photo'`.

## Pure gate (packages/shared/src/mediaKinds.ts — new)

```ts
export type MediaKind = 'photo' | 'audio';
export const AUDIO_CONTENT_TYPES = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg'] as const;

// 'audio/webm;codecs=opus' → 'audio/webm' (MediaRecorder blobs carry codec params).
export function normalizeContentType(ct: string): string;

// kind 'photo': accepts image/* (undefined ct allowed — legacy clients omit it).
// kind 'audio': REQUIRES ct; accepts exactly the normalized AUDIO_CONTENT_TYPES.
// Cross submissions rejected both ways (image/* on audio task, audio/* on photo task).
export function isAllowedSubmissionContentType(kind: MediaKind, contentType: string | undefined): boolean;
```

Dependency-free; exported from `@rushpoint/shared`. Tested RED-first in
`scripts/test-media-kinds.ts` (same pattern as `scripts/test-storage-url.ts`, runs
under `npm test` via the aggregator).

## Server — submitStationPhoto (functions/src/index.ts ~696)

Callable name and shape stay; payload gains `contentType?: string`. Today the only
content-type enforcement is storage.rules at upload time — the callable never sees
the type. We keep that split but add the kind gate, at **zero extra reads**: the
game snapshot already fetched for `autoApprove`/`photoFeedEnabled`/`taskTitle` also
yields `task.smart?.captureKind` (extend the inline cast).

1. Existing guards unchanged: `resolveCallerTeam` (controller), IDOR teamId check,
   `requireStorageUrl(photoUrl, runId, uid)` — audio files live under the identical
   run/team path, so the URL validator needs no change.
2. `const kind: MediaKind = task.smart?.captureKind === 'audio' ? 'audio' : 'photo';`
3. `validate(() => { if (!isAllowedSubmissionContentType(kind, contentType)) throw ... })`
   — invalid-argument. Audio tasks therefore REQUIRE a declared audio content type;
   photo tasks reject a declared audio type; a photo task with `contentType`
   omitted stays accepted (back-compat — existing play-web clients don't send it).
   The declared type is honest because storage.rules enforce the real uploaded
   `contentType` against the same allowlist (see below) and `requireStorageUrl`
   pins the URL to the caller's own folder.
4. The `taskSubmissions[taskId]` merge-write gains `mediaKind: kind`.
5. Auto-approve path: `completeTaskForTeam` unchanged; the `writeFeedItem` call is
   gated with `feedEnabled && kind !== 'audio'` (non-goal: audio never enters the
   photo feed).

## Server — reviewStationSubmission (~779)

No payload change; approval → `completeTaskForTeam` unchanged. The best-effort feed
block reads `taskSubmissions[taskId]` off the team doc already — also read its
`mediaKind` and skip `writeFeedItem` when `'audio'`.

## storage.rules

`match /runs/{runId}/teams/{teamId}/{allPaths=**}` write rule: keep the 10 MB cap;
widen `request.resource.contentType.matches('image/.*')` to
`matches('image/.*|audio/(webm|mp4|mpeg|ogg)')`. The client normalizes the blob
type before upload (strips `;codecs=opus`) so the regex stays exact-match simple.
Read rule (own team + run-scoped staff) already covers staff playback in review.

## play-web capture (TaskRunner.tsx)

The `type === 'photo'` branch (~line 276 renders `<PhotoEntry>`) switches on the
sanitized `task.smart?.captureKind`:

- `'audio'` → new **`AudioEntry`** component:
  - `navigator.mediaDevices.getUserMedia({ audio: true })` → `MediaRecorder`,
    preferring `audio/webm;codecs=opus` via `MediaRecorder.isTypeSupported`, falling
    back to `audio/mp4` (Safari); no support at all → error message.
  - Record / stop; 60 s hard cap (`setTimeout` auto-stop) with a visible countdown;
    re-record discards the blob; `<audio controls src={URL.createObjectURL(blob)}>`
    playback before submit. Static Tailwind classes; all copy via `t.*` EN+HE.
  - Client size guard mirrors `MAX_PHOTO_BYTES` (60 s opus is well under 1 MB).
- default → existing `PhotoEntry`, untouched.

Upload: generalize `uploadTaskPhoto` (apps/play-web/src/services/firebase.ts:97) —
add `uploadTaskMedia(blob, { runId, teamId, taskId, contentType })` sharing the
same path builder `runs/{runId}/teams/{teamId}/{safeTask}-{Date.now()}.{ext}`
(ext `webm`/`m4a` from the normalized type); `uploadBytes(..., { contentType })`
with the NORMALIZED type so storage.rules match. Then the existing `photo()` submit
helper calls `submitStationPhoto({ ...ctx, teamId, taskId, photoUrl: url,
contentType })` — the `services/calls.ts` wrapper type gains `contentType?: string`.
Pending/approved/rejected status flow after submit is byte-identical to photos.

## Review UI

**StaffConsole.tsx** (the only review queue — RunConsolePage has none; its feed
panel never sees audio): the flattened `PendingSubmission` row (~line 22) and the
`taskSubmissions` snapshot cast (~line 138) gain `mediaKind?: 'photo' | 'audio'`;
the render branch (~line 281) shows `<audio controls src={s.photoUrl}>` (playback
uses the tokenized download URL, which bypasses Storage read rules) when
`mediaKind === 'audio'`, else the existing `<img>`. Approve/reject buttons and
`reviewStationSubmission` call unchanged. i18n: an "audio submission" label EN+HE.

## Sanitizer (functions/src/runs/sanitizeTask.ts)

Add `captureKind: smart.captureKind` to the explicit `smart` pick-list (beside
`autoApprove`). Extend `functions/src/runs/sanitizeTask.test.ts`: `captureKind`
passes through; `secretCode`/`adminNotes` still stripped. Mirror the key into the
e2e script's `ALLOWED_SMART_KEYS` set (scripts/e2e-verify.mjs:191) — the allowlist
guard otherwise fails loud, by design.

## Builder (creator-web)

`TaskWizard.tsx` `InteractionStepBody`, inside the existing `task.type === 'photo'`
block (~line 741, beside the `autoApprove` checkbox): a two-option segmented
selector (📷 Photo / 🎙️ Audio) →
`setSmart({ verificationType: 'photo_upload', captureKind: v })` — `setSmart`
already merges into `task.smart` (repo pitfall: never write `captureKind`
top-level). Default selection Photo when absent. i18n keys
(`captureKindLabel`, `captureKindPhoto`, `captureKindAudio`, + a one-line audio
hint) EN + HE. `taskTemplates.ts`/`templates.ts` untouched (photo default).

## Test strategy

- **Pure (RED→GREEN):** `scripts/test-media-kinds.ts` — photo+image accepted,
  photo+undefined accepted (legacy), photo+audio rejected; audio+each of the four
  audio types accepted (with and without `;codecs=` params), audio+undefined
  rejected, audio+image rejected; junk strings rejected. Written and failing
  BEFORE `mediaKinds.ts` exists.
- **Sanitizer vitest:** `captureKind` survives sanitization; secrets still stripped.
- **Callable (e2e):** extend the station-photo scenario (8c) in
  `scripts/e2e-verify.mjs` — the game gains an audio task
  (`smart: { enabled, verificationType: 'photo_upload', captureKind: 'audio' }`):
  1. Sanitized payload exposes `smart.captureKind === 'audio'`
     (+ `ALLOWED_SMART_KEYS` updated so the allowlist guard stays green).
  2. Upload real audio bytes to the Storage emulator under the team's own path
     with `contentType: 'audio/webm'` (the widened storage.rules accept it);
     `submitStationPhoto` with `contentType: 'audio/webm'` → pending; assert
     `taskSubmissions[taskId].mediaKind === 'audio'`.
  3. Negatives: `contentType: 'image/jpeg'` on the audio task → invalid-argument;
     `contentType` omitted on the audio task → invalid-argument; `'audio/webm'`
     on the existing PHOTO task → invalid-argument.
  4. Staff approves via the existing `reviewStationSubmission` flow → task
     completes + points; no feed item was written for the audio submission.
  No new callable ⇒ coverage-guard list unchanged.
- **UI:** preview-verify recorder + queue rendering; `npm run i18n:check` clean
  (zero new PART B warnings — `i18n:check:strict`).

## Footguns respected

- `taskSubmissions` writes stay real nested objects under `.set({merge})` — never
  dotted keys (existing comment in `verifyStationCode` applies).
- `mediaKind` derives from the TASK config server-side; the client `contentType`
  claim is only checked for consistency, and the actual bytes are gated by
  storage.rules — no trust in client-declared kind.
- Zero extra Firestore/Storage reads in `submitStationPhoto` — the kind rides the
  already-fetched game snapshot.
- Callable name unchanged; e2e coverage guard count stable.
