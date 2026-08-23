## Why

A creator opens the mission-library map and sees a map far emptier than their own game. Their
hidden-location missions — often the best ones in a treasure hunt, and sometimes most of the game —
are missing entirely, with a caption telling them that is on purpose. The creator cannot see their
own work on their own map.

The exclusion is deliberate and lives at the write:
`packages/shared/src/publicTaskLocation.ts:97` returns `undefined` for any task with
`hideLocation: true`, so `publishGame` writes no `approxLocation` at all for it. The original
rationale was that "the location is the puzzle", so publishing even a coarse area would name the
neighbourhood a player is meant to deduce.

That rationale over-reached. What is published is not a location, it is a **~1 km grid cell**
(`approximatePublicPoint`, `PUBLIC_LOCATION_CELL_DEG = 0.01`), snapped to a global grid anchored at
`(0, 0)`, deterministic under repeated publication. It says "this mission is somewhere in this
neighbourhood" — the same thing the game's own gallery card, its title, its description and its
public promo page already say. Meanwhile the real secrecy boundary, the one that actually protects
the puzzle, is somewhere else entirely: the **participant sanitizer**
(`functions/src/runs/sanitizeTask.ts:40`), which seals a hidden task completely until the server has
confirmed the team physically arrived. A player still gets a clue and nothing else.

**Product owner decision:** hidden-location tasks get the same coarse published area as every other
task.

## What Changes

**The writer's rule stops discriminating on `hideLocation`.**
- `publicTaskLocation()` derives the coarse area from a hidden-location task exactly as it does for
  any other task. `locationless`, absent, non-finite, out-of-range and null-island `(0, 0)`
  coordinates still yield nothing, unchanged.
- The comment block above the rule is rewritten to state the new rule and, explicitly, why the
  participant-facing secrecy is untouched by it.

**Everything downstream inherits the new rule through the same single predicate.**
- The **game-level area** (`functions/src/games/gameArea.ts`) already delegates eligibility to
  `publicTaskLocation`, so a hidden task now contributes to the derived game pin. This is
  intentional; the rationale is argued in design.md §3.
- The **backfill sweep** (`packages/shared/src/publicTaskBackfill.ts` +
  `functions/src/maintenance/publicTaskBackfill.ts`) now also repairs a document that carries **no**
  location at all when its authored task can now supply one. Without that, every hidden-location
  task published under the old rule stays permanently off the map, because such a document has no
  legacy `coordinates` key to trigger the existing repair.

**The creator-facing copy stops stating the old rule as fact.**
- `gallery.approxPinsNote` and `gallery.noLocatedTasksHelp` are corrected in Hebrew and English.

## What explicitly does NOT change

These are the boundary, and each one is held by a test rather than by assertion:

- **The participant sanitizer.** `sanitizeTask.ts` still strips `coordinates`,
  `geofenceRadiusMeters` and `smart.stationCoords` for a hidden task, and still seals the whole task
  until `reportArrival` latches. A player receives no coordinates, coarse or exact.
- **Exact coordinates never reach `publicTasks`.** Only the grid-snapped `approxLocation` is
  published, for hidden and non-hidden tasks alike. The deprecated `coordinates` key is still never
  written and is still stripped from `searchTaskLibrary` responses.
- **The grid rule itself.** Same cell size, same global anchor, same determinism. No jitter.
- **Locationless / unplaced tasks.** Still publish nothing.
- **No new callable, no rules change, no index, no env var.**

## Surfaces touched

- `packages/shared` — `publicTaskLocation.ts`, `publicTaskBackfill.ts` + their vitest files.
- `functions/` — `games/gameArea.test.ts` (expectations), `maintenance/publicTaskBackfill.ts`
  (pre-check), `runs/sanitizeTask.test.ts` (one new boundary test). No callable added or changed.
- `apps/creator-web/src/i18n.ts` — two strings, HE + EN.
- `scripts/test-public-task-seed.ts` — extended to guard the publish path's document shape.
- **Not touched:** `firestore.rules`, `play-web`, `scripts/e2e-verify.mjs` (see the report).
