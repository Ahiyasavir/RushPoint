## ADDED Requirements

### Requirement: Task carries an ordered list of general media attachments

The shared `Task` type SHALL support an optional `media?: TaskMedia[]` array, where
`TaskMedia` is `{ id: string; kind: 'image' | 'video' | 'youtube'; url: string; caption?: string }`.
`media` is orthogonal to `TaskType` — it MAY be present on any task type and is
independent of `smart.imageUrl` / `smart.mediaUrl` (which remain unchanged and apply
only to smart-station config). When `media` is absent or empty, task behavior is
unchanged.

For `kind: 'image'` and `kind: 'video'`, `url` SHALL be a Firebase Storage download
URL (an uploaded file). For `kind: 'youtube'`, `url` SHALL be a canonical
`https://www.youtube.com/embed/<id>` URL derived from the creator's pasted link.

#### Scenario: Task with no media behaves exactly as before
- **WHEN** a task has no `media` field (or `media: []`)
- **THEN** the task is created, sanitized, and rendered exactly as it is today with no media UI

#### Scenario: Media is independent of smart-station media
- **WHEN** a `field` task (no `smart` config) has `media: [{ kind: 'image', url: <storage-url> }]`
- **THEN** the media is persisted and returned to the participant, independent of any `smart` block

### Requirement: YouTube link parsing helper

`packages/shared/src/validation.ts` SHALL export a pure `parseYouTubeId(url: unknown): string | null`
that returns the 11-character YouTube video id for the common URL forms and `null`
otherwise. It SHALL return `false`-y (`null`) for non-string input. Supported forms:
`https://www.youtube.com/watch?v=<id>` (with extra query params), `https://youtu.be/<id>`,
`https://www.youtube.com/shorts/<id>`, and `https://www.youtube.com/embed/<id>`. The id
character set SHALL be `[A-Za-z0-9_-]{11}`.

#### Scenario: watch URL with extra params
- **WHEN** `parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")` is called
- **THEN** it returns `"dQw4w9WgXcQ"`

#### Scenario: short youtu.be URL
- **WHEN** `parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")` is called
- **THEN** it returns `"dQw4w9WgXcQ"`

#### Scenario: shorts and embed URLs
- **WHEN** `parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")` and `parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")` are called
- **THEN** both return `"dQw4w9WgXcQ"`

#### Scenario: non-YouTube or malformed input returns null
- **WHEN** `parseYouTubeId` is called with `"https://vimeo.com/123"`, `""`, `null`, or `42`
- **THEN** it returns `null`

### Requirement: Task media validation & normalization helper

`packages/shared/src/validation.ts` SHALL export a pure
`normalizeTaskMedia(input: unknown): TaskMedia[]` that takes an arbitrary client-supplied
value and returns a clean, validated array — dropping/throwing on invalid entries per the
rules below — and an `isTaskMediaValid(m: unknown): boolean` predicate for a single entry.

Rules:
- Non-array input normalizes to `[]`.
- For `kind: 'image'` / `kind: 'video'`: the entry is valid only if `isFirebaseStorageUrl(url)`
  is true (reusing the existing helper). Invalid entries are rejected.
- For `kind: 'youtube'`: the entry is valid only if `parseYouTubeId(url)` returns a non-null
  id; the normalized entry's `url` SHALL be rewritten to `https://www.youtube.com/embed/<id>`.
- Entries with an unknown `kind`, missing `url`, or a `url` failing its kind's check are dropped
  by `normalizeTaskMedia`; `isTaskMediaValid` returns `false` for them.
- Each returned entry SHALL have a stable non-empty `id` (preserved if present, else derived).
- `caption`, if present, SHALL be coerced to a trimmed string (dropped if empty).

#### Scenario: uploaded image with Firebase Storage URL is kept
- **WHEN** `normalizeTaskMedia([{ kind: 'image', url: 'https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/gameMedia%2F...' }])` is called
- **THEN** the result contains that entry with `kind: 'image'`

#### Scenario: image with an external URL is dropped
- **WHEN** `normalizeTaskMedia([{ kind: 'image', url: 'https://evil.example.com/x.jpg' }])` is called
- **THEN** the result is `[]`

#### Scenario: YouTube entry is normalized to the embed URL
- **WHEN** `normalizeTaskMedia([{ kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' }])` is called
- **THEN** the single entry's `url` is `'https://www.youtube.com/embed/dQw4w9WgXcQ'`

#### Scenario: unknown kind is dropped
- **WHEN** `normalizeTaskMedia([{ kind: 'gif', url: 'x' }, { kind: 'image', url: '<storage-url>' }])` is called
- **THEN** the result contains only the valid image entry

### Requirement: Server validates and normalizes task media on write

