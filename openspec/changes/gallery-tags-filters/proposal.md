# Change: gallery-tags-filters

## Why
Creators want to (1) find gallery games/missions faster by filtering on popular
tags and a few sensible facets, (2) discover and one‑tap add popular tags while
building a game, and (3) tag a game once and have every mission inherit those
tags. Today the gallery has only a free‑text box, tags are entered blind (no
suggestions), and a game's tags do not reach its missions — so a mission is never
findable by its game's tags.

## What Changes (3 features, built on the existing `game-task-tags` system)

### F3 — Auto‑propagate game tags → mission tags (FOUNDATION, do first)
- New pure helper `propagateGameTagsToTasks(gameTags, stages)` in
  `packages/shared/src/tags.ts`: returns a NEW stages array where each
  `task.tags = normalizeTags([...gameTags, ...(task.tags ?? [])])`. Idempotent,
  never mutates input, rebuilds the array (honors the never‑dotted‑array rule),
  respects `MAX_TAGS`.
- Applied SERVER‑side in `sanitizeStagesText` (`functions/src/games/index.ts`,
  which already rebuilds stages + normalizes task tags) using the effective game
  tags = `updates.tags ?? existing.tags` — auto‑covers `updateGame` + `importGameFile`.
- Applied CLIENT‑side in `buildSavePayload` (`apps/creator-web/src/lib/savePayload.ts`)
  with the SAME helper, so the Builder dirty‑check stays stable (server union is
  idempotent over the client union → no phantom‑dirty loop).
- `publishGame` then naturally emits the union into `publicTasks.tags`.

### F1 — Gallery search filters
- Backend already accepts + DB‑filters `tags[]` (indexed). Add optional in‑memory
  facets applied after `fetchRankedWindow`, before slice: `searchGallery` →
  `mode?`, `sort?`; `searchTaskLibrary` → `type?`, `difficulty?`, `hasLocation?`,
  `sort?`. Extract pure `applyGalleryFacets(items, facets)` into
  `packages/shared/src/galleryFilter.ts` (unit‑tested, total, never throws).
- Frontend: a filter bar under the search box in `GalleryPage.tsx` — popular‑tag
  chips (from F2) + mode/type/difficulty/has‑location/sort selects. New args
  threaded through `run()` + the debounce deps; wrapper types in `services/calls.ts`.
- Keep tags as the ONLY DB filter (one array‑contains per query; facets in memory
  to avoid composite‑index explosion).

### F2 — Recommended / popular tags in the Builder
- Maintained counter doc `publicTagStats/global` (`{counts: Record<lower,{tag,n}>}`),
  bumped transactionally on publish/unpublish (one write per publish, not a hot
  path — same pattern as `popularityStore`). New `functions/src/gallery/tagStats.ts`.
- New auth‑required, rate‑limited callable `getPopularTags({limit?})` →
  `{tags: string[]}` (count desc), re‑exported from `functions/src/index.ts`.
- Optional bilingual `RECOMMENDED_TAGS` seed in `tags.ts` merged under live counts
  so an empty gallery still shows useful chips.
- Builder: `TagsField` (game) + `TaskTagsField` (task) render a quick‑add chip row
  of popular tags not already present; tap → `normalizeTags([...current, tag])`.

## Impact
- Shared: `tags.ts` (+helper, +seed), `galleryFilter.ts` (new), barrel export.
- Functions: `gallery/index.ts` (facets + getPopularTags), `gallery/tagStats.ts`
  (new), `games/index.ts` (sanitizeStagesText propagation), `index.ts` (re‑export).
- Creator‑web: `GalleryPage.tsx`, `BuilderPage.tsx`, `TaskWizard.tsx`, `ui.tsx`,
  `services/calls.ts`, `lib/savePayload.ts`, `i18n.ts` (HE+EN, no hyphens).
- Tests (RED first): `test-game-tags-propagate.ts` (new), `galleryFilter` unit,
  `tagStats` unit, extend `test-game-presentation.ts` + `e2e-verify.mjs`
  (getPopularTags coverage + filter/propagation assertions).
- No new composite index unless a DB "newest" sort is chosen (deferred; in‑memory
  MVP, bias documented).

## Non‑goals
- No tag provenance / un‑inherit (union only — removing a game tag does NOT strip
  it from a mission it was already merged into).
- No DB equality facets alongside array‑contains (index explosion / illegal query).
