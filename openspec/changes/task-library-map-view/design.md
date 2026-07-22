## Context

Two things are true at once and the design has to hold both.

1. `GalleryMap.tsx` is already 95% of a task map. It resolves the tile style via `resolveMapStyle`
   (shared with the rest of the platform), mounts MapLibre once, rebuilds HTML markers on data
   change, frames the result set, and carries `MapModeToggle`. The only reason it cannot plot tasks
   is that its props say `games: PublicGame[]` and its body reaches into `g.approxLocation`,
   `g.title`, `g.stageCount`, `g.playCount`.
2. The data it would plot is not safe to publish. Established by reading the write path, not assumed:

   | Question | Answer, verified |
   |---|---|
   | What location does `publicTasks` carry today? | `coordinates: GeoPoint` — **required** on the type (`types/index.ts:594`), written as `coordinates: task.coordinates` (`games/index.ts:719`). The creator's exact authored point. |
   | Is it fuzzed? | No. `PublicGame.approxLocation` is a **creator-authored** field passed through verbatim (`games/index.ts:254`, `:683`) — the platform has no coarsening function at all today. |
   | Who can read it? | Anyone. `firestore.rules:186-189` — `allow read: if true`, no auth. |
   | Are `hideLocation` tasks excluded? | **No.** The publish loop iterates `game.stages.flatMap(s => s.tasks)` with no filter. |

So the exposure exists today, independent of any map, and reaches the world through three doors:
the public rules read, the `searchTaskLibrary` response, and `TaskLibrary.tsx:19` copying
`pt.coordinates` into a new task. Fixing only the door the map opens would be theatre.

## Goals / Non-Goals

**Goals**
- Give `publicTasks` a location contract: approximate area only, nothing for hidden tasks, enforced
  at the write.
- Put the plottability decision and the coarsening in pure, tested functions in `packages/shared`.
- Reach the map by generalising `GalleryMap`, not by cloning it.

**Non-Goals**
- No new callable (so no `e2e-verify.mjs` coverage-guard obligation, no new `calls.ts` wrapper).
- No `firestore.rules` edit, no new composite index, no new env var.
- No change to private `Task.coordinates` or to any in-run behaviour (routing, geofence, arrival).
- No bulk backfill of already-published documents — see §Residual risk.

## Decisions

### D1 — Coarsen by grid snap, not by random jitter

`approximatePublicPoint({lat, lng})` returns the **centre of the fixed ~1 km cell containing the
input**, on a global grid anchored at `(0, 0)`:

```
cell = 0.01°                       // ~1.11 km of latitude; ≤ that in longitude at any latitude
out.lat = floor(lat / cell) * cell + cell / 2
out.lng = floor(lng / cell) * cell + cell / 2
```
rounded to 5 decimals to keep the stored value free of float dust.

Why a grid and not `lat + (random − 0.5) * δ`: jitter is **not** a privacy control against an
observer who can make the publisher re-publish. Each republish is an independent sample around the
true point, and the mean of N samples converges on it — so a jittered pin leaks the exact location
to anyone patient enough to poke the publish button. A grid snap is a pure function of the input, so
every publish returns the identical value and N observations carry exactly as much information as
one. That is the property `specs/public-task-location-privacy` states normatively and the property
the test asserts.

The guarantee it makes, stated exactly so the test can encode it: the output is a multiple of
`cell` offset by `cell/2`, and each output axis is within `cell/2` of its input axis. An observer
learns which ~1 km cell the task is in and nothing finer. It does **not** claim k-anonymity — two
tasks in the same cell collapse to the same pin, and one task alone in a cell is still narrowed only
to that cell. For an ordinary task whose location is not the puzzle, a 1 km cell is the right trade:
useful for "what is near the Old City", useless for walking up to the answer.

**Anchored at `(0,0)`, not at the task**: a per-task anchor would be another way to leak — the cell
boundaries themselves would encode the true point.

### D2 — Exclusion is a write-side omission, not a filtered read

