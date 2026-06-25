# Tasks — Run recap (RED → GREEN → REFACTOR)

> Strict TDD. Pure aggregation first, then the callable (e2e), then the UI (preview).
> Depends on [`share-branding`](../share-branding/tasks.md) for the collage stamp — land that first.

## Pure logic — aggregator + montage grid

- [ ] **1. RED (pure):** new `scripts/test-run-recap.ts` (auto-discovered) — assert `buildRunRecap`
  (standings reuse ranking order; only approved/correct photos included; rejected + pending excluded;
  pruned run ⇒ `photos: []` with standings intact) and `computeMontageGrid` (balanced, in-bounds,
  non-overlapping cells for 1/4/9/20+; overflow cap reported). Run `npm test` → fails RED.
- [ ] **2. GREEN:** add `buildRunRecap` + `computeMontageGrid` + recap result type + the `?recap=`
  route key to `packages/shared/src`, export from `index.ts`. Re-run → green.

## Callable — getRunRecap

- [ ] **3. RED (e2e):** in `scripts/e2e-verify.mjs`, after finalize: owner `getRunRecap` → standings +
  photos; non-owner on an **unpublished** run → `permission-denied`/empty; after `publish`, non-owner
  → public recap; a rejected photo is absent. Run `npm run e2e` → fails RED (callable absent).
- [ ] **4. GREEN:** implement `getRunRecap` in `functions/src/runs/index.ts` (resolve accessCode →
  run like `getPublicLeaderboard`; owner-any / published-only gate; run `buildRunRecap`). Re-export in
  `functions/src/index.ts`; typed wrappers in both apps' `services/calls.ts`. Re-run e2e → green.

## UI — recap screen + branded collage + organizer link

- [ ] **5. GREEN (UI):** new `apps/play-web/src/screens/RunRecap.tsx` + `?recap=<accessCode>` route in
  `App.tsx`; render standings + photo montage. Verify via preview tools.
- [ ] **6. GREEN (UI):** "Share recap" builds the collage (`computeMontageGrid` + `stampBrand` from
  `share-branding`) and shares it; add a post-finalize "Share recap" action in the creator RunConsole
  surfacing the `?recap=` link via the existing ShareSheet. Verify via preview.
- [ ] **7. REFACTOR:** confirm retention path in UI (a pruned run shows standings, empty montage, no
  crash) and that the recap ordering matches the live leaderboard.

## Gate — all green before done
- [ ] **8. Full gate set:** `npm run typecheck` · `npm run lint` · `npm test` (incl. `test-run-recap`)
  · `npm run creator:build` · `npm run e2e` (incl. new `getRunRecap` assertions). Update TECH_SPEC
  Appendix B (new run-recap row) status.
