# Tasks — Podium moment (RED → GREEN → REFACTOR)

> Depends on [`share-branding`](../share-branding/tasks.md) for the share stamp.

- [ ] **1. RED (pure):** new `scripts/test-podium.ts` — `selectPodium` (top-3 mapping, <3 teams,
  myPlacement) + `computePodiumLayout` (ordered heights, centered, in-bounds). Run `npm test` → RED.
- [ ] **2. GREEN:** add `selectPodium` + `computePodiumLayout` to `packages/shared/src/`, export.
  Re-run → green.
- [ ] **3. GREEN (UI):** podium reveal in `FinalScreen.tsx` (CSS rise + confetti; reduced-motion →
  instant). Verify via preview.
- [ ] **4. GREEN (UI):** "Share podium" builds the branded podium image via `stampBrand`. Verify via
  preview.
- [ ] **5. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build`.
