## Context

Tasks today only carry text (`title`, `description`) plus type-specific verification
config. The sole media fields (`smart.imageUrl` / `smart.mediaUrl`) sit under `smart`
and only apply to `smart_station` tasks. Creators want to attach reference photos /
demo videos / YouTube clips to *any* task, sourced either from their computer or from a
pasted YouTube link.

The platform already has the load-bearing pieces:
- **Firebase Storage** is configured in both apps; play-web has an upload helper
  (`apps/play-web/src/services/firebase.ts` — `uploadBytes` + `getDownloadURL`).
- A URL-origin guard `isFirebaseStorageUrl(url)` exists in
  `packages/shared/src/validation.ts` (used by `submitStationPhoto`).
- `sanitizeTaskForParticipant` is the single security boundary for task payloads, and
  the e2e suite enforces a `ALLOWED_TASK_KEYS` allowlist that fails loud on any new
  unlisted `Task` field.

Constraints (from CLAUDE.md / INSTRUCTIONS.md): server-write-only run/game state via
callables, `FIRESTORE_PATHS` only, answer-key secrecy via the sanitizer, no dotted-key
array updates, static Tailwind classes, i18n purity, TDD-first, all gates green.

## Goals / Non-Goals

**Goals:**
- A single `Task.media: TaskMedia[]` model that works on every task type.
- Two authoring sources: file upload → Firebase Storage; YouTube link → normalized embed.
- Pure, unit-tested validation/normalization shared by client and server, with the server
  as the enforcement boundary (a client can never persist an off-origin media URL).
- Participant rendering in the TaskRunner (image / video / YouTube embed).

**Non-Goals:**
- No transcoding, thumbnail generation, or server-side media processing.
- No non-YouTube video providers (Vimeo, direct external URLs) in this change.
- No changes to scoring, routing, or the `smart.*` media fields.
- No per-file size/type enforcement beyond a client-side guard + Storage rules (a
  hard server-side content-scan is out of scope).

## Decisions

### D1: New top-level `Task.media` array (not reuse `smart.*`)
`smart` only exists for `smart_station` tasks and its media fields are single-valued and
semantically "station reference material". A first-class `media?: TaskMedia[]` on `Task`
is orthogonal to type and supports multiple ordered entries with captions.
- *Alternative considered:* promote `smart.imageUrl` to top-level — rejected: conflates
  two concepts and would churn the smart-station sanitizer path.

### D2: Three `kind`s — `image | video | youtube`
`image`/`video` are uploaded files (Firebase Storage URL). `youtube` stores a canonical
`https://www.youtube.com/embed/<id>` URL (no upload). This keeps the client renderer a
simple switch and lets the validator apply a per-kind origin rule.
- *Alternative:* a generic `externalUrl` kind — rejected: an open external-URL field is
  an SSRF/abuse and mixed-content risk and defeats the Storage-origin guard.

### D3: Validation/normalization is a pure shared helper; the server is the boundary
Add `parseYouTubeId`, `isTaskMediaValid`, `normalizeTaskMedia` to
`packages/shared/src/validation.ts` (pure, no Firebase). `createGame`/`updateGame` call
`normalizeTaskMedia` on every task before persisting, so bad entries are dropped and
YouTube URLs are canonicalized server-side. The Builder uses the same helpers for instant
client-side feedback, but never as the trust boundary.
- Reuses `isFirebaseStorageUrl` for the image/video origin check (single source of truth).

### D4: `normalizeTaskMedia` drops invalid entries rather than throwing
Persisting a game with one bad media entry should not hard-fail the whole `updateGame`
(the Builder autosaves frequently). Invalid entries are silently dropped by the server
normalizer; the Builder surfaces validation inline before the entry is ever added, so a
dropped entry is an unexpected edge, not the normal path. `isTaskMediaValid` remains a
strict predicate for tests and UI.

### D5: Sanitizer passes `media` through; add to `ALLOWED_TASK_KEYS`
`media` carries no secret (URLs are public/embeddable), so `sanitizeTaskForParticipant`
spreads it through unchanged. The e2e `ALLOWED_TASK_KEYS` allowlist gains `media` so the
"new field fails loud" guard passes intentionally.

### D6: Storage path & rules — `gameMedia/{ownerUid}/...`, owner-write / public-read
Creator uploads go to `gameMedia/{ownerUid}/games/{gameId}/{fileId}` so `storage.rules`
can gate writes on `request.auth.uid == ownerUid`. Read is public because participant
`<img>`/`<video>` fetch the Storage download URL directly (no auth context). A creator
Storage upload helper is added to `apps/creator-web/src/services/firebase.ts` mirroring
the play-web one.

### D7: YouTube embed is lazy + sandboxed
The TaskRunner renders the YouTube `<iframe>` with `loading="lazy"` and `youtube-nocookie`
is *not* required, but the iframe uses a minimal `allow` set and no extra scopes. The map
chunk pattern (lazy) is followed so the embed doesn't bloat the initial bundle where
practical.

## Risks / Trade-offs

- **Large file uploads on mobile creator sessions** → Mitigation: client-side size guard
  + progress UI; document a soft cap. No server transcode in scope.
- **Public-read Storage for media** → Mitigation: scoped to the `gameMedia/` prefix only;
  URLs are unguessable (Firebase tokens). Acceptable because media is meant to be shown to
  anonymous participants.
- **Dropped-not-rejected normalization (D4) could hide a Builder bug** → Mitigation: the
  Builder validates before adding, and a pure-logic test asserts the drop behavior so it's
  intentional and covered.
- **YouTube markup / mixed content** → Mitigation: only ever store/emit the canonical
  `https://www.youtube.com/embed/<id>` derived from `parseYouTubeId`; never echo raw input.
- **New `Task` field could leak if the sanitizer regressed** → Mitigation: the e2e
  allowlist + a round-trip scenario cover it explicitly.

## Migration Plan

Additive and backward-compatible: `media` is optional; existing games/tasks have no
`media` and are unaffected. Order of implementation (TDD): (1) shared helpers + pure tests
(RED→GREEN), (2) types, (3) server normalization in create/updateGame + sanitizer + e2e
allowlist/round-trip, (4) storage.rules, (5) creator upload helper + Builder UI, (6)
play-web TaskRunner rendering, (7) i18n keys, (8) all gates. Rollback = revert the change;
no data migration needed (unused `media` fields are simply ignored by old code).

## Open Questions

- Soft cap on number of media entries per task and max file size — pick sane defaults
  (e.g. ≤6 entries, ≤25MB/file client guard); confirm during apply.
- Whether uploaded videos should also be allowed as `kind: 'video'` from Storage vs
  restricted to images only in v1 — proposal includes video; keep unless build cost spikes.
