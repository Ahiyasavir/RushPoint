# Tasks — gallery-map-legacy-coarse-repair

Pure-logic + callable-wiring lane (`functions/`). TDD: tests first, then the minimum code to green.

## RED — write the failing tests first

- [x] 1. In `functions/src/gallery/index.test.ts`, add a `describe('legacy-coarse repair …')` block
      with failing tests for `needsLegacyCoarseRepair`, `legacyCoarseRepairKeys`, and
      `resolveLegacyCoarseLocations` per design.md §Test strategy (coordinates-doc skips the lookup;
      coarse-only doc resolves from a mocked game; hideLocation in the template stays coarse;
      missing game/task falls open; fetcher throwing falls open; multiple docs sharing one
      `sourceGameId` fetch the game exactly once). These fail to compile/run until the functions
      below exist.

## GREEN — minimum implementation

- [x] 2. Add `needsLegacyCoarseRepair(t: PublicTask): boolean` to `functions/src/gallery/index.ts`,
      reusing `isCoarsePublicPoint` from `@rushpoint/shared`. (design.md §Detecting a generation-2 doc)

- [x] 3. Add `legacyCoarseRepairKeys(tasks): Array<{ownerUid, sourceGameId}>` — filters to
      `needsLegacyCoarseRepair`, dedupes by `${ownerUid}/${sourceGameId}`. (design.md §Batching)

- [x] 4. Add `LegacyGameFetcher` type + `resolveLegacyCoarseLocations(tasks, getGames)` — recovers
      each target's task id from its doc id (prefix-strip on `sourceGameId`, same technique as
      `backfillPublicTaskCoordinates`), looks it up in the fetched `Game.stages[].tasks[]`, and
      recomputes via `publicTaskLocation(source)`. Fail-open on a thrown fetch, a missing game entry,
      or a missing task. (design.md §Recomputing the exact point, §Fail-open)

- [x] 5. Wire `resolveLegacyCoarseLocations` into `searchTaskLibrary`: batch the injected fetcher via
      a single `db.getAll(...refs)` over `FIRESTORE_PATHS.game(ownerUid, sourceGameId)`, merge
      resolved points onto the already-sanitized `tasks` array by id. (design.md §Wiring)

## REFACTOR / VERIFY (this agent — no emulator, no full `npm run verify`)

- [x] 6. `npx vitest run functions/src/gallery/index.test.ts` — green.
- [x] 7. `npx tsc --noEmit` scoped to `functions/` — no new type errors.
- [x] 8. `npx openspec validate gallery-map-legacy-coarse-repair --strict` — passes.

## Owed (parent / consolidated gate — NOT run by this agent)

- [ ] 9. `npm run verify` and `npm run e2e` — a consolidated gate is owed once concurrent lanes on
      this branch land (per session convention); not run here because another agent owns the build
      lane concurrently.
- [ ] 10. Manual/browser confirmation that the Gallery mission-library map now plots a
       previously-off legacy mission at its true spot — UNVERIFIED here (no UI touched, no emulator
       run).
