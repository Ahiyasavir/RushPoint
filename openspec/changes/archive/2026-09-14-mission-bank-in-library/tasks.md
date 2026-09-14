## 1. Pure module — RED

- [x] 1.1 Create `scripts/test-library-bank-rows.ts` with failing assertions for
  `apps/creator-web/src/lib/libraryBankRows.ts` (not yet created):
  - `bankEntryToLibraryRow` on a fixture entry whose `build()` sets
    `smart.secretCode`, `answers`, `numericAnswer`, `hint`, `steps[].answer`,
    real `coordinates` → the returned row has none of those keys anywhere
    (deep sweep, mirroring `scripts/test-shared-game-view.ts`), has
    `bankKey === entry.key`, `id === 'bank:' + entry.key`, and copies
    title/description/type/difficulty/estimatedMinutes/pointValue/tags.
  - `bankEntryToLibraryRow` on an entry whose `build()` throws → returns
    `null`, does not throw.
  - `mergeLibraryRows`: a bank row with the same normalized title + type as a
    published row is dropped; different type or title is kept.
  - `mergeLibraryRows` ranking: empty query → a published row with
    copies/likes precedes a bank row; query matching a bank title → that bank
    row precedes a weaker-matching published row.
  - `applyBankRowFacets`: `hasLocation:'on'` drops all bank rows;
    `hasLocation:'off'` keeps them; `type` / `difficulty` (>=) / `tags` filter
    on the row's own fields.
  Run `node --import tsx scripts/test-library-bank-rows.ts` and confirm it fails
  because the module does not exist.

## 2. Pure module — GREEN

- [x] 2.1 Create `apps/creator-web/src/lib/libraryBankRows.ts` implementing
  `LibraryRow`, `bankEntryToLibraryRow`, `normalizeTitle`, `mergeLibraryRows`
  (dedupe + `rankGalleryResults` from `@rushpoint/shared`), `applyBankRowFacets`.
  Pure, total, no React. Wrap the single `entry.build()` in try/catch.
- [x] 2.2 Run `node scripts/run-unit-tests.mjs` (or the single file) — new suite
  green, no other suite regressed.

## 3. Builder TaskLibrary mount

- [x] 3.1 `TaskLibrary.tsx`: in `run()`, `await loadMissionBank()` in parallel
  with `searchTaskLibrary`; hold the entry list in a ref/state; render
  `mergeLibraryRows(tasks, bankRows, q)`.
- [x] 3.2 `pick(row)`: if `row.bankKey`, resolve the entry from the held list and
  `onInsert(entry.build())`, `onClose()`, **no** `incrementTaskCopyCount`;
  else unchanged (`libraryTaskToTask` + `incrementTaskCopyCount`).
- [x] 3.3 Row rendering: show the provenance badge when `row.bankKey` is set;
  copy-count / source-game line only for real rows. Detail modal `onUse` routes
  through `pick`.
- [x] 3.4 Manual check via preview: open the Builder task library on a project
  with zero `publicTasks` → bank missions listed; insert one → stage gets a
  fresh built task; search a bank title → it ranks up.

## 4. Gallery task tab mount

- [x] 4.1 `GalleryPage.tsx` task branch of `run()`: same `loadMissionBank()` +
  merge; apply `applyBankRowFacets` for the active facets and fold `taskSort`
  into the merged order.
- [x] 4.2 Hide the like control when `row.bankKey` is set; detail modal opens on
  a bank row (no `onUse` — Gallery has no target game).
- [x] 4.3 Bank rows carry no `approxLocation`, so they must not appear as map
  pins and must not affect `publicTaskMapCoverage` — confirm the existing
  `isPlottablePublicTask` filter already excludes them (it checks
  `approxLocation`); add a guard/test note if not.
- [x] 4.4 Manual check via preview: Gallery → task tab shows bank missions;
  facets (`type`, `difficulty`, `hasLocation`, `tags`) behave; detail modal
  renders; no like button on bank rows.

## 5. i18n

- [x] 5.1 Add the provenance badge key to both `apps/creator-web/src/i18n.ts`
  language maps (`he` + `en`), route the label through `t.*`. No other visible
  literal introduced.
- [x] 5.2 `npm run i18n:check:strict` — clean, zero new PART B findings.

## 6. Gates

- [x] 6.1 `npm run typecheck` · `npm run lint` · `npm test` (incl. the new
  `test-library-bank-rows` suite) · `npm run creator:build` ·
  `npm run i18n:check:strict` — all green.
- [x] 6.2 `npm run play:build` · `npm run bundle:budget` · `npm run base:check` ·
  `npm run origin:check` — all green. NOTE: `npm run verify` as a whole has ONE
  red gate, `check-marketing-output` (`MARKETING OUTPUT TESTS FAILED :: 7 of 273`),
  failing on the untracked `apps/marketing/public/_kit-b83f9d2e/` template kit
  (someone's in-flight marketing work, present at session start per `git status`).
  Entirely outside this change (creator-web only, no marketing file touched);
  reproduces on a tree without these edits.
- [x] 6.3 No `functions/` change, so `npm run e2e` is not required by this
  change; note it in the archive if skipped.
