# Tasks — Hot zone bonus (RED → GREEN → REFACTOR)

## Pure multiplier

- [x] **1. RED (pure):** `scripts/test-hot-zone.ts` — `hotZoneMultiplier` (active+inside → multiplier;
  outside → 1; expired → 1; before start → 1; no zone → 1; no coords → 1; ≤1 mult → 1; bad dates → 1;
  invalid coords → 1 no-throw; boundary cases). 13 assertions.
- [x] **2. GREEN:** `hotZoneMultiplier` + `HotZone` type in `packages/shared/src/hotZone.ts`
  (HotZone canonical in `types/index.ts`), exported. Green.

## Callables + scoring

- [x] **3. RED (e2e):** `scripts/e2e-verify.mjs` — activate a hot zone over a task; in-zone completion
  → ×2 score; out-of-zone task → not multiplied. (Expiry/before-start covered by the pure suite; can't
  fast-forward the server clock in e2e.)
- [x] **4. GREEN:** `activateHotZone` + `deactivateHotZone` in `functions/src/runs/index.ts`
  (owner-authorized, validated + bounded, server-stamped startedAt/expiresAt, single active zone);
  `earnedScore` multiplied by `hotZoneMultiplier` (server-stored task coords) in completeTaskForTeam;
  re-exported from `functions/src/index.ts`. e2e green (6/6). NOTE: staff activation deferred (owner-only
  for now); client wrappers ship with the UI.

## UI

- [ ] **5. DEFERRED → frontend agent:** participant Hot Zone banner + countdown + map circle (play-web)
  and creator RunConsole activate/deactivate panel (creator-web). Server is fully enforced + e2e-verified;
  the feature is dark until the UI lands (same precedent as guardian-consent / safe-zone). Surfacing
  `run.hotZone` to participants also needs a small getMyTeamState passthrough — bundle with the UI.

## Gate
- [x] **6.** `npm run typecheck` · `npm run lint` · `npm test` (13 pure) · `npm run creator:build` ·
  play build · `npm run e2e` (6/6 hot-zone) — all green.
