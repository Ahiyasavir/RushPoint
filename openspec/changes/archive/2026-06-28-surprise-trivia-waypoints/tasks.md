# Tasks — Surprise trivia waypoints (RED → GREEN → REFACTOR)

> Strict TDD. Pure math first (proximity + answer matching + Overpass query), then the callable
> (with rules), then the UI (Builder + play overlay).

## Pure helpers

- [x] **1. RED (pure):** new `scripts/test-discovery-poi.ts` — assert:
  - `isWithinPoiRadius`: inside / on-boundary (≤ radius) / outside; `LocationError` on bad coords.
  - `matchesDiscoveryAnswer`: case-insensitive; trims whitespace; strips diacritics; no false positives.
  - `buildOverpassQuery`: output contains the bbox values and OSM tag strings; no injection vector.
  - `isPoiAlreadyClaimed`: true only for `'answered'`; false for `undefined` or `'triggered'`.
  Run `npm test` → fails RED.
- [x] **2. GREEN:** add all four helpers + `DiscoveryPoi` / `DiscoveryPoiResult` /
  `TeamDiscoveryState` types + `FIRESTORE_PATHS.discoveryPoisCol` / `.discoveryPoi` to
  `packages/shared/src/`, export from `index.ts`. Re-run → green.

## Firestore rules

- [x] **3. RED (rules):** in `scripts/test-rules.mjs` assert: creator `get`/`list` of
  `discoveryPois` succeeds; play-client (different uid) `get`/`list` denied. Run
  `npm run test:rules` → fails RED.
- [x] **4. GREEN:** add the `discoveryPois` rule block to `firestore.rules`. Re-run → green.
  Confirm existing e2e still passes.

## Callables

- [x] **5. RED (e2e):** in `scripts/e2e-verify.mjs` add a discovery POI to the seeded game; after
  join/start: `claimDiscoveryPoi` with correct coords + correct answer → `{ correct: true }` + score
  increased; wrong answer → `{ correct: false }` + score unchanged; outside radius →
  `failed-precondition`; double-claim → `already-exists`. `getRunDiscoveryPois` → no `coordinates`
  or `answers` in payload. Run `npm run e2e` → fails RED.
- [x] **6. GREEN:** implement `getRunDiscoveryPois` + `claimDiscoveryPoi` in
  `functions/src/runs/index.ts`; re-export in `functions/src/index.ts`; typed wrappers in both
  apps' `services/calls.ts`. Re-run e2e → green.

## Creator Builder UI

- [ ] **7. DEFERRED → frontend agent (creator-web Builder):** new Builder "Discovery POIs" panel — list of POIs; add/edit/delete; map
  pin placement; Overpass "Suggest" button → `queryOverpassPois(bounds)` client fetch →
  `overpassPois.ts` → add-cards. Verify via preview tools.

## Play UI

- [ ] **8. DEFERRED → frontend agent (play-web overlay + geofence trigger):** play-web background geofence watcher (using GPS from `updateLocation`
  stream); loads `DiscoveryPoiResult[]` on run start; discovery overlay on first proximity —
  flavor text, question, answer input; calls `claimDiscoveryPoi`; shows correct/wrong result.
  Verify via preview with mock POI data.

## REFACTOR + Gate

- [ ] **9. DEFERRED → frontend agent (overlay idempotency UX):** confirm idempotency in the overlay (overlay does not re-show for claimed POIs
  on GPS fluctuation); confirm answer normalisation edge cases (Hebrew text, numbers). Preview-verify.
- [x] **10. Full gate set:** `npm run typecheck` · `npm run lint` · `npm test` ·
  `npm run creator:build` · `npm run e2e` · `npm run test:rules`. Update TECH_SPEC Appendix B.
