// The public game area (change: surface-invisible-fields).
//
// `GalleryPage` plots publicGames by `approxLocation` and renders its label on the
// card; `publishGame` copied that field faithfully — and nothing in the product ever
// set it, so the games map was permanently blank. This module fills the absence.
//
// It writes into a WORLD-READABLE document, so it inherits the location contract of
// packages/shared/src/publicTaskLocation.ts rather than restating it:
//   - eligibility is decided by `publicTaskLocation` itself, so locationless tasks
//     and unplaced null-island tasks contribute NOTHING, while hideLocation tasks
//     contribute exactly like any other (change: hidden-location-map-visibility)
//     — one predicate, not two that can drift apart;
//   - the inputs are therefore already cell centres, and their mean is snapped back
//     onto the same grid, so the game pin is a ~1 km cell like every published task
//     pin and averaging can never sharpen it past one cell;
//   - it is a pure function of the tasks, so republishing the same game writes the
//     identical value and N observations carry as much information as one.
//
// A treasure hunt built entirely of hidden-location tasks therefore DOES derive an
// area, and should: every one of its inputs is itself a published `approxLocation`
// on a world-readable publicTasks document, and a mean of published cell centres,
// re-snapped to the same grid, cannot narrow anything past one cell. Excluding them
// only made the hunt invisible on the gallery map to the creator who wrote it.
// A game whose every task is locationless or unplaced still derives nothing at all.
// That is the intended outcome, not a gap: such a game has no location to state.
import type { GeoPoint, Stage } from '@rushpoint/shared';
import { approximatePublicPoint, isValidCoord, publicTaskLocation } from '@rushpoint/shared';

export type GameArea = GeoPoint & { label?: string };

/** Same "usable" rule the public task contract applies: in range, and not null island. */
function usableArea(area: { lat?: unknown; lng?: unknown } | undefined | null): boolean {
  if (!area || !isValidCoord(area.lat, area.lng)) return false;
  return !(area.lat === 0 && area.lng === 0);
}

/**
 * Derive a coarse public area for a game from its own tasks, or `undefined` when no
 * task of the game may publish a location.
 */
export function deriveGameArea(stages: Stage[] | undefined | null): GeoPoint | undefined {
  if (!Array.isArray(stages)) return undefined;
  const points: GeoPoint[] = [];
  for (const stage of stages) {
    for (const task of stage?.tasks ?? []) {
      const point = publicTaskLocation(task);
      if (point) points.push(point);
    }
  }
  if (points.length === 0) return undefined;
  const mean = {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };
  // Snap the mean back onto the grid: a derived area must be a cell centre, never an
  // average that sits between cells and says more than any of its inputs did.
  return approximatePublicPoint(mean);
}

/**
 * What `publishGame` (and the published-game resync) should write as the gallery
 * entry's area: an authored area wins verbatim — including its label, which the
 * gallery card renders — and derivation only ever fills an absence.
 */
export function resolveGameArea(
  authored: GameArea | undefined | null,
  stages: Stage[] | undefined | null,
): GameArea | undefined {
  if (usableArea(authored)) return authored as GameArea;
  return deriveGameArea(stages);
}
