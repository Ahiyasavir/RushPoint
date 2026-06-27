# Tasks — Safe zone boundary (RED → GREEN → REFACTOR)

- [x] **1. RED (pure):** new `scripts/test-safe-zone.ts` — `isOutsideSafeZone`: inside → false;
  on-boundary → false; outside → true; invalid coords → throws. Run `npm test` → RED.
- [x] **2. GREEN:** add `isOutsideSafeZone` + `Game.safeZone` type to `packages/shared/src/`, export. Green.
- [x] **3. RED (e2e):** in `scripts/e2e-verify.mjs` — out-of-zone location → alert + `outOfBounds` true
  + no new task; in-zone location → flag cleared + assignment resumes. Run `npm run e2e` → RED.
- [x] **4. GREEN:** extend `updateLocation` (breach detect → alert + flag); skip assignment while
  `outOfBounds`. Re-run e2e → green.
- [ ] **5. GREEN (UI):** participant out-of-bounds banner; Builder safe-zone config; RunConsole map
  out-of-bounds indicator. Verify via preview.
- [ ] **6. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.
