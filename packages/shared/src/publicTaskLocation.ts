// ─── Public task library — location contract (change: task-library-map-view) ──
//
// `publicTasks/{id}` is world-readable (`firestore.rules`: `allow read: if true`).
// Before this module, `publishGame` copied the creator's EXACT authored
// `task.coordinates` into that document — for every task, including `hideLocation`
// tasks, whose coordinates this codebase treats as server-secret everywhere else
// (sanitizeTaskForParticipant, the routing payload, the photo feed, the run recap,
// the game-file export). This module is the single place that decides what a public
// task is allowed to say about where it is.
//
// (change: hidden-location-map-visibility) It no longer says anything DIFFERENT
// about a hideLocation task: the exact point is withheld from every task alike,
// and the ~1 km area is granted to every task alike. The rationale, and why the
// participant-facing secrecy is untouched by it, is on `publicTaskLocation` below.
//
// WHY A GRID SNAP AND NOT RANDOM JITTER
// Jitter (`lat + (random - 0.5) * delta`) is not a privacy control against an
// observer who can make the publisher republish: every republish is an independent
// sample centred on the truth, so the mean of N observations converges on the exact
// point. Anyone patient enough to poke the publish button recovers the answer.
// Snapping to a fixed global grid is a PURE FUNCTION of the input, so every publish
// returns the identical value and N observations carry exactly as much information
// as one. The determinism is the security property, not a convenience.
//
// The grid is anchored at (0, 0), never at the task — a per-task anchor would leak
// the true point through the cell boundaries themselves.
//
// WHAT THIS GUARANTEES: the output is the centre of the ~1 km cell containing the
// input, so each output axis is within half a cell of its input axis and a reader
// learns the cell and nothing finer.
// WHAT IT DOES NOT GUARANTEE: k-anonymity. A task alone in its cell is still
// narrowed to that cell. That is the accepted trade for EVERY published task,
// hidden-location ones included (see publicTaskLocation).

import type { GeoPoint } from './types';
import { isValidCoord } from './geo';

/**
 * Cell size of the public-location grid, in degrees. 0.01° ≈ 1.11 km of latitude,
 * and at most that much longitude at any latitude (longitude cells shrink toward
 * the poles, which only ever makes the disclosure smaller).
 */
export const PUBLIC_LOCATION_CELL_DEG = 0.01;

/** Round away float dust so the stored value is a clean 5-decimal number. */
function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/**
 * Coarsen a coordinate to the centre of its ~1 km grid cell.
 *
 * `Math.floor` (not `trunc`) so the grid is uniform across the equator and the
 * prime meridian — `trunc` would double the cell width around zero and shift every
 * southern/western cell by one.
 *
 * Clamped to the valid coordinate range so an input exactly at ±90 / ±180 cannot
 * produce an out-of-range pin.
 */
export function approximatePublicPoint(point: { lat: number; lng: number }): GeoPoint {
  const cell = PUBLIC_LOCATION_CELL_DEG;
  const half = cell / 2;
  const snap = (v: number) => round5(Math.floor(v / cell) * cell + half);
  return {
    lat: Math.min(90, Math.max(-90, snap(point.lat))),
    lng: Math.min(180, Math.max(-180, snap(point.lng))),
  };
}

/**
 * Is this coordinate usable as a published location?
 *
 * `isValidCoord` is a pure range check and accepts (0, 0) — but `blankTask()` ships
 * `{lat: 0, lng: 0}` as its "not placed yet" placeholder, so null island means
 * "unplaced", not "in the Gulf of Guinea". Rejected by name, here, once, so the
 * writer and the reader can never disagree about it.
 */
function usableCoord(c: { lat?: unknown; lng?: unknown } | undefined | null): c is GeoPoint {
  if (!c || !isValidCoord(c.lat, c.lng)) return false;
  return !(c.lat === 0 && c.lng === 0);
}

