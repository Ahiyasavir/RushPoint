# Tasks — Free mode (payments off) (RED → GREEN → REFACTOR)

> Sets payments aside behind one flag — no billing code is deleted.

## Pure flag + resolvers

- [ ] **1. RED (pure):** new `scripts/test-free-mode.ts` — `resolveLaunchBilling` (payments off →
  free + consume 'none'; payments on → existing pro/free-run/credit/refuse) and `isFeatureUnlocked`
  (off → always true; on → per-feature Pro gate). Run `npm test` → RED.
- [ ] **2. GREEN:** add `PAYMENTS_ENABLED` (= false) + `resolveLaunchBilling` + `isFeatureUnlocked`
  + `FREE_MODE_MAX_PARTICIPANTS` to `packages/shared/src/`, export. Re-run → green.

## Backend wiring

- [ ] **3. RED (e2e):** in `scripts/e2e-verify.mjs` (payments off) — a 0-credit free-plan creator
  launches a run successfully with no wallet decrement; `purchaseCredits`/`subscribePro` →
  `failed-precondition`. Run `npm run e2e` → RED.
- [ ] **4. GREEN:** `launchRun` uses `resolveLaunchBilling` (skip the wallet transaction when
  `consume === 'none'`); `purchaseCredits`/`subscribePro` reject when `!PAYMENTS_ENABLED`;
  `stripeWebhook` no-op; `getWalletStatus` reports `paymentsEnabled`. Re-run e2e → green.

## Client wiring

- [ ] **5. GREEN (UI):** gate `WalletPage` route, pricing, "buy"/"upgrade" copy + CTAs (`i18n.ts`,
  `RunConsolePage`, nav) on `PAYMENTS_ENABLED`; Pro-gated surfaces (#49/#58/#59) read
  `isFeatureUnlocked`; play-web finish footer drops the upsell. Verify via preview — no payment
  visible anywhere; Pro features open.

## REFACTOR + Gate

- [ ] **6. REFACTOR:** confirm flipping `PAYMENTS_ENABLED = true` in a local build restores the wallet
  page, the launch billing, and the Pro gates (sanity check, then flip back to false).
- [ ] **7. Full gate set:** `npm run typecheck` · `npm run lint` · `npm test` ·
  `npm run creator:build` · `npm run e2e`. Update TECH_SPEC Appendix B.
