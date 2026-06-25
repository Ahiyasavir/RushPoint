# Tasks — Run replay / VOD (RED → GREEN → REFACTOR)

- [ ] **1. RED (pure):** new `scripts/test-run-replay.ts` — `buildRunTimeline`: events globally
  time-ordered; cumulative score series correct; pruned team omitted; empty run → empty timeline.
  Run `npm test` → RED.
- [ ] **2. GREEN:** add `buildRunTimeline` + `RunReplay` types to `packages/shared/src/`, export. Green.
- [ ] **3. RED (e2e):** in `scripts/e2e-verify.mjs` — owner `getRunReplay` → ordered timeline;
  non-owner → permission-denied. Run `npm run e2e` → RED.
- [ ] **4. GREEN:** implement `getRunReplay` in `functions/src/runs/index.ts` (owner-only, finished
  run, `buildRunTimeline`). Re-export + wrappers. Re-run e2e → green.
- [ ] **5. GREEN (UI):** RunConsole Replay page — timeline + scrubber + per-team filter + gallery +
  score chart; print export. Verify via preview.
- [ ] **6. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.
