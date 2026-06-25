# Tasks — No-signup demo (RED → GREEN → REFACTOR)

- [ ] **1. RED (pure):** new `scripts/test-demo-draft.ts` — `serializeDraft`/`deserializeDraft`
  round-trip; version mismatch → null; `isDraftClaimable` true only for a non-empty valid game.
  Run `npm test` → fails RED.
- [ ] **2. GREEN:** add `apps/creator-web/src/lib/demoDraft.ts` (the three helpers). Re-run → green.
- [ ] **3. GREEN (UI):** AuthGate "Try the Builder" → demo-mode Builder sourced from local draft;
  every edit serializes to localStorage. Verify via preview (edit → refresh → persists).
- [ ] **4. GREEN (UI):** Save/Launch/Publish in demo mode → auth modal → `claimDraft()`
  (`createGame` + `updateGame`) → clear draft. Offer import on signup elsewhere. Verify via preview.
- [ ] **5. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build`.
