// Hot Zone bonus (change: hot-zone-bonus). A timed, geofenced score multiplier
// an organizer activates on a run. The multiplier is decided here, server-side,
// from the server-stored task location and the server clock — never from a
// client assertion. Pure logic; no Firestore, no DOM.
import type { GeoPoint, HotZone } from './types';
import { haversineKm } from './geo';

export type { HotZone };

/**
 * Whether a hot zone is "active" at `nowMs`: a zone exists, its multiplier is a
 * real bonus (> 1), and now falls within [startedAt, expiresAt]. This is the
 * time-window + eligibility half of the multiplier rule, with no radius check —
 * so it can answer "is a hot zone running right now?" independent of any point
 * (used by the routing bias and the participant map overlay).
 */
export function isHotZoneActive(
  zone: HotZone | null | undefined,
  nowMs: number,
): boolean {
  if (!zone) return false;
  if (!(zone.multiplier > 1)) return false;

  const start = Date.parse(zone.startedAt);
  const end = Date.parse(zone.expiresAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return nowMs >= start && nowMs <= end;
}

/**
 * Whether `point` falls within the zone's radius of its centre. This is the
 * geographic half of the multiplier rule, with no time-window check. Returns
 * false for a missing zone/point or invalid coordinates (never throws).
 */
export function isWithinHotZoneRadius(
  zone: HotZone | null | undefined,
  point: GeoPoint | null | undefined,
): boolean {
  if (!zone || !point) return false;
  let distM: number;
  try {
    distM = haversineKm(zone.center, point) * 1000;
  } catch {
    return false; // invalid centre/point → not within
  }
  if (!Number.isFinite(distM)) return false;
  return distM <= zone.radiusMeters;
}

/**
 * The score multiplier to apply to a completion at `coords` at `nowMs`. Returns
 * the zone multiplier only when the zone is active (see isHotZoneActive) and
 * `coords` are within its radius (see isWithinHotZoneRadius); returns 1 (no
 * bonus) in every other case. Composed from the two predicates so "is this
 * point, right now, in the hot zone?" has a single definition shared with the
 * routing bias.
 */
export function hotZoneMultiplier(
  zone: HotZone | null | undefined,
  coords: GeoPoint | null | undefined,
  nowMs: number,
): number {
  if (isHotZoneActive(zone, nowMs) && isWithinHotZoneRadius(zone, coords)) {
    return zone!.multiplier;
  }
  return 1;
}
