## Why

The Gallery's **Games** tab has a list/map toggle; the **Tasks** tab does not. A creator browsing
the mission library sees 30 cards with no sense of where anything is, so "show me the missions
around the Old City" is not a question the library can answer. The toggle already exists in
`GalleryPage.tsx:27` and is simply not rendered for `tab === 'tasks'` (`:136`), and `GalleryMap.tsx`
already does everything a task map needs — it is just hard-typed to `PublicGame[]`.

But wiring the map to the data that is there today would be publishing a scouting tool. Establishing
what `publicTasks` actually contains turned up a **live data-exposure bug that predates this change**:

- `publishGame` (`functions/src/games/index.ts:719`) writes `coordinates: task.coordinates` — the
  creator's **exact** authored GPS point — into `publicTasks/{gameId}_{taskId}`.
- `firestore.rules:186-189` grants `allow read: if true` on that collection. The exact coordinates
  of every task in every published game are world-readable, unauthenticated, right now.
- The write applies **unconditionally**, including to `hideLocation` tasks — the tasks whose entire
  design contract is that the location IS the puzzle. This repo treats those coordinates as
  server-secret everywhere else: `sanitizeTaskForParticipant` strips them (`sanitizeTask.ts:40`),
  routing emits `locationHidden` instead of a title (`assignNextTask.ts:209`), the photo feed
  suppresses them (`feedVisibility.ts:36`), the run recap excludes them (`runRecap.ts:42`), and
  `gameFile.ts:28` calls them out by name as an export secret. The public gallery is the one hole.
- The leak is reachable without the map: `TaskLibrary.tsx:19` copies `pt.coordinates` straight into
  a new task, and any client can read the collection directly (`ChallengeTeaser.tsx:41` already does).

So the honest framing is not "add a map, mind the privacy". It is: **the public task library must
first be given a location contract it does not have, and the map is what that contract makes safe.**

## What Changes

**Public tasks publish an approximate area, never a point.**
- A published task carries a coarse, **deterministically derived** area pin — the centre of a fixed
  ~1 km geographic cell containing the task — instead of the authored coordinate. A reader learns
  the neighbourhood, not the doorway. Determinism is the security property, not a convenience: a
  randomly jittered pin can be averaged back to the truth across repeated publishes, a fixed grid
  cannot.
- **A `hideLocation` task publishes no location at all** — not a fuzzed one. Its area is omitted at
  the **write** side, in `publishGame`, so the coordinate never enters a world-readable document.
- **BREAKING (data shape):** `PublicTask.coordinates` stops being written and stops being read.
  Newly published tasks carry `approxLocation` instead. `searchTaskLibrary` strips `coordinates`
  from its response so documents published before this change stop serving exact points through the
  callable, and re-publishing a game rewrites them out of the stored document.
- Copying a task from the library brings its **approximate** area, not the author's exact pin. A
  copied mission is being re-sited anyway; handing over the original GPS fix was the leak.

**The mission library gets a map.**
- The list/map toggle is available on the Tasks tab and plots every **plottable** public task —
  one with an area pin that is present and real. Hidden-location tasks, tasks with no coordinates,
  invalid coordinates, and the null-island `(0, 0)` placeholder that `blankTask()` ships are absent
  from the map because they are absent from the data, not because the renderer skipped them.
- Clicking a marker focuses that task's card, exactly as the games map already does.
- The map states plainly that pins are approximate, so a creator never reads a pin as a location fix.

**Non-goals**
- No new callable. `searchTaskLibrary` carries the field; nothing new needs e2e coverage or a
  typed wrapper beyond the existing one.
- No change to `firestore.rules`. The gallery stays public-read; what is *in* it changes.
- No change to how a task behaves inside a run — private `Task.coordinates`, routing, geofencing
  and arrival checks are untouched. This is purely about the denormalized public projection.
- No backfill script for already-published documents. Stored legacy `coordinates` are neutralised
  through the callable and rewritten on the owner's next publish; a bulk migration is deliberately
  left out of this change and recorded as residual risk in `design.md`.
- No map for `play-web`'s `ChallengeTeaser`, no clustering, no map-driven search filtering.

## Capabilities

### New Capabilities
- `public-task-location-privacy`: what location data the public task library is permitted to
  publish and expose — approximate-area-only for ordinary tasks, nothing at all for
  hidden-location tasks, enforced where the document is written rather than where it is rendered.
- `task-library-map`: the mission library's map view — which public tasks are plottable, how the
  map view is reached from the Tasks tab, and how selecting a marker relates to the card list.

### Modified Capabilities
None. No existing spec in `openspec/specs/` governs the public gallery or the `publicTasks`
projection; `map-provider` governs tile/style resolution, which this change consumes unchanged.

## Impact

- **Surfaces touched:** `packages/shared` (types + a new pure module), a **callable's response
  shape** (`searchTaskLibrary`) and a callable's **write** (`publishGame`) — both existing, neither
  new — and `apps/creator-web`. No `play-web` change, no `firestore.rules` change, no new index,
  no new env var.
- **Files:** `packages/shared/src/publicTaskLocation.ts` (new) + `src/types/index.ts` +
  `src/index.ts`; `functions/src/games/index.ts` (publish projection);
  `functions/src/gallery/index.ts` (response strip); `apps/creator-web/src/components/GalleryMap.tsx`
  (generalised over a marker shape), `src/pages/GalleryPage.tsx`, `src/components/TaskLibrary.tsx`,
  `src/i18n.ts` (both dictionaries).
- **Capability removed:** copying a library task no longer transfers the author's exact GPS point.
  That is the intended fix, not a regression — it is the same exposure by another route.
- **Risk:** documents published before this change keep a stored `coordinates` field until their
  owner re-publishes. The callable no longer returns it, but a direct Firestore read of
  `publicTasks` still sees it. Sized and accepted in `design.md` §Residual risk.
- **Testing:** the plottability predicate and the area-derivation function are pure and land in
  `packages/shared` with a co-located vitest file in the existing `npm test` lane — including a
  test that the derivation is stable across repeated calls (the anti-averaging property) and one
  that a `hideLocation` task derives nothing. No emulator needed for either.
