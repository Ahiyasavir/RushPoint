# Tasks — Run analytics & heatmap (RED → GREEN → REFACTOR)

## Pure aggregator

- [ ] **1. RED (pure):** new `scripts/test-run-analytics.ts` — assert `computeRunAnalytics`:
  completion rate; median/p90; hint/skip counts; stage drop-off; prune-safe (cleared team → 0,
  no crash); deterministic regardless of input order. Run `npm test` → fails RED.
- [ ] **2. GREEN:** add `computeRunAnalytics` + `RunAnalytics` type + `compareToPlatformMedian` stub
  to `packages/shared/src/`, export from `index.ts`. Re-run → green.

## Callable

- [ ] **3. RED (e2e):** in `scripts/e2e-verify.mjs` after finalize: owner `getRunAnalytics` →
  expected per-task structure; non-owner → `permission-denied`. Run `npm run e2e` → fails RED.
- [ ] **4. GREEN:** implement `getRunAnalytics` in `functions/src/runs/index.ts` (owner-only,
  finished-run guard, reads `teamsCol`, runs `computeRunAnalytics`). Re-export + wrappers in both
  apps' `services/calls.ts`. Re-run e2e → green.

## Analytics tab UI

- [ ] **5. GREEN (UI):** new Analytics tab in creator-web RunConsole — Pro gate (upsell chip for
  non-Pro); route map with completion-rate colored pins; sortable task table; benchmark arrows.
  Verify via preview tools with mock analytics data.

## Gate

- [ ] **6.** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.
