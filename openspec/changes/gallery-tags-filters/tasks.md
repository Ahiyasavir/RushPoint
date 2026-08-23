# Tasks — gallery-tags-filters (TDD: RED → GREEN → REFACTOR per feature)

## F3 — game→mission tag propagation (foundation)
- [ ] RED: `scripts/test-game-tags-propagate.ts` — propagate unions game tags into
      every task; idempotent; no input mutation; new array identity; MAX_TAGS/dedup/
      casing; empty game tags = identity; game tags first over cap.
- [ ] GREEN: `propagateGameTagsToTasks` in `packages/shared/src/tags.ts`.
- [ ] GREEN: apply in `sanitizeStagesText` (server) with effective game tags.
- [ ] GREEN: apply in `buildSavePayload` (client) — same helper.
- [ ] RED→GREEN: extend `scripts/test-game-presentation.ts` — buildSavePayload output
      is stable when re-run on its own output (dirty-check invariant).
- [ ] e2e: after updateGame, every task.tags ⊇ game tags; after publish,
      searchTaskLibrary({tags:[gameTag]}) returns those missions.

## F2 — recommended/popular tags
- [ ] RED: `functions/src/gallery/tagStats.test.ts` — pure diff/merge (add/remove
      counts, floor 0, lowercase dedup).
- [ ] GREEN: `functions/src/gallery/tagStats.ts` (`bumpTagStats`), wire into
      publish/unpublish/removeGalleryIndex.
- [ ] GREEN: `getPopularTags` callable + re-export; auth + rate-limit; optional
      RECOMMENDED_TAGS seed merge.
- [ ] GREEN: `calls.ts` wrapper; Builder quick-add chips in TagsField + TaskTagsField;
      i18n HE+EN.
- [ ] e2e: publish game w/ known tags → getPopularTags includes them ranked;
      unpublish decrements. (Required by callable coverage guard.)

## F1 — gallery filters
- [ ] RED: `scripts/test-gallery-filter.ts` — `applyGalleryFacets` filters mode/type/
      difficulty/hasLocation + sorts popular/newest; total; never throws on malformed.
- [ ] GREEN: `packages/shared/src/galleryFilter.ts` + barrel export.
- [ ] GREEN: apply facets in searchGallery/searchTaskLibrary (in-memory, post-fetch).
- [ ] GREEN: GalleryPage filter bar (popular-tag chips + facet selects) + calls.ts
      types + i18n HE+EN.
- [ ] e2e: searchGallery({tags,mode}) and searchTaskLibrary({type,hasLocation}) narrow.

## Gates before each commit
typecheck · lint · test · i18n:check:strict · creator:build · (e2e for backend lanes).
`npm run verify` before push. Push carries the branch's existing commits — stable base.
