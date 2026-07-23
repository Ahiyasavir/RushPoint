## 1. RED — failing tests first

- [x] 1.1 `packages/shared/src/publicTaskLocation.test.ts` (reused from the prepared module): assert an
      ordinary task publishes the EXACT authored point, a hidden task's area differs and is coarse, and
      an `isCoarsePublicPoint` block (grid-cell centre ⇒ true, exact off-grid ⇒ false, unusable ⇒
      false).
- [x] 1.2 `packages/shared/src/publicTaskBackfill.test.ts`: a repaired ordinary doc gets the EXACT
      point; a hidden doc gets the coarse cell and never the exact point. Flip the assertions that
      expected a coarse area for an ordinary task.
- [x] 1.3 `scripts/test-gallery-task-detail.ts`: `areaApproximate` is false for an exact off-grid
      point, true for an on-grid cell centre, and false when there is no area.

## 2. GREEN — the shared writer + predicate

- [x] 2.1 `packages/shared/src/publicTaskLocation.ts` (reused): return the exact point for an ordinary
      task, coarsen only `hideLocation`. Keep `approximatePublicPoint`, `usableCoord` and the grid.
- [x] 2.2 `isCoarsePublicPoint(point)` — true iff the point already sits on the public grid — exported
      via the wholesale `export *` from `packages/shared/src/index.ts`.

## 3. GREEN — the consumers

- [x] 3.1 `apps/creator-web/src/lib/galleryTaskDetail.ts`: add `areaApproximate` via
      `isCoarsePublicPoint`; fix the stale "COARSE published area only" JSDoc; keep reading only
      `approxLocation`.
- [x] 3.2 `apps/creator-web/src/components/GalleryTaskDetailModal.tsx`: choose heading
      (`detailAreaTitlePrecise` / `detailAreaTitle`), pass the `detailAreaApproxNote` caveat to the map
      only when coarse.
- [x] 3.3 `apps/creator-web/src/components/GalleryMap.tsx`: add optional `MapPoint.approximate` (read by
      the caller; the map has no per-point overlay, so no drawing change).
- [x] 3.4 `apps/creator-web/src/pages/GalleryPage.tsx`: set `approximate: isCoarsePublicPoint(...)` on
      task pins; show the map-wide approximate caption only when a coarse pin is plotted. Games map
      unchanged.
- [x] 3.5 `functions/src/games/gameArea.ts`: fix the stale "inputs are already cell centres" comment;
      the OUTPUT stays coarse because the mean is re-snapped. No logic change.

## 4. GREEN — creator copy (HE + EN)

- [x] 4.1 `apps/creator-web/src/i18n.ts` (gallery.* only): reword `approxPinsNote`; add
      `detailAreaTitlePrecise` and `detailAreaApproxNote`. Hebrew in the Hebrew map, English in the
      English map, no em-dashes, no component-level literals.

## 5. e2e assertions (authored blind — cannot run e2e in this lane)

- [x] 5.1 `scripts/e2e-verify.mjs`: invert the ordinary-task assertions in the "public task library"
      and "backfill" scenarios (the published area now EQUALS the authored point); keep the hidden-task
      assertions (coarse, differs from the exact point). Update scenario titles. UNVERIFIED.

## 6. REFACTOR / verify

- [x] 6.1 Confirm `isPlottablePublicTask` still reads ONLY `approxLocation`; no `coordinates` fallback.
- [x] 6.2 Confirm `functions/src/runs/sanitizeTask.ts` is byte-for-byte unchanged.
- [ ] 6.3 Full gates (`npm run verify`) green; the modal off-screen fix and precise pins confirmed in a
      browser screenshot; `npm run e2e` green. UNVERIFIED in this lane — the parent runs them.
- [ ] 6.4 Existing `publicTasks` documents need `npm run backfill:public-tasks` (or a re-publish) to
      gain the exact point.
