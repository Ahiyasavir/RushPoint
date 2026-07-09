# Tasks — Platform benchmark (RED → GREEN → REFACTOR)

> Feeds the analytics dashboard from [`run-analytics-heatmap`](../run-analytics-heatmap/tasks.md).

- [x] **1. RED (pure):** new `scripts/test-benchmark.ts` — `mergeBenchmark` (init from null; rolling
  update; count increments) + `benchmarkIndicator` (faster/slower/on_par/unknown thresholds).
  Run `npm test` → RED.
- [x] **2. GREEN:** add `mergeBenchmark` + `benchmarkIndicator` + benchmark types to
  `packages/shared/src/`, export. Re-run → green.
- [x] **3. RED (e2e):** in `scripts/e2e-verify.mjs` — finalize → `benchmarks/{taskType}` updated
  (aggregate-only, no ids); second run reads back a non-null median; opt-out skips contribution.
  Run `npm run e2e` → RED.
- [x] **4. GREEN:** contribute aggregates from `finalizeRun` (transactional rolling merge, opt-out
  aware); make `compareToPlatformMedian` read the real aggregate. Re-run e2e → green.
- [ ] **5. DEFERRED → frontend agent (creator-web analytics benchmark column ↑/↓/≈):** analytics table benchmark column shows real ↑/↓/≈ indicators. Verify via preview.
- [x] **6. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.
