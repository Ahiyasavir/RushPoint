// What view the Builder's map picker OPENS on (change: location-picker-game-anchor).
//
// LocationPicker used to decide this from the edited task's own coordinates and
// nothing else, so a mission with no pin — every mission a creator adds — opened
// at zoom 8 over central Israel, and the neighbourhood had to be re-found by hand
// once per mission even though the game had already answered where it happens.
//
// The decision lives here rather than inline in the component for the usual
// reason: creator-web has no component test runner, so anything decided inside a
// .tsx is decided unobserved. See scripts/test-map-anchor.ts.
import { isValidCoord } from '@rushpoint/shared';

/** Central Israel — the view a game with nothing placed anywhere still opens on. */
export const DEFAULT_CENTER: [number, number] = [35.21, 31.77];
export const DEFAULT_ZOOM = 8;
/** Unchanged from before this change: a mission that has its own pin opens on it. */
export const SELF_ZOOM = 14;

/** The neighbourhood the anchored view promises to show — a 100m radius around the game. */
export const ANCHOR_RADIUS_METERS = 100;
export const MIN_ANCHOR_ZOOM = 8;
/**
 * A ceiling, not a target. Past ~18 the tiles are rooftops and a street is harder
 * to identify, not easier — and the derived zoom exceeds it on tall containers.
 */
export const MAX_ANCHOR_ZOOM = 18;
/**
 * Small on purpose: fitBounds padding is applied to BOTH sides, and the shortest
 * container the picker is given is `h-44` (176px). Anything generous inverts the
 * viewport there instead of framing it.
 */
export const ANCHOR_PADDING_PX = 24;
/** Used when the container cannot be measured (hidden panel, pre-layout, jsdom). */
const FALLBACK_VIEWPORT_PX = 200;

/** Metres per pixel at the equator, zoom 0 — the Web-Mercator constant. */
const EQUATOR_METERS_PER_PIXEL = 156543.03392;

export type LatLng = { lat: number; lng: number };

export type InitialView =
  | { kind: 'point'; center: [number, number]; zoom: number }
  | {
      kind: 'bounds';
      /** [[west, south], [east, north]] — MapLibre's LngLatBoundsLike order. */
      bounds: [[number, number], [number, number]];
      maxZoom: number;
      padding: number;
    };

/**
 * Is this coordinate really PLACED?
 *
 * `isValidCoord` alone is not enough: (0,0) is the codebase's "unplaced"
 * placeholder and sits inside the valid lat/lng range, so a check built on range
 * alone would anchor every brand-new game to the Gulf of Guinea — a confidently
 * wrong place, which is worse than the country view it replaced.
 */
export function isPlacedCoord(c: unknown): c is LatLng {
  if (!c || typeof c !== 'object') return false;
  const { lat, lng } = c as Partial<LatLng>;
  return isValidCoord(lat, lng) && (lat !== 0 || lng !== 0);
}

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return MIN_ANCHOR_ZOOM;
  return Math.min(MAX_ANCHOR_ZOOM, Math.max(MIN_ANCHOR_ZOOM, z));
}

/**
 * The zoom at which `radiusMeters` around a point fills a `viewportPx`-tall map.
 *
 * DERIVED rather than a constant, because Web-Mercator metres-per-pixel is
 * `EQUATOR_METERS_PER_PIXEL * cos(lat) / 2^z`: a hardcoded 17 would deliver the
 * promised 100m only at the one latitude and one map height it was eyeballed on,
 * and would silently mean something else on a phone, in `fill` mode, or in Europe.
 * Totally clamped, so a container reporting 0px cannot put a NaN on the camera.
 */
export function neighbourhoodZoom(
  lat: number,
  viewportPx: number,
  radiusMeters: number = ANCHOR_RADIUS_METERS,
): number {
  const safeLat = Number.isFinite(lat) ? Math.min(85, Math.max(-85, lat)) : 0;
  const px = Number.isFinite(viewportPx) && viewportPx > 0 ? viewportPx : FALLBACK_VIEWPORT_PX;
  const radius = Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : ANCHOR_RADIUS_METERS;
  const metersPerPixelAtZoom0 = EQUATOR_METERS_PER_PIXEL * Math.cos((safeLat * Math.PI) / 180);
  return clampZoom(Math.log2((metersPerPixelAtZoom0 * px) / (2 * radius)));
}

const defaultView = (): InitialView => ({ kind: 'point', center: [...DEFAULT_CENTER], zoom: DEFAULT_ZOOM });

/**
 * Where the picker's map opens, in three ordered branches:
 *
 *   1. the edited mission's own pin — unchanged behaviour, so a placed mission
 *      cannot regress however the anchors are computed;
 *   2. the bounds of everything the surrounding game HAS placed, capped at the
 *      neighbourhood zoom (so a lone pin, or a tight cluster, lands at ~100m
 *      rather than on a rooftop, while a route spread over a kilometre is still
 *      shown whole);
 *   3. the platform default.
 *
 * Total: every malformed shape falls through to branch 3 rather than throwing.
 * This reads stored game data of any age, and a non-finite number reaching
 * MapLibre's camera is not recoverable.
 */
export function resolveInitialView(opts?: {
  self?: LatLng | null;
  anchors?: readonly (LatLng | null | undefined)[];
  viewportPx?: number;
}): InitialView {
  if (!opts || typeof opts !== 'object') return defaultView();

  if (isPlacedCoord(opts.self)) {
    return { kind: 'point', center: [opts.self.lng, opts.self.lat], zoom: SELF_ZOOM };
  }

  const placed = Array.isArray(opts.anchors) ? opts.anchors.filter(isPlacedCoord) : [];
  if (placed.length === 0) return defaultView();

  let west = placed[0].lng;
  let east = placed[0].lng;
  let south = placed[0].lat;
  let north = placed[0].lat;
  for (const p of placed) {
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }

  return {
    kind: 'bounds',
    bounds: [[west, south], [east, north]],
    // A CEILING on how far fitBounds may zoom in — it governs the single-pin and
    // tight-cluster cases, and is simply not reached by a spread-out game.
    maxZoom: neighbourhoodZoom((south + north) / 2, opts.viewportPx as number),
    padding: ANCHOR_PADDING_PX,
  };
}
