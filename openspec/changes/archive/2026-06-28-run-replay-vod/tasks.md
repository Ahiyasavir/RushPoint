# Tasks — Run replay / VOD (RED → GREEN → REFACTOR)

- [x] **1. RED (pure):** new `scripts/test-run-replay.ts` — `buildRunTimeline`: events globally
  time-ordered; cumulative score series correct; pruned team omitted; empty run → empty timeline.
  Run `npm test` → RED.
- [x] **2. GREEN:** add `buildRunTimeline` + `RunReplay` types to `packages/shared/src/`, export. Green.
- [x] **3. RED (e2e):** in `scripts/e2e-verify.mjs` — owner `getRunReplay` → ordered timeline;
  non-owner → permission-denied. Run `npm run e2e` → RED.
- [x] **4. GREEN:** implement `getRunReplay` in `functions/src/runs/index.ts` (owner-only, finished
  run, `buildRunTimeline`). Re-export + wrappers. Re-run e2e → green.
- [ ] **5. DEFERRED → frontend agent (creator-web RunConsole Replay page):** RunConsole Replay page — timeline + scrubber + per-team filter + gallery +
  score chart; print export. Verify via preview.
- [x] **6. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.