In `publishGame`, `hideLocation` tasks and tasks without a usable coordinate simply do not get an
`approxLocation` key. The field is optional; the document is written without it. This is stated as
a requirement rather than left to the renderer because a renderer-side filter protects only readers
who use our renderer, and `publicTasks` is world-readable by rule — a `curl` is a reader.

Both conditions are folded into one shared function so the publish path cannot drift from the map:

```ts
publicTaskLocation(task): GeoPoint | undefined   // shared — undefined for hidden / unplaced / (0,0)
isPlottablePublicTask(pt): boolean               // shared — the map's predicate over PublicTask
```

`publicTaskLocation` is the writer's rule; `isPlottablePublicTask` is the reader's rule. They are
separate functions on purpose (one takes a private `Task`, one takes a `PublicTask`) but they share
the same coordinate-usability test, so a task the writer refuses to locate is a task the reader
refuses to plot.

### D3 — `(0, 0)` is excluded explicitly, because `isValidCoord` accepts it

`isValidCoord(0, 0)` returns `true` (`geo.ts:14-25` — it is a pure range check). And `blankTask()`
ships `coordinates: {lat: 0, lng: 0}` as its placeholder (noted in `builder-first-task-flow`'s
proposal). So "unplaced" tasks pass `isValidCoord` and would plot as a cluster in the Gulf of
Guinea. Null island is rejected by name in the usability test, and that is a named test case rather
than an incidental behaviour.

### D4 — `coordinates` is deprecated on the type, and stripped in the response

Removing the field outright would break reads of documents already in Firestore. Instead:
`PublicTask.coordinates` becomes `coordinates?: GeoPoint` marked deprecated with a comment naming
this change, `approxLocation?: GeoPoint` is added, and nothing in the codebase reads `coordinates`
any more. `searchTaskLibrary` deletes the key from each ranked result before returning, so the
callable stops serving legacy exact points immediately rather than waiting for republish.

### D5 — Generalise `GalleryMap` over a marker shape

`GalleryMap` takes `points: MapPoint[]` where

```ts
type MapPoint = { id: string; lat: number; lng: number; title: string; subtitle?: string };
```

plus `onSelect(id)`, `emptyLabel`, an optional `notice`, and `markerColor`. The two callers build
their own `MapPoint[]` — the games caller from `approxLocation` + the existing
`stages/plays` subtitle, the tasks caller from `approxLocation` + a type/points subtitle. All
filtering happens in the caller's mapping step (games keep `isValidCoord`; tasks use
`isPlottablePublicTask`), so the map component holds no domain knowledge and there is no second map
component to keep in sync. The `notice` prop carries D6's approximation caption.

Lazy loading is unchanged: `GalleryMap` stays behind whatever import boundary it has today and
nothing new pulls MapLibre into the eager graph. The tasks map is the *same* component, so the
~500 KB chunk is shared, not duplicated.

### D6 — Say the pins are approximate

A creator who sees a pin will believe it. The map carries a short caption stating that task pins
show an approximate area. This is a correctness affordance, not decoration — it is what stops the
1 km cell from being misread as a location fix.

### D7 — Copying seeds from the approximate area

`TaskLibrary.toTask` reads `pt.approxLocation` and leaves `coordinates` unset when it is absent.
A copied task then flows through the Builder's normal "needs placement" path. Losing the exact pin
on copy is the point: the copy path was the second door onto the same secret.

## Files to touch

