## Why

A creator reported, from the running app: **"I don't see the tags anywhere"**, and that typing
`a, b, c` into a tag field does not produce three tags.

Traced end to end in this working tree, `tags` is a **write-only field**. Nothing is corrupted and
nothing regressed — most of the chain was simply never built:

1. **No component renders a tag. Anywhere.** `Game.tags`
   (`packages/shared/src/types/index.ts:503`), `PublicGame.tags` (`:575`), `Task.tags` (`:373`) and
   `PublicTask.tags` (`:634`) all exist and are all persisted, denormalized and returned — and then
   dropped on the floor by the UI. `apps/creator-web/src/pages/GalleryPage.tsx` renders
   stages/tasks/minutes/plays on a game card (`:218-226`) and type/difficulty/points on a mission
   card (`:243-249`) — no tags. `apps/creator-web/src/components/TaskLibrary.tsx:33` reads
   `pt.tags` only to copy it into the reconstructed `Task`, never to display it.
   `apps/play-web/src/screens/GamePromoScreen.tsx` shows stage/task/minute stats (`:152`) — no tags.
   The Builder's own tiles (`components/TaskCard.tsx`) show none either. **This is the whole of
   complaint (1).** The creator types tags, they are saved correctly, and no screen has ever shown
   them back.
2. **A task has no tags input at all.** `Task.tags` is documented as "Library metadata (for
   publicTasks index)" and is populated by exactly one code path — copying a public task out of the
   library (`TaskLibrary.tsx:33`). Neither `components/TaskWizard.tsx` (the task editor) nor
   `pages/BuilderPage.tsx` offers a field for it. So a creator who believes they tagged a *task*
   never did, and any comma they typed there went into some other field. **This is the whole of
   complaint (2)** — the comma "does nothing" because on a task there is nothing for it to do.
3. **The game-level comma split does work — but only in one app.** `TagsField`
   (`BuilderPage.tsx:757-779`) keeps the raw string and derives the array via `parseTagsInput`
   (`apps/creator-web/src/lib/tags.ts:12`), which splits on `,`, trims, drops empties and dedupes.
   That parser lives **inside creator-web**, so it is unreachable from `functions/` and from
   play-web. It also dedupes **case-sensitively** (`Park` and `park` both survive), accepts only the
   ASCII comma, and does not collapse internal whitespace.
4. **The server trusts whatever the client sends.** `createGame` takes `tags` straight off the
   payload into the stored document (`functions/src/games/index.ts:164`, written at `:186`), and
   `updateGame` does `if (tags !== undefined) updates.tags = tags` (`:254`) with no type check, no
   per-tag length cap and no count cap. Those values then ride into the world-readable gallery via
   the publish denormalizer (`:307` on edit, `:683` at publish, and per-task at `:733`) and back out
   through `searchGallery`/`searchTaskLibrary` to every user. A client can store ten thousand tags,
   or one tag a megabyte long, and everyone downloads it.
5. **The sanitizer is NOT the broken link — stated plainly so it is not "fixed" twice.** `tags` is
   already in `ALLOWED_TASK_KEYS` (`scripts/e2e-verify.mjs:242`) and rides through
   `sanitizeTaskForParticipant` in `...rest` (`functions/src/runs/sanitizeTask.ts:74`). Task tags
   reach the participant payload today. They are simply never drawn.

So: one shared parser that nobody shares, a missing task-level input, an unguarded server write, and
a rendering layer that has never once displayed the field.

## What Changes

**One definition of "what a tag list is", shared by every layer.**
- A pure `normalizeTags` in `packages/shared` becomes the single source of truth for splitting,
  trimming, de-duplicating and capping a tag list, used by creator-web, play-web and `functions/`.
  `apps/creator-web/src/lib/tags.ts` keeps its `parseTagsInput` name and delegates, so the existing
  Builder wiring and `scripts/test-tags-input.ts` keep working.
- A comma separates tags — that is now true of every field that accepts tags, and the field says so.
  Separators accepted: the ASCII comma, the Arabic comma `،` (U+060C) and the fullwidth comma `，`
  (U+FF0C) — both are produced by real mobile keyboards a Hebrew-first audience uses and are never
  legitimate inside a tag — plus newlines, so pasting a list works.
