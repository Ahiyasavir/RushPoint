## 1. Shared density helper — RED then GREEN (pure)
- [x] 1.1 RED: `scripts/test-movement-heatmap.ts` — grid binning, weight sums, invalid/out-of-
  range skip, empty/prune-safe, deterministic order. Confirm fail.
- [x] 1.2 GREEN: `packages/shared/src/movementHeatmap.ts` (`buildMovementDensity`,
  `MovementPoint`, `HeatmapCell`, `RunHeatmapResult`); export from `@rushpoint/shared`.
  `npm test` → 8 pass.

## 2. Capture the track
- [x] 2.1 `updateLocation` appends each accepted ping to `…/runs/{runId}/locationTrack`
  (append-only, best-effort — never fails the location update).

## 3. Aggregate callable
- [x] 3.1 `getRunHeatmap` in `runs/index.ts` (owner-only, resolve-by-code; bins via
  `buildMovementDensity`). Re-export in `functions/src/index.ts`.

## 4. Rules + retention
- [x] 4.1 `firestore.rules`: `locationTrack/{id}` owner-read, write:false.
- [x] 4.2 `maintenance/pruneRunPII` deletes `locationTrack` with `teamLocations` (raw GPS PII).

## 5. creator-web
- [x] 5.1 `HeatmapMap` component (MapLibre `heatmap` layer over a weighted-points geojson).
- [x] 5.2 `HeatmapPanel` in RunConsolePage (finished-gated, load-on-demand); `getRunHeatmap`
  wrapper in `calls.ts`; i18n `heatmap*` keys EN + HE.

## 6. Tests / gates
- [x] 6.1 e2e: several `updateLocation` → owner `getRunHeatmap` non-zero cells; non-owner denied.
  (Also satisfies the callable-coverage guard.)
- [x] 6.2 typecheck · i18n:check · no-dashes · lint · builds — all green.
- [ ] 6.3 consolidated `verify:emulator` (e2e + rules + sims) — in progress.
