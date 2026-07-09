// Movement heatmap (change: movement-heatmap) — pure density aggregation over a run's
// retained GPS track. Snaps points to a lat/lng grid and counts hits per cell. Pure +
// deterministic + prune-safe (an empty track yields no cells) — the TDD lever.

export interface MovementPoint { lat: number; lng: number }
export interface HeatmapCell { lat: number; lng: number; weight: number }
export interface RunHeatmapResult {
  title: string;
  runStatus: string;
  cells: HeatmapCell[];
  pointCount: number;
}

// ~0.0005° ≈ 55 m at the equator — a sensible default foot-traffic bin.
const DEFAULT_GRID_DEG = 0.0005;

/**
 * Bin GPS points into a density grid. Each returned cell's lat/lng is the bin centre
 * and `weight` is the number of points that fell in it. Invalid/out-of-range coords are
 * skipped. Deterministic order: weight desc, then lat, then lng.
 */
export function buildMovementDensity(
  points: MovementPoint[],
  opts?: { gridDeg?: number },
): HeatmapCell[] {
  const grid = opts?.gridDeg && opts.gridDeg > 0 ? opts.gridDeg : DEFAULT_GRID_DEG;
  const bins = new Map<string, HeatmapCell>();
  for (const p of points ?? []) {
    const { lat, lng } = p ?? {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const gi = Math.round(lat / grid);
    const gj = Math.round(lng / grid);
    const key = `${gi}:${gj}`;
    const cell = bins.get(key) ?? { lat: gi * grid, lng: gj * grid, weight: 0 };
    cell.weight += 1;
    bins.set(key, cell);
  }
  return [...bins.values()].sort(
    (a, b) => b.weight - a.weight || a.lat - b.lat || a.lng - b.lng,
  );
}
