# Tasks — Hot zone bonus (RED → GREEN → REFACTOR)

## Pure multiplier

- [ ] **1. RED (pure):** new `scripts/test-hot-zone.ts` — `hotZoneMultiplier` (active+inside →
  multiplier; outside → 1; expired → 1; before start → 1; no zone → 1; no coords → 1).
  Run `npm test` → RED.
- [ ] **2. GREEN:** add `hotZoneMultiplier` + `HotZone` type to `packages/shared/src/`, export. Green.

## Callables + scoring

- [ ] **3. RED (e2e):** in `scripts/e2e-verify.mjs` — activate a hot zone over a task; complete it
  in-window → multiplied score; out-of-zone task → not multiplied; after expiry → not multiplied.
  Run `npm run e2e` → RED.
- [ ] **4. GREEN:** implement `activateHotZone` + `deactivateHotZone` in `functions/src/runs/index.ts`
  (owner/staff, validated, writes `run.hotZone`); multiply `earnedScore` by `hotZoneMultiplier` in the
  completion path. Re-export + wrappers. Re-run e2e → green.

## UI

- [ ] **5. GREEN (UI):** participant Hot Zone banner + countdown + map circle; creator RunConsole
  activate/deactivate panel. Verify via preview.

## Gate
- [ ] **6.** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.
