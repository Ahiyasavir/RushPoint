// Territory / contested-zone capture (change: territory-capture) — pure helpers.
// A team captures a physical zone by being inside its radius; a rival can flip it.
// Coordinates are NOT secret (zones render on the live map). The capture bonus is
// awarded immediately at capture time (so live and final standings can't drift).
import type { GeoPoint } from './types';
import { haversineKm } from './geo';

export interface CaptureZone {
  id: string;
  center: GeoPoint;
  radiusMeters: number;
  title: string;
  ownerTeamId?: string | null;
  ownerTeamName?: string | null;
  capturedAt?: string;
  captureBonus: number; // points awarded to the capturing team
}

/** True when a point is inside the zone's radius (server-validated, never trusted client-side). */
export function isWithinZone(center: GeoPoint, point: GeoPoint, radiusMeters: number): boolean {
  if (![center?.lat, center?.lng, point?.lat, point?.lng].every((n) => Number.isFinite(n))) return false;
  return haversineKm(center, point) * 1000 <= radiusMeters;
}

/** A team may capture a zone it does not already own (own zone can't be re-farmed). */
export function canCapture(zone: Pick<CaptureZone, 'ownerTeamId'>, teamId: string): boolean {
  return zone.ownerTeamId !== teamId;
}
