## Why

Creators can only give a task a text `title`/`description` today. Real field-game
tasks are far clearer with a visual: a reference photo of the spot to find, a short
demo video of the challenge, or a YouTube clip that sets up the story. There is
currently no supported way to attach general media to a task — the only media fields
(`smart.imageUrl` / `smart.mediaUrl`) live under `smart` and only apply to
`smart_station` tasks. Creators repeatedly ask to "just add a picture/video to the
task", uploaded from their computer or pasted from YouTube.

## What Changes

- Add **general, task-level media** to any `Task` (all task types), authored in the
  Builder and shown to the participant in the play-web TaskRunner **before/with** the
  task instructions — independent of the `smart` station config.
- Support two media sources per attachment:
  - **Uploaded file** (image or video) from the creator's computer → **Firebase
    Storage** → the resulting download URL is stored on the task.
  - **YouTube link** — the creator pastes a watch/share/`youtu.be` URL; we store a
    normalized reference and render an embedded player. No file is uploaded for YouTube.
- Add a small **`TaskMedia`** shape to `@rushpoint/shared` (`kind: 'image' | 'video' |
  'youtube'`, `url`, optional `caption`) and a `media?: TaskMedia[]` array on `Task`.
- Add pure, unit-tested **validation/normalization helpers** in
  `packages/shared/src/validation.ts`: `parseYouTubeId(url)` (extracts the 11-char id
  from watch / `youtu.be` / `shorts` / embed forms, else null) and `isTaskMediaValid(m)`
  (uploaded image/video URLs must be Firebase Storage URLs — reusing `isFirebaseStorageUrl`;
  youtube entries must yield a valid id). Reject anything else.
- **Server validation** on `createGame`/`updateGame`: every task's `media[]` is validated
  and normalized (YouTube entries rewritten to a canonical `youtube.com/embed/<id>` /
  stored id; bad entries rejected with `invalid-argument`) so a malicious client can't
  persist an arbitrary off-origin URL.
- **Sanitizer + allowlist**: `media` is a safe, participant-visible field — add it to the
  participant task payload (it is NOT a secret) and to the e2e `ALLOWED_TASK_KEYS` allowlist
  so the sanitizer guard doesn't fail on the new field.
- **Builder UI** (creator-web): a "Media" section in the TaskEditor to upload image/video
  files (progress + preview) or add a YouTube URL, reorder/remove entries, with a caption.
- **Play UI** (play-web): TaskRunner renders the media gallery — `<img>` for images, an
  inline `<video controls>` for uploaded video, and a lazy YouTube `<iframe>` embed.

## Capabilities

### New Capabilities
- `task-media`: attaching creator-authored image/video/YouTube media to any task —
  the data shape, validation/normalization rules, server enforcement, sanitizer
  exposure, and how it is authored (Builder) and displayed (TaskRunner).

### Modified Capabilities
- `photo-url-validation`: reuse of the existing `isFirebaseStorageUrl` helper is
  referenced but its requirements are unchanged — no delta needed. (Listed for
  traceability only; no spec edit.)

## Impact

- **Shared types** (`packages/shared/src/types/index.ts`): new `TaskMedia` interface +
  `Task.media?: TaskMedia[]`.
- **Shared validation** (`packages/shared/src/validation.ts`): new `parseYouTubeId`,
  `normalizeTaskMedia`, `isTaskMediaValid` helpers (pure, unit-tested).
- **Callables** (no NEW callable): `createGame`/`updateGame` in `functions/src/games/`
  gain media validation/normalization; `sanitizeTaskForParticipant`
  (`functions/src/runs/sanitizeTask.ts`) passes `media` through.
- **creator-web**: `services/firebase.ts` gains a Storage upload helper; `BuilderPage`
  TaskEditor gains a Media section; new i18n keys.
- **play-web**: `TaskRunner.tsx` renders the media gallery; new i18n keys.
- **Tests**: new `scripts/test-task-media.ts` (pure helpers); e2e `ALLOWED_TASK_KEYS`
  updated + a media round-trip scenario in `scripts/e2e-verify.mjs`.
- **Storage rules**: creator media uploads write under a creator-scoped path
  (`gameMedia/{ownerUid}/...`); `storage.rules` allow the owner to write there.
- No breaking changes — `media` is optional; existing tasks/games are unaffected.
