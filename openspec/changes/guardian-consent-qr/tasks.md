# Tasks — Guardian consent via QR (RED → GREEN → REFACTOR)

- [ ] **1. RED (pure):** new `scripts/test-guardian-consent.ts` — `isConsentSatisfied`: not required →
  true; required + no record → false; required + record → true. Run `npm test` → RED.
- [ ] **2. GREEN:** add `isConsentSatisfied` + `ConsentRecord` + `Game.requiresGuardianConsent`/`minAge`
  to `packages/shared/src/`, export. Re-run → green.
- [ ] **3. RED (e2e):** in `scripts/e2e-verify.mjs` — consent-required run: team cannot start until
  `grantGuardianConsent`; used/invalid token refused; non-consent run starts normally. `npm run e2e` → RED.
- [ ] **4. GREEN:** implement `requestGuardianConsent` + `grantGuardianConsent` in
  `functions/src/runs/index.ts`; gate `startTeams`/play on `isConsentSatisfied`. Re-export + wrappers.
  Re-run e2e → green.
- [ ] **5. GREEN (UI):** consent-required screen (QR + link); public `?consent=<token>` guardian page.
  Verify via preview.
- [ ] **6. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.
