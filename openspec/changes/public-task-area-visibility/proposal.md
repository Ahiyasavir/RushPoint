## Why

A creator opened the mission-library map and saw an empty world: the map framed at its default
`center: [35, 31.5], zoom: 4` (the whole eastern Mediterranean), **zero** area pins, and the pill
"לאף משימה בתוצאות אין אזור מפורסם" / "None of these missions has a published area." — while the
result list underneath showed missions that plainly *do* have a location authored on them.

Traced end to end in this working tree, the code is **correct at every hop**. This is not a
field-name mismatch:

- The writer coarsens and omits correctly — `publicTaskLocation()`
  (`packages/shared/src/publicTaskLocation.ts:89-102`) returns a ~1 km grid-snapped point, or
  `undefined` for hidden / locationless / unplaced tasks, and `publishGame` writes it under
  `approxLocation` and deliberately writes no `coordinates`
  (`functions/src/games/index.ts:719-729`).
- The callable passes it through untouched and strips only the deprecated exact key —
  `searchTaskLibrary` (`functions/src/gallery/index.ts:155`) does
  `ranked.map(({ coordinates: _exact, ...safe }) => safe)`; `approxLocation` survives.
- The reader reads the same key — `isPlottablePublicTask()`
  (`packages/shared/src/publicTaskLocation.ts:112-116`) and `GalleryPage`
  (`apps/creator-web/src/pages/GalleryPage.tsx:62-70`) both use `approxLocation`, with no
  fallback to `coordinates` **by design** (falling back would re-serve the exact point the
  privacy change exists to withhold).
- The renderer's empty state is correctly conditioned on `points.length === 0`
  (`apps/creator-web/src/components/GalleryMap.tsx:112`), so a *mixed* result set plots its
  located missions and shows no empty state. There is no rendering bug.

The defect is therefore **data**, and it has two distinct sources:

1. **Legacy documents.** `task-library-map-view` and `public-task-coordinates-backfill` shipped
   only in the current batch (`ad6a3e4`, `3953e1f`). Every `publicTasks/{id}` written before them
   carries an exact `coordinates` and **no** `approxLocation`. Nothing re-publishes them
   automatically, and the sweep that would repair them,
   `backfillPublicTaskCoordinatesNow` (`functions/src/maintenance/index.ts:260-270`), is
   `assertAdmin`-gated with no operator entry point — so on any environment where it has not been
   run by hand, every legacy mission is unplottable.
2. **The seed scripts still write the pre-privacy shape.** `scripts/seed-local.mjs:173-177`,
   `scripts/seed-games-youth.mjs:1156-1167`, `scripts/lib/sansana-game-def.mjs:197-202` and
   `scripts/lib/qa-game-def.mjs:385-390` each write `coordinates: t.coordinates` into
   `publicTasks/{id}` and never write `approxLocation`. So a **freshly seeded** environment
   reproduces the empty map exactly, and — because `publicTasks` is `allow read: if true` —
   re-introduces exact authored points into a world-readable collection on every seed.
   `seed-games-youth.mjs` writes `t.coordinates` unconditionally, with no `hideLocation` branch at
   all.

And the message itself is a dead end: it states a fact ("no published area") and offers the
creator no way to understand or resolve it.

## What Changes

**The empty map explains itself.**
- When a mission-library result set has results but none of them can be plotted, the map states
  the reason *and* what produces an area: an area is published when the game is published, so
  entries from before this update — and missions whose location is deliberately hidden — stay off
  the map until their game is published again.
- The decision of *which* state to show becomes a pure, unit-tested function over the result set
  rather than an inline length check, so "some results are plottable" can never be misreported as
  "none are".
- Both strings are added to the Hebrew and English dictionaries and reach the UI through `t.*`.
  Nothing is hardcoded in a component.

**Seeded public tasks obey the same write rule as published ones.**
- Every seed path derives its public-task location with the shared `publicTaskLocation()` rule and
  writes `approxLocation` (omitted entirely for hidden / locationless / unplaced tasks). None of
  them writes `coordinates` into `publicTasks` any more.
- A regression test asserts this about the seed sources themselves, so a future seeder cannot
  quietly re-introduce the exact point into a world-readable collection.

## Non-goals

- **No fallback from `approxLocation` to `coordinates` anywhere.** That would undo
  `task-library-map-view`. A legacy document stays unplottable until it is repaired.
- **No change to the writer, the sanitizer, the callable payload, or the grid rule.** They were
  investigated and are correct; touching them would be inventing a bug that is not there.
- **No automatic backfill trigger.** `backfillPublicTaskCoordinatesNow` stays admin-only and
  manually invoked; this change documents it as the operator remedy, it does not schedule it, add
  a creator-facing button, or widen its authorization.
- **No new callable**, no Firestore index, no rules change, no new env var.
- **No re-publish prompt in the Builder.** Out of scope.

## Surfaces touched

- `packages/shared` — one new pure predicate + its vitest cases (no type changes).
- `apps/creator-web` — `GalleryPage`, `GalleryMap`, `i18n.ts` (HE + EN).
- `scripts/` — the four seed writers and one new pure-logic test.
- **Not touched:** `functions/` (no callable added or changed), `firestore.rules`, `play-web`.