/**
 * THE WRITER'S RULE — what `publishGame` may write as a public task's location.
 *
 * Returns a coarsened ~1 km area for any usably placed task, and `undefined`
 * (⇒ omit the field entirely) when the task is `locationless` or is not usably
 * placed. Nothing else is consulted.
 *
 * `hideLocation` IS NOT CONSULTED (change: hidden-location-map-visibility).
 * A hidden-location task gets the same area as any other, so a creator can see
 * their own treasure hunt on their own mission-library and gallery maps — the
 * exclusion made a hunt-shaped game invisible to the person who wrote it.
 *
 * WHY THE PUZZLE SURVIVES THIS. Two different audiences read two different
 * payloads, produced by two different code paths:
 *   - The CREATOR, browsing a world-readable projection, gets this: a grid cell
 *     of roughly one kilometre. That is a neighbourhood, not a spot, and the
 *     game's own public gallery entry, title, description and promo page already
 *     name the neighbourhood. It cannot be sharpened by repeated observation,
 *     because the snap is a pure function of the input.
 *   - The PLAYER gets `sanitizeTaskForParticipant` (functions/src/runs/
 *     sanitizeTask.ts), which SEALS a `hideLocation` task until the server has
 *     confirmed the team physically arrived, and which strips `coordinates`,
 *     `geofenceRadiusMeters` and `smart.stationCoords` — coarse or exact, no
 *     location reaches the device. THAT is the control that makes the location a
 *     puzzle, and this function is not it. Neither may be relaxed on the grounds
 *     that the other exists.
 *
 * What still never happens: the EXACT authored coordinate is never returned here,
 * for any task, so it never reaches a world-readable document.
 */
export function publicTaskLocation(task: {
  hideLocation?: boolean;
  locationless?: boolean;
  coordinates?: { lat?: unknown; lng?: unknown };
}): GeoPoint | undefined {
  if (!task) return undefined;
  // A locationless task has no map presence by definition.
  if (task.locationless) return undefined;
  if (!usableCoord(task.coordinates)) return undefined;
  return approximatePublicPoint(task.coordinates);
}

/**
 * THE READER'S RULE — may this public task be plotted on the library map?
 *
 * Deliberately reads ONLY `approxLocation`. There is no fallback to the deprecated
 * `coordinates` field: a document published before this change still carries an
 * exact point, and falling back to it would reintroduce the exposure this module
 * exists to close.
 */
export function isPlottablePublicTask(pt: {
  approxLocation?: { lat?: unknown; lng?: unknown };
} | null | undefined): boolean {
  return !!pt && usableCoord(pt.approxLocation);
}

/**
 * Which map state a mission-library result set is in.
 *
 * - `no-results`     — nothing was returned; the map is not the story.
 * - `none-plottable` — there ARE results, but not one of them carries a published
 *                      area. This is the state a creator hit and could not explain:
 *                      an empty world-zoomed map over a list full of missions. It
 *                      is what the UI must ANNOTATE, not merely report.
 * - `partial`        — some are plottable. The "nothing to show" state must NOT
 *                      apply; the located ones get pins.
 * - `all-plottable`  — every result has an area.
 */
export type PublicTaskMapCoverage = 'no-results' | 'none-plottable' | 'partial' | 'all-plottable';

/**
 * Classify a result set for the mission-library map.
 *
 * Goes through `isPlottablePublicTask` per item — deliberately the SAME predicate
 * the marker list filters on — so the map can never say "none of these has an
 * area" while simultaneously drawing a pin, or vice versa. A single shared
 * predicate is the only structural guarantee of that; two parallel conditions are
 * exactly how the two got to disagree in the first place.
 *
 * Tolerates a nullish array and nullish entries: this runs on a callable's
 * response, and a classifier that throws would black out the whole tab.
 */
export function publicTaskMapCoverage(
  tasks: ReadonlyArray<{ approxLocation?: { lat?: unknown; lng?: unknown } } | null | undefined>
    | null | undefined,
): PublicTaskMapCoverage {
  if (!Array.isArray(tasks) || tasks.length === 0) return 'no-results';
  const plottable = tasks.reduce((n, t) => n + (isPlottablePublicTask(t) ? 1 : 0), 0);
  if (plottable === 0) return 'none-plottable';
  return plottable === tasks.length ? 'all-plottable' : 'partial';
}