- De-duplication becomes **case-insensitive with first-seen casing preserved**: `Park, park` is one
  tag rendered `Park`. Hebrew is caseless, so this is a no-op there and cannot mangle it.
- Hebrew, mixed Hebrew/English and any other non-ASCII text passes through **unchanged** apart from
  whitespace collapsing. Nothing is transliterated, ASCII-folded or stripped.

**A task can finally be tagged.**
- The task editor gets a tags field alongside the other library metadata, so `Task.tags` stops being
  a field only the library import can write.

**The server stops trusting the client.**
- Every tag list arriving from a client is normalized and capped server-side before it is stored and
  before it is denormalized into the world-readable gallery — the same function the client used, so
  the two can never disagree. A malformed, oversized or over-long list is *clamped*, not rejected:
  losing a creator's whole save over a bad tag would be worse than dropping the 21st tag.

**Tags are rendered as chips wherever a creator looks for them.**
- Gallery game cards, task-library cards, the Builder's own game details, and the public game promo
  page in play-web. Every label goes through the `t.*` dictionaries in Hebrew and English; the tag
  text itself is creator-authored so it renders `dir="auto"`.

### Non-goals

- **Not tag-based search or filtering UI.** The `tags` filter argument already exists on
  `searchGallery`/`searchTaskLibrary` (`functions/src/gallery/index.ts:50`); wiring a click-a-chip-
  to-filter interaction is a separate change.
- **No tag taxonomy, no suggestions, no autocomplete, no synonym merging.** Free text stays free.
- **No new callables, no Firestore rules changes, no new collections.**
- **No change to the sanitizer allowlist.** `tags` is already allowlisted and already passes through;
  `ALLOWED_TASK_KEYS` is deliberately left untouched.
- **No migration of stored documents.** Existing games keep their stored tags; they are normalized on
  the next save and rendered as-is meanwhile.

## Capabilities

### New Capabilities
- `game-task-tags`: A creator labels a game and a task with free-text tags typed as a
  comma-separated list; the list is parsed identically on client and server, bounded so it can never
  become a payload weapon, safe for Hebrew and mixed-direction text, and displayed back as discrete
  chips everywhere the tagged item appears.

## Impact

- **Surfaces touched:** `packages/shared` (one new pure module + its export),
  `functions/src/games/index.ts` (normalize on create / update / publish), `apps/creator-web`
  (Builder game field, task editor field, gallery + library chips, i18n), `apps/play-web`
  (game promo chips, i18n), `scripts/` (new pure test + e2e assertions).
- **Files:** `packages/shared/src/tags.ts` (new), `packages/shared/src/index.ts`,
  `apps/creator-web/src/lib/tags.ts`, `apps/creator-web/src/pages/BuilderPage.tsx`,
  `apps/creator-web/src/components/TaskWizard.tsx`,
  `apps/creator-web/src/pages/GalleryPage.tsx`, `apps/creator-web/src/i18n.ts`,
  `apps/play-web/src/screens/GamePromoScreen.tsx`, `apps/play-web/src/i18n.ts`,
  `functions/src/games/index.ts`, `functions/src/games/tagsNormalization.test.ts` (new),
  `scripts/test-tags.ts` (new), `scripts/e2e-verify.mjs` (assertions only).
- **No** new callables, **no** Firestore rules change, **no** new env vars, **no** schema migration.
- **Backwards compatibility:** `Game.tags` / `Task.tags` / `PublicGame.tags` / `PublicTask.tags`
  keep their existing types. A stored list that predates this change is read and rendered as-is and
  is normalized the next time its game is saved. `parseTagsInput` keeps its signature and its
  existing test file.
- **Risk:** the normalizer silently drops content (empties, duplicates, tags past the cap) and
  truncates a long tag. Mitigated by making it a pure total function — every input maps to a defined
  output, `undefined` and non-array input included — and by unit-testing the boundaries directly
  (`cap-1` / `cap` / `cap+1` for both count and length) rather than only the happy path.
- **Testing:** pure-logic lane (`scripts/test-tags.ts` + a `functions/` vitest for the server-side
  guard, both emulator-free). E2E assertions are **written but deliberately not run** — a live
  playtest stack is serving from this tree and `npm run e2e` must not be started; that is recorded
  rather than assumed.
