# Tasks — White-label Pro tier (RED → GREEN → REFACTOR)

> Touches the `share-branding` consumers; land that first.

> **Status:** pure decision core (tasks 1–2) shipped + gate-green. The billing/entitlement sealing
> (3–4) and share-surface wiring + creator panel (5) are DEFERRED — the white-label entitlement is
> granted through the Pro billing path, which is **dark under free mode (`PAYMENTS_ENABLED = false`)**.
> The Run type already carries `whiteLabel`/`brand`, so sealing + wiring drop in when payments return.

- [x] **1. RED (pure):** `scripts/test-run-brand.ts` — `resolveRunBrand`: white-label+brand → creator
  brand + no footer; white-label without brand → RushPoint fallback (no half-branded state); standard →
  RushPoint + footer; null/undefined safe. 13 assertions.
- [x] **2. GREEN:** `resolveRunBrand` + `WhiteLabelEntitlement`/`ResolvedRunBrand` types in
  `packages/shared/src/runBrand.ts`, exported. `Run.whiteLabel`/`Run.brand` added to the type. Green.
- [ ] **3. DEFERRED → billing agent (payments-off):** e2e for launch-with-white-label-wallet sealing.
- [ ] **4. DEFERRED → billing agent (payments-off):** wallet/plan entitlement + white-label SKU; seal in
  `launchRun` from the owner's entitlement (mechanism reads the wallet; grant path is the dark Pro SKU).
- [ ] **5. DEFERRED → frontend agent:** share surfaces call `resolveRunBrand`; creator-web white-label
  settings panel (Pro-gated). (Footer semantics intentionally not rewired yet to avoid regressing the
  current `billingType === 'pro'` footer gate before the entitlement is real.)
- [x] **6. Gate:** `npm run typecheck` · `npm run lint` · `npm test` (13 pure) · `npm run creator:build`
  — all green. (No e2e: sealing deferred.)
