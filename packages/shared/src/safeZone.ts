// Safe-zone boundary (change: safe-zone-boundary). An organizer defines a circular
// play area; the server detects when a team's reported location leaves it. Pure +
// reuses haversineKm so the breach rule is unit-tested and server-authoritative.
import { haversineKm } from './geo';

export interface SafeZone {
  center: { lat: number; lng: number };
  radiusMeters: number;
}

/**
 * True when `coords` is OUTSIDE the safe zone. No zone (or a non-positive radius)
 * means "no boundary" → never outside. Invalid coordinates throw (the caller must
 * not pass NaN/Infinity into a safety check).
 */
export function isOutsideSafeZone(
  coords: { lat: number; lng: number },
  safeZone?: SafeZone | null,
): boolean {
  if (!safeZone || !(safeZone.radiusMeters > 0)) return false;
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
    throw new Error('Invalid coordinates for safe-zone check');
  }
  const distanceM = haversineKm(coords, safeZone.center) * 1000;
  return distanceM > safeZone.radiusMeters;
}
