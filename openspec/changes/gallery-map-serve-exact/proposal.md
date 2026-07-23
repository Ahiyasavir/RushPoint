# Proposal — gallery-map-serve-exact

## Why

The creator Gallery / mission-library map still does not show all missions, and the ones it does
show are misplaced. The root cause is a **read-path** gap that a prior write-path fix never closed.

`searchTaskLibrary` (`functions/src/gallery/index.ts`) served each `publicTasks` document by
stripping the deprecated exact `coordinates` and returning only whatever `approxLocation` the stored
document already held. The map (`GalleryPage.tsx`) plots **only** `approxLocation`. But stored
`publicTasks` documents come in three generations:

| Generation | `coordinates` | `approxLocation` | Map result before this change |
|---|---|---|---|
| pre `task-library-map-view` | EXACT | **absent** | **does not plot at all** |
| `task-library-map-view` | absent | COARSE (~1 km) | plots, but in the wrong place |
| `gallery-precise-task-location` | absent | EXACT | correct |

The earlier `gallery-precise-task-location` fix changed only the WRITE path (`publishGame`), so it
did nothing for already-stored documents. Every mission published before that change is therefore
either missing from the map or coarsely misplaced — exactly the complaint — and it stays that way
until each game is re-published, which no creator has any reason to do.

## What Changes

**`searchTaskLibrary` recomputes each mission's public location AT READ TIME from the stored
`coordinates`, on every read, via the shared `publicTaskLocation()` rule.** Every already-published
mission then plots at its exact spot immediately, with **no re-publish and no backfill** — the fix
reaches old documents through the read path instead of waiting on a data migration.

- A new **pure, unit-tested** helper `publicTaskForLibrary(raw)` (exported from
  `functions/src/gallery/index.ts`) reconciles the three generations: a doc carrying legacy exact
  `coordinates` is served its EXACT point (round5), a doc carrying only `approxLocation` keeps that
  stored point, and the deprecated `coordinates` key is always dropped from the response.
- **The `hideLocation` carve-out is preserved.** `publicTaskLocation` coarsens a `hideLocation`
  task to its ~1 km cell so a puzzle's answer is never handed to the world. If a `publicTasks`
  document carries the `hideLocation` flag, the served point is coarsened.

## Non-goals

- **No new callable and no callable-signature change.** `searchTaskLibrary` keeps its shape; only
  the per-result location resolution changes.
- **No write-path change.** `publishGame` already writes the exact `approxLocation` and the
  admin-only legacy-coordinate backfill sweep is unchanged; this change makes both unnecessary for
  the map to be correct, but removes neither.
- **No client change.** `GalleryPage.tsx` / `TaskLibrary.tsx` already read `approxLocation`; they are
  not touched.
- **No paging change.** The `HARD_CAP = 100` and the default `limit = 30` are unchanged (see the
  documented residual limit below).

## Residual: paging cap

The map and the list share one `searchTaskLibrary` call, and the client passes no `limit`, so the
effective ceiling is the callable default (30 results), with a `HARD_CAP` of 100. A creator whose
reachable library exceeds that ceiling still loses missions from the map. This change deliberately
does not raise the cap (a reckless widening of the fan-out/read cost); the limit is documented here
as a known follow-up (the client should request `limit: 100` for the map surface, or a dedicated
map fetch should be added).

## Residual: hideLocation on legacy coordinate-only docs

No generation of `publishGame` ever wrote the `hideLocation` flag onto a `publicTasks` document
(verified from git history: the earliest projection wrote a bare `coordinates: task.coordinates`;
every later one writes only `approxLocation`). So a legacy doc that still carries `coordinates`
has no `hideLocation` flag at read time and is served EXACT. This is safe: that exact `coordinates`
was already world-readable in the same doc (`allow read: if true`) before `hideLocation` existed as
a Task field, and the only way to produce a hidden document is a re-publish, which rewrites the doc
through `publicTaskLocation` (coarsening it) and erases `coordinates`. The residual exposure is
pre-existing raw-doc data, not introduced by this read-path change.

## Impact

- Affected specs: `gallery-map-serve-exact` (new)
- Affected code: `functions/src/gallery/index.ts` (new `publicTaskForLibrary`, `searchTaskLibrary`
  mapping), `functions/src/gallery/index.test.ts` (new unit tests), `scripts/e2e-verify.mjs`
  (new additive scenario)
- Surfaces touched: **functions only.** No shared types, no client, no rules.
