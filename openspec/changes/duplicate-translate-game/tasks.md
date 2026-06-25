# Tasks — Duplicate & translate a game (RED → GREEN → REFACTOR)

- [ ] **1. RED (pure):** new `scripts/test-translate-fields.ts` — `collectTranslatableFields`
  (finds user-facing text, excludes coords/types) + `applyTranslations` (deterministic re-inject;
  identity round-trip; non-text preserved). Run `npm test` → RED.
- [ ] **2. GREEN:** add `collectTranslatableFields` + `applyTranslations` to `packages/shared/src/`,
  export. Re-run → green.
- [ ] **3. RED (e2e):** in `scripts/e2e-verify.mjs` with a **mocked** translation API — `translateGame`
  creates a new game in the target language; coords/types/scoring identical; original free-text answer
  still accepted. Run `npm run e2e` → RED.
- [ ] **4. GREEN:** implement `translateGame` in `functions/src/games/index.ts` (duplicate + collect +
  translate via server API + apply + write; alias-preserve free-text answers). Re-export + wrappers.
  Re-run e2e → green.
- [ ] **5. GREEN (UI):** Dashboard/Builder "Duplicate & translate" + language picker. Verify via preview.
- [ ] **6. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.
