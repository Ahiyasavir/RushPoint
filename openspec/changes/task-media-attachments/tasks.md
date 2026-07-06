## 1. Shared helpers — RED then GREEN (pure logic, TDD)

- [x] 1.1 RED: add `scripts/test-task-media.ts` asserting `parseYouTubeId` for watch/`youtu.be`/shorts/embed forms (→ id), and null for vimeo/empty/null/number; `isTaskMediaValid` true for a Storage image URL + a valid youtube entry, false for external image / unknown kind / missing url; `normalizeTaskMedia` drops invalid entries, canonicalizes youtube to `.../embed/<id>`, coerces non-array to `[]`, trims/drops empty captions, ensures a stable non-empty `id`. Confirm it FAILS (`npm test`).
- [x] 1.2 GREEN: implement `parseYouTubeId`, `isTaskMediaValid`, `normalizeTaskMedia` in `packages/shared/src/validation.ts` reusing `isFirebaseStorageUrl`; re-export from `@rushpoint/shared`. Run `npm test` — test 1.1 passes.

## 2. Shared types

- [x] 2.1 Add `export interface TaskMedia { id: string; kind: 'image' | 'video' | 'youtube'; url: string; caption?: string }` and `media?: TaskMedia[]` on `Task` in `packages/shared/src/types/index.ts` (with a doc comment noting it is orthogonal to type and independent of `smart.*`).
- [x] 2.2 `npm run typecheck` — shared + consumers compile.

## 3. Server validation & sanitizer (functions)

- [x] 3.1 In `functions/src/games/index.ts`, run every task's `media` through `normalizeTaskMedia` inside `createGame` and `updateGame` before persisting (rewrite the full task/stages array — never dotted-update array elements).
- [x] 3.2 In `functions/src/runs/sanitizeTask.ts`, pass `media` through to the participant payload unchanged (spread already keeps it; add an explicit comment + ensure it survives the `...rest` destructure). Add a co-located `sanitizeTask` assertion (vitest) if one exists, else extend the existing test, proving `media` is returned and no secret leaks.
- [x] 3.3 `npm run typecheck` for functions.

## 4. e2e — allowlist + round-trip (RED→GREEN)

- [x] 4.1 Add `media` to `ALLOWED_TASK_KEYS` in `scripts/e2e-verify.mjs`.
- [x] 4.2 Add an e2e scenario: create/update a game whose task carries one Storage-image entry and one YouTube entry; launch→join→`getMyTeamState`; assert the sanitized task returns both `media` entries and the YouTube url is the canonical embed form; assert an external image URL is dropped by the server. Run `npm run e2e` — green.

## 5. Storage rules

- [x] 5.1 In `storage.rules`, allow authenticated owner writes under `gameMedia/{ownerUid}/...` (`request.auth.uid == ownerUid`) with public read; keep all other client writes denied. Verify existing emulator boot still loads the rules.

## 6. creator-web — upload helper + Builder UI

- [x] 6.1 Add a Storage upload helper to `apps/creator-web/src/services/firebase.ts` (mirror play-web: `storageRef` + `uploadBytes` + `getDownloadURL`) targeting `gameMedia/{ownerUid}/games/{gameId}/{fileId}`, returning the download URL, with a progress callback.
- [x] 6.2 Add a "Media" section to the Builder TaskEditor (`apps/creator-web/src/pages/BuilderPage*`): file picker (image/video) with upload progress + preview, YouTube-URL input validated via `parseYouTubeId` (inline error on invalid), per-entry caption, reorder + remove. Write results into `task.media`. Use static Tailwind classes; all strings via `t.*`.
- [x] 6.3 Add creator-web i18n keys (EN + HE) for the Media section labels/errors in `apps/creator-web/src/i18n.ts`.

## 7. play-web — TaskRunner rendering

- [x] 7.1 In `apps/play-web/src/components/TaskRunner.tsx`, render a media gallery from `task.media`: `<img>` for image, `<video controls>` for video, a lazy YouTube `<iframe>` for youtube; captions with `dir="auto"`; render nothing when media is empty.
- [x] 7.2 Add play-web i18n keys (EN + HE) for any media labels in `apps/play-web/src/i18n.ts`.

## 8. Gates (all must be green)

- [x] 8.1 `npm run typecheck`
- [x] 8.2 `npm run lint`
- [x] 8.3 `npm test`
- [x] 8.4 `npm run creator:build` and `npm run play:build`
- [x] 8.5 `npm run e2e`
- [x] 8.6 `npm run i18n:check` (and `npm run i18n:check:strict` for the new UI — zero new findings)
- [ ] 8.7 Manual preview smoke: upload an image + add a YouTube link in the Builder, launch a run, confirm both render in the play-web TaskRunner. (Backend round-trip is covered by the e2e `task media` scenario; the interactive browser upload smoke is still owed.)
