# Tasks — Import game from a spreadsheet (RED → GREEN → REFACTOR)

- [ ] **1. RED (pure):** new `scripts/test-import-sheet.ts` — `parseGameRows`: valid rows → stages/tasks;
  unknown type → error; quiz without answer → error; bad coords → error; empty → empty game.
  Run `npm test` → RED.
- [ ] **2. GREEN:** add `parseGameRows` + `RowError` type to `packages/shared/src/` (reuse
  `validation.ts`), export. Re-run → green.
- [ ] **3. GREEN (UI):** Builder "Import" panel — template download; drag-drop → `lib/importSheet.ts`
  (CSV + lazy `xlsx`) → `parseGameRows` → preview + error report; "Create game" → `createGame` +
  `updateGame`. Verify via preview with a sample CSV.
- [ ] **4. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build`.
