// ─── Sealed hidden-mission SEARCH AREA (change: hidden-mission-search-area) ───
//
// A hidden-location ("treasure hunt") task keeps its real coordinates on the
// server and is unsealed only when `reportArrival` confirms the team physically
// got there. Until this module existed, the participant payload for such a task
// carried NOTHING locational at all, so the player's map was blank for the one
// mission type that is entirely about walking somewhere: a GPS dot floating over
// an empty neighbourhood with no indication of where to start. A hunt needs a
// search AREA; "somewhere in this city" is a dead end, not a puzzle.
//
// This module decides the only locational value a SEALED task is ever allowed to
// ship: a circle that provably CONTAINS the real spot while disclosing only the
// cell the spot sits in.
//
// ── THE ARITHMETIC (this is the safety argument, not a comment) ───────────────
// The coordinate is floored onto a global grid of HIDDEN_SEARCH_CELL_DEG = 0.004°
// cells and the CELL CENTRE is returned. 0.004° of latitude is ≈ 445 m, so the
// half-cell is ≈ 222.6 m on each axis and the furthest any point inside the cell
// can be from its centre is the half-diagonal, 222.6 × √2 ≈ 314.8 m. The returned
// radius is a constant 320 m, so containment holds for EVERY input at EVERY
// latitude (longitude cells only shrink away from the equator, which shrinks the
// diagonal further).
//
// ── WHY A GRID SNAP AND NOT JITTER ───────────────────────────────────────────
// Random jitter draws a fresh sample around the truth on every call, and a
// participant polls getMyTeamState every few seconds — the mean of N samples
// converges on the exact spot, so a patient player recovers the answer by waiting.
// A grid snap is a PURE FUNCTION of its input: the thousandth read carries exactly
// as much information as the first. The determinism IS the security property.
//
// ── WHY THE GRID IS ANCHORED AT (0, 0) ───────────────────────────────────────
// A per-task anchor ("centre the circle on the task, round the radius") leaks the
// answer through the geometry itself: the centre would BE the spot. An absolute
// grid makes the centre a property of the CELL, and the spot may sit anywhere
// inside it.
//
// ── WHY THE RADIUS IS A CONSTANT ─────────────────────────────────────────────
// A latitude-dependent radius would be a second, finer channel carrying the same
// coordinate: `radiusMeters` would quietly encode cos(lat). A constant leaks
// nothing and is over-wide by at most ~5 m at the equator.
//
// ── WHY THIS DOES NOT IMPORT FROM publicTaskLocation.ts ──────────────────────
// That module coarsens for a WORLD-READABLE document read by strangers who are
// not in the game (~1.11 km). This one coarsens for a PLAYER standing inside the
// area on a phone (~445 m). Two audiences, two threat models, two code paths.
// Deriving one from the other would couple a participant UX decision to a public
// privacy decision and guarantee that tuning either silently moves the other.
//
// ── WHAT THIS STILL DOES NOT DISCLOSE ────────────────────────────────────────
// Distance (evaluateTrigger's hidden branch still refuses without a metres
// figure), bearing, the geofence radius, the station coordinates, the title, the
// type, or any answer key. And being inside the circle is NOT arrival: the server
// still decides that from its own GPS verdict.

import type { GeoPoint } from './types';
import { isValidCoord } from './geo';

/**
 * Cell size of the participant search-area grid, in degrees. 0.004° ≈ 445 m of
 * latitude, and at most that much longitude at any latitude.
 */
export const HIDDEN_SEARCH_CELL_DEG = 0.004;

/**
 * Radius of the published search circle, in metres. Constant on purpose (see the
 * header): it must be at least the cell's half-diagonal, ≈ 314.8 m.
 */
export const HIDDEN_SEARCH_RADIUS_M = 320;

/** A coarse circle: where to search, and how big the search is. */
export interface SearchArea {
  lat: number;
  lng: number;
  radiusMeters: number;
}

/** Round away float dust so the value on the wire is a clean 5-decimal number. */
function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/**
 * Is this coordinate usable as a search-area input?
 *
 * `isValidCoord` is a pure range check and accepts (0, 0) — but `blankTask()`
 * ships `{lat: 0, lng: 0}` as its "not placed yet" placeholder, so null island
 * means "unplaced", not "in the Gulf of Guinea". Rejected by name, here, once.
 */
function usableCoord(c: { lat?: unknown; lng?: unknown } | undefined | null): c is GeoPoint {
  if (!c || typeof c !== 'object') return false;
  if (!isValidCoord(c.lat, c.lng)) return false;
  return !(c.lat === 0 && c.lng === 0);
}

/**
 * Coarsen a coordinate to the centre of its ≈445 m grid cell.
 *
 * `Math.floor` (not `trunc`) so the grid is uniform across the equator and the
 * prime meridian — `trunc` would double the cell width around zero and shift
 * every southern/western cell by one.
 *
 * Clamped to the valid coordinate range so an input exactly at ±90 / ±180 cannot
 * produce an out-of-range centre.
 */
export function approximateSearchPoint(point: { lat: number; lng: number }): GeoPoint {
  const cell = HIDDEN_SEARCH_CELL_DEG;
  const half = cell / 2;
  const snap = (v: number) => round5(Math.floor(v / cell) * cell + half);
  return {
    lat: Math.min(90, Math.max(-90, snap(point.lat))),
    lng: Math.min(180, Math.max(-180, snap(point.lng))),
  };
}

/**
 * THE RULE — the search area a SEALED hidden task may show its player.
 *
 * Returns a containing circle for any usably placed task, and `undefined`
 * (⇒ omit the field entirely) when the task is nullish, `locationless`, or not
 * usably placed. `hideLocation` is deliberately NOT consulted: this function is
 * about coordinates, and the POLICY of who receives an area belongs to the single
 * security boundary that decides such things, `sanitizeTaskForParticipant`.
 *
 * Coordinate source: an injected `smart.stationCoords` wins over the template
 * `coordinates`, mirroring what the participant map already uses to place an
 * ordinary pin, so a hidden station's circle sits over the station. Each
 * candidate is checked independently, so a garbage `stationCoords` falls through
 * to `coordinates` rather than poisoning the result.
 *
 * Total: never throws, for any input.
 */
export function hiddenSearchArea(task: {
  locationless?: boolean;
  coordinates?: { lat?: unknown; lng?: unknown } | null;
  smart?: { stationCoords?: { lat?: unknown; lng?: unknown } | null } | null;
} | null | undefined): SearchArea | undefined {
  if (!task || typeof task !== 'object') return undefined;
  // A locationless task has no map presence by definition.
  if (task.locationless) return undefined;
  const source = usableCoord(task.smart?.stationCoords)
    ? task.smart!.stationCoords as GeoPoint
    : usableCoord(task.coordinates)
      ? task.coordinates as GeoPoint
      : undefined;
  if (!source) return undefined;
  const centre = approximateSearchPoint(source);
  return { lat: centre.lat, lng: centre.lng, radiusMeters: HIDDEN_SEARCH_RADIUS_M };
}
