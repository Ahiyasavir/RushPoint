// ─── Public task library — location contract (change: task-library-map-view) ──
//
// `publicTasks/{id}` is world-readable (`firestore.rules`: `allow read: if true`).
// This module is the single place that decides what a public task is allowed to
// say about where it is.
//
// (change: gallery-precise-task-location) An ordinary task now publishes its
// EXACT authored point. The gallery and mission-library maps exist so a creator
// can see and copy WHERE ANOTHER CREATOR PUT A TASK — that coordinate is an
// authored point of interest (a landmark, a shop), not a person's location, and
// coarsening it made every mission look misplaced while hiding the one thing the
// maps are for. Only a `hideLocation` task — whose spot is a puzzle deliberately
// withheld from players — is still coarsened, because this document is
// world-readable and its exact point would otherwise leak the answer. The full
// rationale, and why the participant-facing secrecy is a separate untouched
// control, is on `publicTaskLocation` below.
//
// WHY THE hideLocation COARSENING IS A GRID SNAP AND NOT RANDOM JITTER
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
// WHAT THE SNAP GUARANTEES for a hidden task: the output is the centre of the
// ~1 km cell containing the input, so each output axis is within half a cell of
// its input axis and a reader learns the cell and nothing finer.
// WHAT IT DOES NOT GUARANTEE: k-anonymity. A hidden task alone in its cell is
// still narrowed to that cell — the accepted trade for keeping a hunt visible to
// its own author without handing out the solution.

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
 * Is a published point a COARSE ~1 km cell, or an EXACT authored point?
 * (change: gallery-precise-task-location)
 *
 * A point is coarse exactly when it already sits on the public grid — i.e.
 * `approximatePublicPoint` is a no-op on it. This is a PURE STRUCTURAL test on the
 * stored coordinate, so a reader can draw the honest affordance (a ~1 km cell
 * square vs. a precise pin) without the document having to carry a separate flag:
 *
 *   - a `hideLocation` task always publishes a cell centre  ⇒ always coarse (true);
 *   - a legacy pre-backfill doc still carrying its old coarse area is a cell centre
 *     ⇒ coarse (true), which is correct — that pin really is coarse until the
 *     backfill writes the exact point;
 *   - a derived game area (a re-snapped mean) is a cell centre ⇒ coarse (true);
 *   - an ordinary EXACT task point is off-grid ⇒ precise (false), save the
 *     measure-zero case of a task authored exactly on the grid, where drawing a
 *     square around an already-public exact point discloses nothing new.
 *
 * Returns `false` for anything unusable, so a caller can treat "not coarse" as
 * "draw no area square" safely.
 */
export function isCoarsePublicPoint(
  point: { lat?: unknown; lng?: unknown } | null | undefined,
): boolean {
  if (!usableCoord(point)) return false;
  const cell = approximatePublicPoint(point);
  return cell.lat === round5(point.lat) && cell.lng === round5(point.lng);
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
 * Returns the EXACT authored point for an ordinary usably-placed task, a
 * coarsened ~1 km area for a `hideLocation` task, and `undefined` (⇒ omit the
 * field entirely) when the task is `locationless` or is not usably placed.
 *
 * WHY ORDINARY TASKS ARE NOW PRECISE (change: gallery-precise-task-location).
 * The gallery and mission-library maps exist so a creator can see, and copy,
 * WHERE ANOTHER CREATOR PUT A TASK. That coordinate is an authored point of
 * interest — a landmark, a shop, a viewpoint — not a person's location, so
 * coarsening it to a kilometre was hiding the one thing these maps are for and
 * making every mission look misplaced. The exact point is published.
 *
 * WHY `hideLocation` IS THE ONE EXCEPTION. A hidden-location task's spot is a
 * deliberate puzzle the creator withholds from players. `publicTasks` is
 * world-readable (`firestore.rules`: `allow read: if true`), so publishing its
 * exact point here would hand the answer to anyone, including a player who opens
 * the gallery. It stays coarsened to the ~1 km cell: enough for the author to
 * see roughly where it sits, never enough to solve it. The snap is a pure
 * function of the input, so repeated publishes cannot be averaged back to truth.
 *
 * THE PLAYER-FACING PUZZLE IS A DIFFERENT CONTROL, UNTOUCHED BY EITHER BRANCH.
 * The PLAYER gets `sanitizeTaskForParticipant` (functions/src/runs/
 * sanitizeTask.ts), which SEALS a `hideLocation` task until the server confirms
 * the team physically arrived, and strips `coordinates`, `geofenceRadiusMeters`
 * and `smart.stationCoords` — no location reaches the device, coarse or exact.
 * That is what makes the location a puzzle in play; this function is not it, and
 * neither may be relaxed on the grounds that the other exists.
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
  // A hideLocation task's spot is a deliberate puzzle, secret from players, and
  // this document is world-readable — so it, and only it, is still coarsened to
  // the ~1 km cell (a creator sees roughly where it is; the answer never leaks).
  if (task.hideLocation) return approximatePublicPoint(task.coordinates);
  // Every other task publishes its EXACT authored placement. The gallery shows
  // WHERE A CREATOR PUT A TASK — a point of interest they authored, not any
  // person's location — so a precise pin is the honest, useful thing to draw.
  return { lat: round5(task.coordinates.lat), lng: round5(task.coordinates.lng) };
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