| File | Change |
|---|---|
| `packages/shared/src/publicTaskLocation.ts` | **New.** `approximatePublicPoint`, `publicTaskLocation`, `isPlottablePublicTask`, `PUBLIC_LOCATION_CELL_DEG`. |
| `packages/shared/src/publicTaskLocation.test.ts` | **New.** The RED tests. |
| `packages/shared/src/index.ts` | Re-export the new module. |
| `packages/shared/src/types/index.ts` | `PublicTask.coordinates` → optional + deprecated; add `approxLocation?`. |
| `functions/src/games/index.ts` | `publishGame` writes `approxLocation` via `publicTaskLocation(task)`; drops `coordinates`. |
| `functions/src/gallery/index.ts` | `searchTaskLibrary` strips `coordinates` from each result. |
| `apps/creator-web/src/components/GalleryMap.tsx` | Generalise to `MapPoint[]` + `notice`. |
| `apps/creator-web/src/pages/GalleryPage.tsx` | Toggle rendered for both tabs; tasks map; reset `focusId` on tab change; task card ids + focus ring. |
| `apps/creator-web/src/components/TaskLibrary.tsx` | `toTask` seeds from `approxLocation`. |
| `apps/creator-web/src/i18n.ts` | New `gallery.*` keys in **both** dictionaries. |

Firestore paths continue to come from `FIRESTORE_PATHS.publicTask`. No `.set({merge})` and no
dotted-key write is introduced — `publishGame` already `set`s the whole document.

## Test strategy

**Pure logic — `packages/shared/src/publicTaskLocation.test.ts` (vitest, in `npm test`, no emulator).
Written first, run, confirmed RED.**

`approximatePublicPoint`
- Output axes are each within `cell/2` of the input axes, for a spread of inputs including negative
  latitudes and longitudes (floor-toward-negative-infinity is where a naive `trunc` breaks).
- Output is on the grid: `(out.lat − cell/2) / cell` is an integer, same for longitude.
- **Determinism / anti-averaging:** calling it 50 times on the same input returns 50 identical
  values, so repeated observation yields no new information.
- Two inputs in the same cell produce the same output; the function is not injective.
- Output is a valid coordinate for inputs at the range extremes (±90, ±180).

`publicTaskLocation` (the writer's rule)
- A `hideLocation` task with perfectly valid coordinates ⇒ `undefined`. **The headline test.**
- A `hideLocation` task ⇒ `undefined` even when it also has a clue, a trigger mode, etc.
- An ordinary located task ⇒ the coarsened point, never the input point (asserted by inequality
  against a deliberately off-grid input, so a pass-through implementation fails).
- Missing coordinates, `NaN`, out-of-range, and `(0, 0)` ⇒ `undefined`.

`isPlottablePublicTask` (the reader's rule)
- `approxLocation` absent ⇒ false.
- `approxLocation` invalid or `(0, 0)` ⇒ false.
- A legacy document carrying an exact `coordinates` and **no** `approxLocation` ⇒ **false** — the
  reader must not fall back onto the field this change exists to stop using.
- A valid `approxLocation` ⇒ true.

**Callable behaviour.** No new callable, so the coverage guard is unaffected. `publishGame` and
`searchTaskLibrary` change shape, which is emulator territory: two assertions belong in
`scripts/e2e-verify.mjs` — publish a game with one hidden and one ordinary task, then assert the
hidden task's `publicTasks` document has neither location field and the ordinary one's
`approxLocation` differs from the authored coordinate; and assert no `searchTaskLibrary` result
carries `coordinates`. **These will be authored but NOT executed in this change — the emulator is
not being started here. They ship UNVERIFIED and must be run before this change is archived.**

**UI.** No component test runner. Verification is `npm run i18n:check` (hard gate: PART A parity and
Hebrew purity for the new `gallery.*` keys) plus a preview pass: Tasks tab → map toggle appears →
markers render → marker click focuses the card → the approximation notice is visible → switching
tabs clears the focus ring. Strings go through `t.*` in both dictionaries; no hardcoded literal is
added, so `i18n:check:strict` gains no new PART B finding.

## Residual risk

Documents published before this change keep their stored `coordinates` until their owner
re-publishes. `searchTaskLibrary` no longer returns the field, and the map never reads it, so both
of RushPoint's own doors are closed — but `publicTasks` is `allow read: if true`, so a direct
Firestore read still sees the legacy value. Closing that fully requires either a one-time backfill
over `publicTasks` or a rules change, both deliberately out of scope here. This is recorded as a
known gap rather than quietly ignored, and it is strictly better than today: the leak stops growing
immediately and drains as creators republish.
