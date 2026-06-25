# Tasks — Live emoji reactions (RED → GREEN → REFACTOR)

> Depends on the RTDB migration (Appendix B #2) for the realtime backend.

- [ ] **1. RED (pure):** new `scripts/test-reaction-throttle.ts` — `shouldThrottleReaction`
  (first allowed; within-gap throttled; after-gap allowed; null last allowed). Run `npm test` → RED.
- [ ] **2. GREEN:** add `shouldThrottleReaction` + `REACTION_EMOJI` to `packages/shared/src/`, export.
  Re-run → green.
- [ ] **3. GREEN (UI):** reaction bar + floating renderer on the leaderboard / `?tv=` screen;
  RTDB `push` + `onChildAdded` subscription; throttle on tap; `prefers-reduced-motion` fade.
  Verify via preview.
- [ ] **4. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build`.
