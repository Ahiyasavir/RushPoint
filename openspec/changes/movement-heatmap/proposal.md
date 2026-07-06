## Why

After a run, a creator can see WHICH tasks were hard (the analytics dashboard) but not
WHERE teams actually went — where they clustered, backtracked, or bottlenecked. A
foot-traffic heatmap over the route map is the most requested tuning tool for station
placement and is a signature feature of event-analytics platforms (Grandstand, VenuIQ).

## What Changes

- `updateLocation` additionally **appends** each accepted GPS ping to an append-only
  `…/runs/{runId}/locationTrack` subcollection (server-write-only). Today only the latest
  position per team is kept, so there is no history to visualize.
- A new owner-only **`getRunHeatmap`** callable reads the track, bins points into a density
  grid (pure `buildMovementDensity` in shared), and returns weighted cells.
- The creator RunConsole (finished run) adds a **movement heatmap** overlay on the route
  map (MapLibre native `heatmap` layer) beside the existing analytics.
- The 90-day PII prune clears `locationTrack` with the rest of the run's raw GPS data.

## Capabilities

### New Capabilities
- `movement-heatmap`: retained per-run GPS track + `getRunHeatmap` density aggregate +
  a creator route-map heat overlay. Owner-only, PII-pruned at 90 days.

## Non-goals
- No live/real-time heatmap during the run (post-run only).
- No per-team path replay (that is the separate run-replay feature; this is aggregate density).
- Controller-only pings (shared-team-devices) — the track follows the controlling phone,
  which is fine for a density map.

## Surfaces touched
- **shared:** `movementHeatmap.ts` (`buildMovementDensity`, `MovementPoint`, `HeatmapCell`,
  `RunHeatmapResult`).
- **functions:** `updateLocation` append; new `getRunHeatmap` (owner-only, resolve-by-code,
  mirrors `getRunAnalytics`); prune update in `maintenance/index.ts`.
- **rules:** `locationTrack/{id}` owner-read, write:false (mirror `teamLocations`).
- **creator-web:** heatmap panel + MapLibre heat layer; `calls.ts` wrapper; i18n.
- **Tests:** `scripts/test-movement-heatmap.ts` (grid binning, weights, empty/prune-safe,
  determinism); e2e (several `updateLocation` → owner `getRunHeatmap` non-empty; non-owner
  denied). Possible composite index if track is queried by team.
