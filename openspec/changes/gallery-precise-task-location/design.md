## Context

This change reverses one specific decision from `task-library-map-view` /
`public-task-area-visibility`: that an ordinary public task pin is coarsened. It supersedes the
relevant requirements of those changes via a delta rather than rewriting them. The
`hidden-location-map-visibility` decision (a hidden task publishes an area) is kept, but its "like any
other task" wording is narrowed: a hidden task is now the ONE task that publishes a coarse area.

## Goals / Non-goals

**Goals**
- Publish the exact authored point for an ordinary usably-placed task.
- Keep `hideLocation` tasks coarse in every world-readable document.
- Let every creator-facing reader (map notice, detail modal, copy) distinguish a precise pin from a
  coarse one, with no schema/backend/backfill schema change.

**Non-goals**
- Changing anything a participant receives (the sanitizer is untouched).
- Making the game-level pin precise (it stays a coarse re-snapped mean).
- Publishing the deprecated `coordinates` field again (it stays unwritten and stripped).

## Decisions

### 1. The writer: exact for ordinary, coarse for hidden

`publicTaskLocation(task)` returns:
- `undefined` when `locationless` or not usably placed (unchanged);
- `approximatePublicPoint(coordinates)` when `hideLocation` (the sole coarsening);
- `{ lat: round5(lat), lng: round5(lng) }` — the exact authored point — for every other task.

`approximatePublicPoint` is retained and still exported; it is now reached only by the hidden branch,
by `deriveGameArea`, and by the backfill's hidden case.

### 2. Telling precise from coarse WITHOUT a stored flag: `isCoarsePublicPoint`

The reader needs to know, per pin, whether the stored `approxLocation` is a coarse cell or an exact
point — but `PublicTask` does not (and should not need to) carry a flag. It is observable: a coarse
point is exactly the centre of its own grid cell, so `approximatePublicPoint(p)` deep-equals `p`. An
exact authored point equals its cell centre only in the measure-zero case of a task authored precisely
on the grid. So:

```
isCoarsePublicPoint(p) = usable(p) && approximatePublicPoint(p) == round5(p)
```

This also correctly classifies **legacy pre-backfill** documents (whose old coarse `approxLocation`
really is a cell centre) as coarse, with no migration gap. The only failure mode — an ordinary task
authored exactly on the grid rendering as coarse — is harmless, because that point is already public
and exact.

### 3. The renderer and the page

The remote `GalleryMap` draws one marker per point and has **no per-point area overlay** and no
clustering. So the honest "this is an area, not a fix" signal lives in two places the caller controls:
- the map-wide `notice` caption, shown on the Tasks map only when `taskPoints.some(p => p.approximate)`
  — i.e. at least one plotted pin is genuinely coarse;
- the detail modal's heading + optional caveat.

`MapPoint` gains `approximate?: boolean` so the caller can compute the map-wide gate cleanly;
`GalleryPage` sets it via `isCoarsePublicPoint(approxLocation)`. Game pins are always on the grid, so
the games map is unchanged by design.

### 4. The mission-detail modal

`buildGalleryTaskDetail` adds `areaApproximate = area !== null && isCoarsePublicPoint(area)`. The modal
chooses the heading (`detailAreaTitlePrecise` vs `detailAreaTitle`), and passes the `detailAreaApproxNote`
caveat to the map's `notice` only when the pin is coarse.

### 5. What stays coarse and why

- **Hidden tasks** — world-readable, and the spot is the puzzle.
- **Game-level area** — a re-snapped mean of a game's points; a game pin is a neighbourhood by intent.
- **Legacy docs** — genuinely coarse until the backfill / re-publish repairs them.

## Test strategy (TDD)

- `publicTaskLocation.test.ts` (reused from the prepared module) — ordinary publishes the exact point;
  hidden publishes the coarse cell and differs from ordinary; `isCoarsePublicPoint`: coarse-cell ⇒
  true, exact off-grid ⇒ false, unusable ⇒ false. 32 tests, green.
- `publicTaskBackfill.test.ts` — a repaired ordinary doc gets the EXACT point; a hidden doc gets the
  coarse cell and never the exact point. Ordinary-task assertions inverted to equality.
- `scripts/test-gallery-task-detail.ts` — `areaApproximate` is false for an exact off-grid point, true
  for an on-grid cell centre, false when there is no area.
- `functions/src/runs/sanitizeTask.ts` — confirmed byte-for-byte unchanged (hidden-only boundary).
- `scripts/e2e-verify.mjs` — the ordinary-task assertions are inverted (exact, not coarse); the
  hidden-task assertions keep proving coarse. Authored blind (cannot run e2e in this lane) — UNVERIFIED.