`createGame` and `updateGame` (`functions/src/games/index.ts`) SHALL run every task's
`media` field through `normalizeTaskMedia` before persisting. A game write SHALL NOT
persist an image/video media URL that is not a Firebase Storage URL, nor a YouTube entry
whose URL does not parse to a valid id. The server-stored YouTube `url` SHALL always be
the canonical embed form.

#### Scenario: external media URL cannot be persisted
- **WHEN** a client calls `updateGame` with a task whose `media` contains `{ kind: 'image', url: 'https://evil.example.com/x.jpg' }`
- **THEN** that entry is not persisted (dropped by normalization); the stored task's `media` excludes it

#### Scenario: YouTube link stored canonically
- **WHEN** a client calls `createGame`/`updateGame` with `{ kind: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }`
- **THEN** the stored task media entry has `url === 'https://www.youtube.com/embed/dQw4w9WgXcQ'`

### Requirement: Sanitizer exposes media to participants

`sanitizeTaskForParticipant` (`functions/src/runs/sanitizeTask.ts`) SHALL pass the task's
`media` array through to the participant payload unchanged (it contains no secrets). The
e2e sanitizer allowlist `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs` SHALL include
`media` so the allowlist guard does not fail on the new field.

#### Scenario: participant receives task media
- **WHEN** a participant fetches a task (via `getMyTeamState`) whose task has one image and one YouTube media entry
- **THEN** the returned sanitized task includes both `media` entries with their `url`, `kind`, and `caption`

#### Scenario: media does not trip the sanitizer allowlist guard
- **WHEN** the e2e sanitizer-allowlist scenario runs against a task carrying `media`
- **THEN** the guard passes because `media` is in `ALLOWED_TASK_KEYS`

### Requirement: Creator can attach media in the Builder

The creator-web Builder TaskEditor SHALL provide a "Media" section allowing the creator to:
(a) upload one or more image/video files from their computer — each uploaded to Firebase
Storage under a creator-scoped path and added to the task's `media` as `kind: 'image'`/`'video'`
with the download URL; (b) add a YouTube link, validated client-side via `parseYouTubeId`
before being added as `kind: 'youtube'`; (c) set an optional caption per entry; and
(d) reorder and remove entries. Upload progress and a thumbnail/preview SHALL be shown.
All visible strings SHALL come from `t.*` (i18n) with zero new `i18n:check` findings.

#### Scenario: upload an image file
- **WHEN** the creator picks an image file in the Media section
- **THEN** the file uploads to Firebase Storage and a new `{ kind: 'image', url: <storage-url> }` entry appears with a preview

#### Scenario: paste a valid YouTube link
- **WHEN** the creator pastes `https://youtu.be/dQw4w9WgXcQ` and confirms
- **THEN** a `{ kind: 'youtube', url: '.../embed/dQw4w9WgXcQ' }` entry is added

#### Scenario: paste an invalid YouTube link is rejected in-UI
- **WHEN** the creator pastes a non-YouTube URL
- **THEN** the UI shows a validation error and does not add an entry

### Requirement: Participant sees task media in the TaskRunner

The play-web `TaskRunner` SHALL render the task's `media` gallery alongside the task
instructions: `<img>` for `kind: 'image'`, an inline `<video controls>` for `kind: 'video'`,
and a lazily-loaded YouTube `<iframe>` embed for `kind: 'youtube'`. Captions SHALL render
with `dir="auto"`. When `media` is empty/absent, no gallery is rendered. All visible strings
SHALL come from `t.*`.

#### Scenario: image and video render inline
- **WHEN** a task with an image entry and an uploaded-video entry is shown
- **THEN** the participant sees the image and a playable `<video controls>` element

#### Scenario: YouTube renders as an embed
- **WHEN** a task with a `youtube` entry is shown
- **THEN** the participant sees a YouTube iframe player pointing at the canonical embed URL

#### Scenario: no media, no gallery
- **WHEN** a task has no media
- **THEN** no media gallery is rendered and layout is unchanged

### Requirement: Storage rules permit creator media uploads

`storage.rules` SHALL allow an authenticated creator to write objects under
`gameMedia/{ownerUid}/...` only when `request.auth.uid == ownerUid`, and permit public
read (media is embedded for participants). Uploads elsewhere by clients remain denied.

#### Scenario: owner can upload to their own media path
- **WHEN** the authenticated creator with uid `U` uploads to `gameMedia/U/games/g1/abc.jpg`
- **THEN** the write is permitted

#### Scenario: a creator cannot upload under another creator's path
- **WHEN** a creator with uid `U` attempts to write to `gameMedia/OTHER/...`
- **THEN** the write is denied by the rules
