# Design — gallery-map-serve-exact

## The decision: fix on the read path, not the write path

The observable bug is that already-stored `publicTasks` documents do not carry a usable
`approxLocation`. Two ways to fix that:

1. **Migrate the data** (re-publish every game, or run the admin backfill sweep). Requires an
   operator action per project and does nothing until it runs.
2. **Compute the served location at read time** from whatever the document already holds.

We take (2). `searchTaskLibrary` already post-processes every result (it strips `coordinates`), so
recomputing `approxLocation` there is one pure function away and repairs every generation of stored
document the instant it is read — no migration, no operator step, no client change.

## The pure function

```ts
export function publicTaskForLibrary(
  raw: PublicTask & { hideLocation?: boolean; locationless?: boolean },
): PublicTask {
  const { coordinates, hideLocation, locationless, ...safe } = raw;
  const loc = publicTaskLocation({ hideLocation, locationless, coordinates });
  return loc ? { ...safe, approxLocation: loc } : safe;
}
```

- `publicTaskLocation` is the single shared rule (`packages/shared/src/publicTaskLocation.ts`) the
  publish path already uses, so the read path and the write path can never disagree about where a
  mission sits or whether a hidden one is coarsened.
- When `publicTaskLocation` returns `undefined` (locationless, unplaced, or no `coordinates`), the
  function falls back to the `approxLocation` the document already stores — so a
  `gallery-precise-task-location` doc (exact `approxLocation`, no `coordinates`) and a
  `task-library-map-view` doc (coarse `approxLocation`, no `coordinates`) both keep their stored
  point unchanged.
- The `coordinates`, `hideLocation` and `locationless` keys are destructured out, so the served
  payload never carries the deprecated exact coordinate.

## Why reading `hideLocation`/`locationless` off the raw doc is a type-widened read, not a lie

`PublicTask` declares neither flag. They are not, in practice, on any stored document (verified from
git history). The intersection type `PublicTask & { hideLocation?: boolean; locationless?: boolean }`
is a **defensive** read: if a future projection ever writes those flags, the carve-out already
honours them; today they read `undefined` and the behaviour is "serve exact from `coordinates`",
which is correct for every legacy coordinate-only doc (all of which predate `hideLocation`).

## Test strategy (test-first)

- **Pure unit lane** (`functions/src/gallery/index.test.ts`, vitest via `npm test`):
  - a legacy doc whose ONLY location is exact `coordinates` yields a plottable EXACT `approxLocation`
    (round5) — the headline user bug;
  - a coordinates-bearing ordinary doc is served EXACT, not coarsened;
  - a doc flagged `hideLocation` is coarsened to its ~1 km cell (defense-in-depth carve-out);
  - a new-style doc with an exact `approxLocation` and no `coordinates` is kept verbatim;
  - a locationless doc yields no plottable point;
  - the deprecated `coordinates` key is always dropped.
- **E2E lane** (`scripts/e2e-verify.mjs`, additive scenario, run under the emulator via `npm run
  e2e` — NOT run in this change's authoring): publish a real game, simulate the pre-fix on-disk
  shape with the Admin SDK (exact `coordinates`, `approxLocation` deleted), then assert
  `searchTaskLibrary` serves that legacy doc an EXACT plottable `approxLocation` and never the raw
  `coordinates` key.

## Alternatives rejected

- **Raise the paging cap to guarantee "all missions".** Rejected as reckless in this lane: it widens
  the per-call Firestore fan-out and the `likedIds` batch read for every caller, and the map/list
  share the call. Documented as a residual instead.
- **Coarsen every legacy coordinate-only doc to be safe.** Rejected: it would re-introduce the exact
  misplacement the user is complaining about for every ordinary (non-hidden) mission, and the hidden
  ones cannot be distinguished at read time anyway (no stored flag). The exact coordinate is already
  world-readable, so coarsening the served value protects nothing while breaking the feature.
