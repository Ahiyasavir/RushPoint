## Context

`searchTaskLibrary` (`functions/src/gallery/index.ts`) serves the creator Gallery's mission-library
map. It ranks a window of `publicTasks` docs and, since `gallery-map-serve-exact`, maps each through
`publicTaskForLibrary`, which calls `publicTaskLocation({hideLocation, locationless, coordinates})`
on the raw stored doc. Three generations of `publicTasks` doc exist in the field (documented in
`publicTaskForLibrary`'s own comment):

1. **pre-`task-library-map-view`** — exact `coordinates`, no `approxLocation`. Fixed: recomputed
   exact from `coordinates` on every read.
2. **`task-library-map-view` era** — coarse `approxLocation`, **no `coordinates`**. NOT fixed by the
   existing recompute (nothing to recompute from) — `publicTaskLocation` returns `undefined` and the
   stale coarse point is served as-is. **This is the gap this change closes.**
3. **`gallery-precise-task-location` era and later** — exact `approxLocation`, no `coordinates`.
   Already correct, kept verbatim.

Generation 2 is the persistent user complaint: those missions plot, but up to ~1 km off, which reads
as "not accurate."

## The fix

### Detecting a generation-2 doc

```ts
export function needsLegacyCoarseRepair(t: PublicTask): boolean {
  if (t.coordinates !== undefined && t.coordinates !== null) return false; // gen 1, already handled
  return isCoarsePublicPoint(t.approxLocation); // gen 3 is already exact ⇒ isCoarsePublicPoint false
}
```

Reuses `isCoarsePublicPoint` from `packages/shared/src/publicTaskLocation.ts` — the same structural
"is this point on the public grid" test the reader already uses elsewhere (`publicTaskMapCoverage`
does not use it, but the rule is: coarse iff `approximatePublicPoint` is a no-op on the stored
point). This is a total, pure predicate: never throws, treats absent/malformed points as "not
coarse" (nothing to upgrade).

### Batching the game-template lookup

A creator's public task list is frequently mostly-one-game or a handful of games, and the fix must
not turn a 100-doc `searchTaskLibrary` response into up to 100 sequential Firestore reads.

```ts
export function legacyCoarseRepairKeys(
  tasks: ReadonlyArray<PublicTask>,
): Array<{ ownerUid: string; sourceGameId: string }>
```

Filters to `needsLegacyCoarseRepair` docs, then dedupes by `${ownerUid}/${sourceGameId}` (the two
fields `publishGame` already denormalizes onto every `PublicTask`, per
`functions/src/games/index.ts`'s publish projection). The production wiring turns these keys into a
**single** `db.getAll(...refs)` batched read (mirrors the existing `likedIdsFor` helper's pattern in
the same file), not N sequential `.get()` calls.

```ts
export type LegacyGameFetcher = (
  keys: ReadonlyArray<{ ownerUid: string; sourceGameId: string }>,
) => Promise<Map<string, Game | undefined>>; // key = `${ownerUid}/${sourceGameId}`

export async function resolveLegacyCoarseLocations(
  tasks: ReadonlyArray<PublicTask>,
  getGames: LegacyGameFetcher,
): Promise<Map<string, GeoPoint>>
```

The Firestore I/O is **injected** as `getGames`, so `resolveLegacyCoarseLocations` itself is
unit-testable with a mock — no emulator needed — matching the codebase's existing pattern of
extracting pure/injectable logic out of callables (e.g. `backfillPublicTaskCoordinates`'s per-page
`gameCache`, `publicTaskBackfill.ts`'s `repairPublicTask`).

Cost profile: **zero** extra reads for a page of already-precise docs (the common case going
forward, since `publishGame` has written exact points since `gallery-precise-task-location`); at most
one read per distinct source game for the legacy tail, regardless of how many of that game's tasks
appear in the result window.

### Recomputing the exact point (and keeping hideLocation coarse)

For each target doc: recover the task id from the public doc id (`${sourceGameId}_${taskId}`, same
prefix-strip the existing `backfillPublicTaskCoordinates` sweep already uses — split on the KNOWN
prefix length, never on `_`, since a task id may itself contain underscores), find that task inside
the fetched `Game.stages[].tasks[]`, and — if found — recompute with the **same shared writer rule**:

```ts
const loc = publicTaskLocation(source); // { hideLocation, locationless, coordinates } on the authored Task
if (loc) out.set(t.id, loc);
```

`publicTaskLocation` is not reimplemented or forked: a `hideLocation` task in the template still
coarsens to its ~1 km cell exactly as a fresh `publishGame` would write it, so this lookup can only
ever upgrade a stored point to what a re-publish would already have produced — never leak a puzzle
answer that the existing write-path contract protects.

### Fail-open

Three independent points fail open, each falling back to "doc keeps its stored coarse
`approxLocation`, unchanged":

1. `getGames` itself throwing (e.g. `DEADLINE_EXCEEDED`) — caught, returns an empty result map for
   the whole batch.
2. The fetched game map has no entry / `undefined` for a key (deleted game, or the owner's game
   subtree is gone) — that doc's target is skipped.
3. The task id is not found inside `stages[].tasks[]` (task deleted from the game since publish) —
   skipped.

None of these throw out of `resolveLegacyCoarseLocations`; the caller always gets a (possibly empty)
map back and merges only present entries onto the already-computed `tasks` array. No document is
ever dropped from the response because of a failed lookup.

### No write-back

This is a read-path-only repair. `resolveLegacyCoarseLocations` returns values in memory for THIS
response; nothing is written to `publicTasks`. The existing `backfillPublicTaskCoordinatesNow` /
`npm run backfill:public-tasks` sweep remains the permanent, persisted repair — unchanged, unrelated
by mechanism (this uses the game template as the source; the sweep separately reconciles the stored
`coordinates`/`approxLocation` pair via `repairPublicTask`).

### Wiring into `searchTaskLibrary`

```ts
const tasks = ranked.map((raw) => publicTaskForLibrary(raw));
const legacyFixes = await resolveLegacyCoarseLocations(ranked, async (keys) => {
  const refs = keys.map((k) => db.doc(FIRESTORE_PATHS.game(k.ownerUid, k.sourceGameId)));
  const snaps = await db.getAll(...refs);
  const byKey = new Map<string, Game | undefined>();
  keys.forEach((k, i) => byKey.set(`${k.ownerUid}/${k.sourceGameId}`,
    snaps[i].exists ? (snaps[i].data() as Game) : undefined));
  return byKey;
});
for (const t of tasks) {
  const fixed = legacyFixes.get(t.id);
  if (fixed) t.approxLocation = fixed;
}
```

Applied to `ranked` (the raw `PublicTask` docs, which still carry `ownerUid`/`sourceGameId`) rather
than the already-sanitized `tasks`, then merged onto `tasks` by id — `publicTaskForLibrary` already
strips `coordinates`/`hideLocation`/`locationless` from its output, so the detection/lookup must run
against the raw doc.

## Out of scope (explicitly, and why)

- **The `HARD_CAP = 100` truncation.** `searchTaskLibrary`'s `fetchSize` is capped at 100 docs, so a
  creator with more than 100 public missions has some silently absent from every search result
  regardless of location accuracy. This is a plausible second contributor to "missing some
  missions," but fixing it means real pagination (cursor-based `searchTaskLibrary`), a materially
  larger change touching the Gallery UI's fetch-more affordance too. Left as a follow-up; noted here
  so it isn't lost.
- **Reworking `publicTaskForLibrary` itself.** Its existing three-generation handling (see its own
  doc comment) is correct for generations 1 and 3; this change only adds the missing generation-2
  branch as a second pass, rather than restructuring the first.

## Test strategy

Pure-logic lane. New `vitest` unit tests in `functions/src/gallery/index.test.ts`, following the
existing `describe('publicTaskForLibrary — …')` block's style (a `baseTask()` builder,
`approximatePublicPoint` from `@rushpoint/shared` for coarse fixtures):

- a doc with `coordinates` never triggers a game lookup (`needsLegacyCoarseRepair` false, and
  `resolveLegacyCoarseLocations`'s injected fetcher asserted NOT called);
- a doc with no `coordinates` and a coarse stored `approxLocation` resolves the exact point from a
  mocked game template;
- the same, but the template task has `hideLocation: true` — resolved point stays coarse
  (`approximatePublicPoint` of the true point), never the exact point;
- a missing/deleted game (map has no entry, or entry is `undefined`) — no output entry, no throw;
  same for a task absent from the fetched game's stages;
- the injected fetcher throwing — `resolveLegacyCoarseLocations` resolves to an empty map, never
  rejects;
- multiple docs sharing one `sourceGameId` — the injected fetcher (`vi.fn`) is asserted called
  exactly once, and both docs still resolve correctly, proving the dedupe/batching;
- a doc already at generation 3 (exact `approxLocation`, no `coordinates`) is not flagged.

No emulator needed for this lane — the Firestore read is injected. Callable-level wiring
(`searchTaskLibrary`'s `db.getAll` call) is exercised indirectly by the existing e2e/callable-coverage
suite, which already invokes `searchTaskLibrary`; a dedicated e2e assertion is not added by this
change (out of scope per the task brief — no e2e/emulator work here) but the existing suite will
still cover that the callable itself doesn't regress structurally at gate time.
