// Which search circles the participant map may draw (change: hidden-mission-search-area).
//
// The server ships a coarse `searchArea` on a SEALED hidden mission so the player
// can see roughly where to go hunting. This module is the single decision of what
// the map does with that, and it exists as a separate pure file for two reasons:
//
//   1. play-web has NO component test runner, so a filter written inline in
//      NavMap/PlayScreen is a decision nothing can observe;
//   2. it runs on the participant HOT PATH — every poll of getMyTeamState, mid
//      race, on a phone. A selector that throws on one malformed entry blacks out
//      the whole game screen. So it is TOTAL: every rejection is a dropped circle,
//      never an exception.
//
// Deliberately self-contained (no @rushpoint/shared import): the shape it reads is
// three numbers off the wire, and keeping it dependency-free means the pure test
// lane never has to resolve a built package to run it.
//
// The rejections are not paranoia, they are the failure modes that matter:
//   • an OVER-WIDE circle is a worse lie than no circle — a radius of "9999999"
//     covers a continent and tells the player their mission is everywhere, so a
//     malformed radius drops the circle and an extreme one is clamped;
//   • (0, 0) is `blankTask()`'s "unplaced" placeholder and the classic bad-GPS
//     sentinel, so it is rejected by name here as it is everywhere else;
//   • a REVEALED mission has its exact coordinates back and gets a real pin —
//     drawing a circle too would put two contradictory answers for one mission on
//     one map.

/** The three numbers a drawable circle needs, plus the task it belongs to. */
export interface MapSearchArea {
  id: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

/** Smallest circle worth drawing (below this it is a pin, and a lying one). */
export const SEARCH_AREA_MIN_RADIUS_M = 25;
/** Largest circle that still says anything useful on a phone-sized map. */
export const SEARCH_AREA_MAX_RADIUS_M = 5000;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function usableCentre(lat: unknown, lng: unknown): boolean {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

/**
 * The circles the map should draw, from the served `activeStageTasks`.
 *
 * Total: a nullish list, a non-list, and entries of any shape yield `[]`.
 * Order-preserving and de-duplicated by task id (first wins) so the map's overlay
 * does not churn between polls.
 */
export function selectSearchAreas(
  tasks: ReadonlyArray<unknown> | null | undefined,
): MapSearchArea[] {
  if (!Array.isArray(tasks)) return [];
  const out: MapSearchArea[] = [];
  const seen = new Set<string>();
  for (const raw of tasks) {
    if (!raw || typeof raw !== 'object') continue;
    const task = raw as { id?: unknown; arrivalPending?: unknown; searchArea?: unknown };
    // Only a mission the SERVER says is still sealed. `arrivalPending` is
    // server-set, so this can never disagree with what the payload contains.
    if (task.arrivalPending !== true) continue;
    if (typeof task.id !== 'string' || task.id.length === 0) continue;
    if (seen.has(task.id)) continue;
    const area = task.searchArea;
    if (!area || typeof area !== 'object') continue;
    const { lat, lng, radiusMeters } = area as { lat?: unknown; lng?: unknown; radiusMeters?: unknown };
    if (!usableCentre(lat, lng)) continue;
    if (!isFiniteNumber(radiusMeters) || radiusMeters <= 0) continue;
    seen.add(task.id);
    out.push({
      id: task.id,
      lat: lat as number,
      lng: lng as number,
      radiusMeters: Math.min(SEARCH_AREA_MAX_RADIUS_M, Math.max(SEARCH_AREA_MIN_RADIUS_M, radiusMeters)),
    });
  }
  return out;
}
