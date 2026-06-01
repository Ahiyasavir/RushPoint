// Mobile mission map helpers. Geography comes from @rushpoint/shared (single
// source of truth); the map itself is rendered by <TopoMap> from keyless
// OpenTopoMap raster tiles (see components/TopoMap.tsx + data/topoTiles.ts).
import type { GeoPoint, RaceConfig } from '@rushpoint/shared';

/** All points the map must frame: start, finish, gate, and every station. */
export function framePoints(config: RaceConfig, stations: readonly GeoPoint[]): GeoPoint[] {
  return [config.start, config.finish, config.gate, ...stations];
}
