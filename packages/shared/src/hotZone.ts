// Hot Zone bonus (change: hot-zone-bonus). A timed, geofenced score multiplier
// an organizer activates on a run. The multiplier is decided here, server-side,
// from the server-stored task location and the server clock — never from a
// client assertion. Pure logic; no Firestore, no DOM.
import type { GeoPoint, HotZone } from './types';
import { haversineKm } from './geo';

export type { HotZone };

/**
 * The score multiplier to apply to a completion at `coords` at `nowMs`. Returns
 * the zone multiplier only when a zone exists, coords are present, now is within
 * [startedAt, expiresAt], and coords are within radiusMeters of the centre.
 * Returns 1 (no bonus) in every other case.
 */
export function hotZoneMultiplier(
  zone: HotZone | null | undefined,
  coords: GeoPoint | null | undefined,
  nowMs: number,
): number {
  if (!zone || !coords) return 1;
  if (!(zone.multiplier > 1)) return 1;

  const start = Date.parse(zone.startedAt);
  const end = Date.parse(zone.expiresAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return 1;
  if (nowMs < start || nowMs > end) return 1;

  let distM: number;
  try {
    distM = haversineKm(zone.center, coords) * 1000;
  } catch {
    return 1; // invalid centre/coords → no bonus
  }
  if (distM > zone.radiusMeters) return 1;

  return zone.multiplier;
}
