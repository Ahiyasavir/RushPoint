# Tasks — Duplicate & translate a game (RED → GREEN → REFACTOR)

- [x] **1. RED (pure):** new `scripts/test-translate-fields.ts` — `collectTranslatableFields`
  (finds user-facing text, excludes coords/types) + `applyTranslations` (deterministic re-inject;
  identity round-trip; non-text preserved). Run `npm test` → RED.
- [x] **2. GREEN:** add `collectTranslatableFields` + `applyTranslations` to `packages/shared/src/`,
  export. Re-run → green.
- [x] **3. RED (e2e):** in `scripts/e2e-verify.mjs` with a **mocked** translation API — `translateGame`
  creates a new game in the target language; coords/types/scoring identical; original free-text answer
  still accepted. Run `npm run e2e` → RED.
- [x] **4. GREEN:** implement `translateGame` in `functions/src/games/index.ts` (duplicate + collect +
  translate via translator (mock prefix; real API needs TRANSLATE_API_KEY — deferred to infra) + apply + write; alias-preserve free-text answers). Re-export + wrappers.
  Re-run e2e → green.
- [ ] **5. DEFERRED → frontend agent (creator-web "Duplicate & translate" action + language picker):** Dashboard/Builder "Duplicate & translate" + language picker. Verify via preview.
- [x] **6. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.
