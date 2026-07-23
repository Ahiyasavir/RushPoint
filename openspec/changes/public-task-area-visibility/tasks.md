## 1. RED — failing tests first

- [x] 1.1 Extend `packages/shared/src/publicTaskLocation.test.ts` with a `publicTaskMapCoverage`
      block importing the (not-yet-existing) export: empty array ⇒ `no-results`; every item with a
      valid `approxLocation` ⇒ `all-plottable`; no item with one ⇒ `none-plottable`; **a mixed set
      ⇒ `partial`** (the empty state must not apply); a legacy item (exact `coordinates`, no
      `approxLocation`) counted as not plottable; a hidden-location item (writer emitted nothing)
      not plottable; an item with no location at all not plottable; malformed / `NaN` /
      out-of-range / null-island `approxLocation` not plottable; `null`/`undefined` entries
      tolerated.
- [x] 1.2 Create `scripts/test-public-task-seed.ts` in the house style of the other
      `scripts/test-*.ts` scripts (`ok(cond, msg)`, pass/fail counters, `process.exit`). For each of
      `scripts/seed-local.mjs`, `scripts/seed-games-youth.mjs`, `scripts/lib/sansana-game-def.mjs`,
      `scripts/lib/qa-game-def.mjs`: read the source, isolate the `publicTasks/` write block, and
      assert it derives `approxLocation` from `publicTaskLocation` and contains **no**
      `coordinates:` key. Read-only — it must not connect to any emulator.
- [x] 1.3 Run `npx vitest run publicTaskLocation --root packages/shared` and
      `npx tsx scripts/test-public-task-seed.ts`; confirm BOTH fail for the right reasons (missing
      export; seeders still writing `coordinates`). Record the failures.

## 2. GREEN — pure logic

- [x] 2.1 Add `PublicTaskMapCoverage` and `publicTaskMapCoverage()` to
      `packages/shared/src/publicTaskLocation.ts`, implemented over `isPlottablePublicTask` so the
      classifier and the marker filter can never disagree. Export both from the package index if
      the module is not already re-exported wholesale.
- [x] 2.2 Re-run the vitest file; confirm GREEN.

## 3. GREEN — seeded public tasks obey the write rule

- [x] 3.1 `scripts/seed-local.mjs`: import `publicTaskLocation` from `@rushpoint/shared`; in the
      `publicTasks/${GAME_ID}_${t.id}` write, replace `coordinates: t.coordinates` with a spread of
      `approxLocation` when the rule yields one.
- [x] 3.2 Same edit in `scripts/lib/sansana-game-def.mjs` and `scripts/lib/qa-game-def.mjs`,
      deleting the `t.hideLocation ? { lat: 0, lng: 0 } : t.coordinates` improvisation — the shared
      rule already omits the field for a hidden task.
- [x] 3.3 Same edit in `scripts/seed-games-youth.mjs`, which today writes `t.coordinates`
      unconditionally with no `hideLocation` branch at all.
- [x] 3.4 Re-run `npx tsx scripts/test-public-task-seed.ts`; confirm GREEN.

## 4. GREEN — the empty map explains itself

- [x] 4.1 Add `gallery.noLocatedTasksHelp` to BOTH dictionaries in
      `apps/creator-web/src/i18n.ts` (Hebrew in the Hebrew map, English in the English map), with
      the wording fixed in design.md §4.
- [x] 4.2 Add an optional, already-localized `emptyDetail?: string` prop to
      `apps/creator-web/src/components/GalleryMap.tsx`, rendered as a second line inside the
      existing `points.length === 0` overlay. The component gains no domain knowledge.
- [x] 4.3 In `apps/creator-web/src/pages/GalleryPage.tsx`, compute
      `publicTaskMapCoverage(tasks ?? [])` and pass `emptyDetail={gl.noLocatedTasksHelp}` only when
      it is `'none-plottable'`. Leave the games map, the marker filters and `approxPinsNote`
      unchanged. No hardcoded strings.

## 5. REFACTOR / verify

- [x] 5.1 Re-read the read path and confirm no `coordinates` fallback was introduced anywhere
      (`isPlottablePublicTask` still reads only `approxLocation`).
- [x] 5.2 Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`. Record verbatim output.
- [x] 5.3 i18n gates: `npm run i18n:check` (PART A must be clean) and `npm run i18n:check:strict`
      (zero NEW PART B findings). Record verbatim output.
- [x] 5.4 Do NOT run `npm run e2e`, `verify:emulator` or `test:rules`, and do not start/stop any
      emulator, Vite or tunnel process — a live playtest stack is serving from this tree. State
      explicitly in the report what was left unverified as a result (the admin backfill sweep, and
      visual confirmation of the new overlay).
