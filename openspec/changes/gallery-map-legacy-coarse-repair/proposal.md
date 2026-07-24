## Why

The user reported twice that the **creator Gallery's mission-library map is still not accurate and
missing some missions**, after `gallery-map-serve-exact` already shipped a read-time recompute for
`searchTaskLibrary`. That recompute (`publicTaskForLibrary` in `functions/src/gallery/index.ts`)
only fixes a doc that still has a `coordinates` field to recompute from. A `task-library-map-view`
era `publicTasks` document has **neither** — it stores only the COARSE `approxLocation` written at
that time (~500 m–1 km off) and no `coordinates` at all — so `publicTaskLocation({coordinates:
undefined, ...})` returns `undefined` and the callable falls back to the stale coarse point. This is
exactly the "still not accurate" symptom: those missions plot, but off by up to a kilometre.

The only remaining source of the true point for such a doc is the private game template
(`users/{ownerUid}/games/{gameId}`) the task was published from — `publicTasks` is a denormalized
projection; the template is the source of truth and still carries the task's real `coordinates`.

## What Changes

- `searchTaskLibrary` (`functions/src/gallery/index.ts`) gains a second, targeted read-time repair
  pass, applied AFTER `publicTaskForLibrary`: for any returned mission whose stored doc has no
  `coordinates` AND whose stored `approxLocation` is still COARSE (`isCoarsePublicPoint`), look up
  the exact coordinate from the mission's source game template and recompute the served
  `approxLocation` from it via the same shared `publicTaskLocation` rule (so a `hideLocation` task in
  the template is still coarsened, never leaked).
- The lookup is **batched and bounded**: one Firestore read per distinct `(ownerUid, sourceGameId)`
  pair across the whole response (never per task), and it is skipped entirely for any doc that
  doesn't need it (most docs — already-precise ones — trigger zero extra reads).
- The lookup is **fail-open, read-only**: a missing/deleted/inaccessible game or task, or the fetch
  throwing outright, all fall back to today's behavior (the stored coarse `approxLocation`) — never
  an error, never a dropped mission, and nothing is written back to Firestore from this read path.

## What does NOT change

- `publicTaskForLibrary`'s existing recompute (docs that DO carry `coordinates`) is untouched — this
  is an additional pass for the one remaining generation it cannot fix on its own.
- The permanent repair path (`npm run backfill:public-tasks` /
  `backfillPublicTaskCoordinatesNow`) is untouched; this change makes the LIVE map correct without
  waiting for that sweep to run, it does not replace it.
- The `searchTaskLibrary` `HARD_CAP = 100` truncation (a creator with >100 public missions loses the
  tail of their list) is a SEPARATE possible cause of "missing some missions" and is explicitly OUT
  OF SCOPE here — real pagination is a larger change.
- No creator-web / play-web file changes; this is a `functions/src/gallery/index.ts`-only fix.

## Impact

- `functions/src/gallery/index.ts` — new pure-ish resolution helpers
  (`needsLegacyCoarseRepair`, `legacyCoarseRepairKeys`, `resolveLegacyCoarseLocations`) plus the
  batched Firestore wiring inside `searchTaskLibrary`.
- `functions/src/gallery/index.test.ts` — new unit coverage for the resolution logic (Firestore
  reads injected/mocked, following the existing `publicTaskForLibrary` test style).
- **Not touched:** `functions/src/games/index.ts` (the publish/write path — already correct),
  `functions/src/maintenance/publicTaskBackfill.ts` (the permanent sweep — already correct),
  `packages/shared` (reuses `publicTaskLocation` / `isCoarsePublicPoint` unchanged), any creator-web
  or play-web file.
