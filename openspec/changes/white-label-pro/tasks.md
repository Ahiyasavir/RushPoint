# Tasks — White-label Pro tier (RED → GREEN → REFACTOR)

> Touches the `share-branding` consumers; land that first.

- [ ] **1. RED (pure):** new `scripts/test-run-brand.ts` — `resolveRunBrand`: white-label+brand →
  creator brand + no footer; white-label without brand → RushPoint fallback; standard → RushPoint +
  footer. Run `npm test` → RED.
- [ ] **2. GREEN:** add `resolveRunBrand` + the entitlement/brand types to `packages/shared/src/`,
  export. Re-run → green.
- [ ] **3. RED (e2e):** in `scripts/e2e-verify.mjs` — launch with a white-label wallet → `run.whiteLabel`
  true + brand sealed; standard wallet → footer shown; client cannot fake it. Run `npm run e2e` → RED.
- [ ] **4. GREEN:** extend the wallet/plan entitlement + billing (white-label SKU); seal in `launchRun`.
  Re-export + wrappers. Re-run e2e → green.
- [ ] **5. GREEN (UI):** share surfaces (footer, storyCard, recap, podium) call `resolveRunBrand`;
  creator-web white-label settings panel (Pro-gated). Verify via preview.
- [ ] **6. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.
