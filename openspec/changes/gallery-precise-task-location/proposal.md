## Why

A creator opens the gallery or mission-library map to find and copy a good mission, and every pin is
in the wrong place. A task authored precisely at a shop door, a viewpoint, a statue is published as a
coarse ~1 km cell centre that can sit hundreds of metres away, and several missions in one
neighbourhood collapse onto a single marker. The one thing these maps exist for — showing **where
another creator put a task** so you can reuse that point of interest — is exactly what the coarsening
hides.

The coarsening was introduced by `task-library-map-view` under a privacy framing borrowed from
participant location: `publicTasks` is world-readable (`allow read: if true`), so the exact
`task.coordinates` used to leak. But a gallery task pin is **not a person's location**. It is an
authored point of interest — a landmark the creator deliberately chose and would happily have another
creator reuse. Coarsening it protects nothing and breaks the feature.

The genuine exception is a `hideLocation` task, whose spot is a **deliberate puzzle** withheld from
players. Publishing its exact point into a world-readable document would hand the answer to anyone, so
it must stay coarse. The participant-facing secrecy — the sanitizer that seals a hidden task until
arrival — is a completely separate control that this change does not touch.

**Product owner decision (already made):** gallery / mission-library task pins are PRECISE. The one
exception is `hideLocation` tasks, which stay coarsened to the ~1 km cell.

## What Changes

**The writer's rule stops coarsening ordinary tasks.**
- `publicTaskLocation()` (`packages/shared/src/publicTaskLocation.ts`) returns the EXACT authored
  point for an ordinary usably-placed task, and only coarsens a `hideLocation` task (via the unchanged
  `approximatePublicPoint`). `locationless`, absent, non-finite, out-of-range and null-island `(0, 0)`
  still yield nothing.

**A single shared predicate lets every reader tell a precise pin from a coarse one — with no stored
flag.** `isCoarsePublicPoint(point)` returns true exactly when the point already sits on the public
grid (i.e. `approximatePublicPoint` is a no-op on it). Hidden-task pins, game-area pins and legacy
pre-backfill pins are on-grid (coarse); an ordinary exact pin is off-grid (precise). This is a pure
structural test on the coordinate, so no `PublicTask` schema change, no backend denormalization and no
backfill schema change are needed.

**The reader surfaces stop calling ordinary locations approximate.**
- `galleryTaskDetail.ts` adds `areaApproximate = hasArea && isCoarsePublicPoint(approxLocation)` to
  the mission-detail view model and drops the stale "COARSE published area only" comment.
- `GalleryTaskDetailModal.tsx` shows the exact spot for an ordinary mission (heading "location on the
  map", no "approximate" caveat) and the coarse area only for a hidden mission (heading "approximate
  area", plus the caveat note passed to the map).
- `GalleryPage.tsx` sets `approximate = isCoarsePublicPoint(...)` on every task pin and shows the
  map-wide "approximate area" caption only when at least one plotted task pin is genuinely coarse.
- `GalleryMap.tsx` gains an optional `MapPoint.approximate` field the caller populates; the map draws
  a marker per point exactly as before (it has no per-point area overlay), so the field is read by the
  caller, not the renderer.

**The creator-facing copy stops calling ordinary locations approximate.**
- `gallery.approxPinsNote` is reworded (HE + EN) so ordinary pins are described as exact and only a
  hidden-location mission is called an approximate area. `detailAreaTitlePrecise` ("location on the
  map") and `detailAreaApproxNote` (the hidden-only caveat) are added.

**The games map is deliberately left coarse.** `deriveGameArea` snaps the mean of a game's task points
back onto the grid, so a game-level pin is genuinely a neighbourhood, not a fix on any one stop.

## What explicitly does NOT change

- **The participant sanitizer** (`functions/src/runs/sanitizeTask.ts`) — byte-for-byte unchanged. A
  hidden task still strips `coordinates`, `geofenceRadiusMeters` and `smart.stationCoords` and stays
  sealed until arrival. The player receives no coordinate, coarse or exact.
- **`hideLocation` tasks stay coarse** in every world-readable document. Their exact point is never
  published.
- **The grid rule itself** — same cell size, same global anchor, same determinism. No jitter.
- **Locationless / unplaced tasks** — still publish nothing.
- **The game-level area** — still coarse (a re-snapped mean); games copy and behaviour unchanged.
- **The read predicate** `isPlottablePublicTask` still reads ONLY `approxLocation`; no `coordinates`
  fallback is introduced.
- **No new callable, no rules change, no index, no env var, no `PublicTask` field.**

## Surfaces touched

- `packages/shared` — `publicTaskLocation.ts` (writer + new `isCoarsePublicPoint`),
  `publicTaskBackfill.ts` (delegation only; behaviour follows the writer) and their vitest files.
- `functions/` — `games/gameArea.ts` (stale comment only), `scripts/e2e-verify.mjs` (invert the
  ordinary-task assertions; keep hidden-stays-coarse). `runs/sanitizeTask.ts` untouched.
- `apps/creator-web` — `components/GalleryMap.tsx`, `components/GalleryTaskDetailModal.tsx`,
  `lib/galleryTaskDetail.ts` (+ `scripts/test-gallery-task-detail.ts`), `pages/GalleryPage.tsx`,
  `i18n.ts` (gallery keys, HE + EN).
- **Not touched:** `firestore.rules`, `play-web`, the participant sanitizer, the `PublicTask` schema.

## Data note

Existing `publicTasks` documents carry a legacy exact `coordinates` field (or an old coarse
`approxLocation`). After this change, `npm run backfill:public-tasks` (or a re-publish) writes the
EXACT point for an ordinary task and a coarse cell for a hidden one. Until that runs, an unmigrated
ordinary pin that still sits on the grid simply renders as coarse — which is honest, because it IS
coarse until repaired.
