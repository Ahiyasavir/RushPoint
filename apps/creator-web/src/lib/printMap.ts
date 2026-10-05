// The host sheet's street map, laid out for paper (change: host-sheet-street-map).
//
// A live MapLibre map draws into a WebGL canvas, and a canvas often prints blank,
// which is why the sheet used to draw numbered dots on white. Map TILES are just
// pictures: laid out as <img>s at fixed positions they print like any other image.
// So this file does the Web Mercator arithmetic (which zoom, which tiles, where each
// station sits) and the page only places what it returns.
//
// Every position is a FRACTION of the frame, so the same layout fills a phone or an
// A4 page without being recomputed. Total: junk input yields no map, never a throw
// (scripts/test-print-map.ts).

export interface PrintMapPoint {
  number: number;
  stage: number;
  lat: number;
  lng: number;
}

export interface PrintMapTile {
  z: number;
  /** Tile column, already wrapped into 0..2^z-1. */
  x: number;
  y: number;
  /** Position and size as fractions of the frame. */
  left: number;
  top: number;
  w: number;
  h: number;
}

export interface PrintMapLayout {
  zoom: number;
  widthPx: number;
  heightPx: number;
  tiles: PrintMapTile[];
  /** Marker centres as fractions of the frame (x right, y down, north up). */
  markers: { number: number; stage: number; x: number; y: number }[];
}

export const PRINT_MAP_MAX_PX = 680;
const TILE = 256;
/** Room around the outermost stations, so a marker is never cut by the edge. */
const PAD_PX = 48;
/**
 * The frame is always at least this big, so a tight cluster of stations still
 * shows the streets that lead to it: a host on foot needs the way there, not
 * only the dots.
 */
const MIN_W = PRINT_MAP_MAX_PX;
const MIN_H = 480;
/** Street level for a game whose stations are all at one spot. */
const SINGLE_POINT_ZOOM = 16;
const MAX_LAT = 85.0511;

const worldPx = (z: number) => TILE * 2 ** z;
const lngToPx = (lng: number, z: number) => ((lng + 180) / 360) * worldPx(z);
function latToPx(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * worldPx(z);
}

function validPoints(points: readonly PrintMapPoint[] | null | undefined): PrintMapPoint[] {
  if (!Array.isArray(points)) return [];
  return points.filter((p): p is PrintMapPoint => !!p
    && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && Math.abs(p.lat) <= MAX_LAT && Math.abs(p.lng) <= 180);
}

/**
 * The largest zoom in [minZoom, maxZoom] at which every station plus a margin fits
 * a frame of at most PRINT_MAP_MAX_PX on each side, and the tiles and markers for
 * it. Stations all at one spot use zoom 16. Null when nothing is placeable or no
 * zoom in the range fits.
 */
export function printMapLayout(
  points: readonly PrintMapPoint[] | null | undefined,
  opts: { minZoom?: number; maxZoom?: number } = {},
): PrintMapLayout | null {
  try {
    const pts = validPoints(points);
    if (pts.length === 0) return null;
    const minZoom = Math.max(0, Math.floor(opts?.minZoom ?? 3));
    const maxZoom = Math.min(17, Math.floor(opts?.maxZoom ?? 17));
    if (minZoom > maxZoom) return null;

    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const onePlace = Math.max(...lats) - Math.min(...lats) < 1e-7 && Math.max(...lngs) - Math.min(...lngs) < 1e-7;

    let zoom = -1;
    if (onePlace) {
      zoom = Math.min(SINGLE_POINT_ZOOM, maxZoom);
      if (zoom < minZoom) return null;
    } else {
      for (let z = maxZoom; z >= minZoom; z--) {
        const spanX = lngToPx(Math.max(...lngs), z) - lngToPx(Math.min(...lngs), z);
        const spanY = latToPx(Math.min(...lats), z) - latToPx(Math.max(...lats), z);
        if (spanX + 2 * PAD_PX <= PRINT_MAP_MAX_PX && spanY + 2 * PAD_PX <= PRINT_MAP_MAX_PX) { zoom = z; break; }
      }
      if (zoom < 0) return null;
    }

    const xs = pts.map((p) => lngToPx(p.lng, zoom));
    const ys = pts.map((p) => latToPx(p.lat, zoom));
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    const widthPx = Math.round(Math.min(PRINT_MAP_MAX_PX, Math.max(MIN_W, spanX + 2 * PAD_PX)));
    const heightPx = Math.round(Math.min(PRINT_MAP_MAX_PX, Math.max(MIN_H, spanY + 2 * PAD_PX)));
    const originX = (Math.max(...xs) + Math.min(...xs)) / 2 - widthPx / 2;
    const originY = (Math.max(...ys) + Math.min(...ys)) / 2 - heightPx / 2;

    const n = 2 ** zoom;
    const tiles: PrintMapTile[] = [];
    const firstX = Math.floor(originX / TILE);
    const lastX = Math.floor((originX + widthPx - 1e-9) / TILE);
    const firstY = Math.floor(originY / TILE);
    const lastY = Math.floor((originY + heightPx - 1e-9) / TILE);
    for (let ty = firstY; ty <= lastY; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = firstX; tx <= lastX; tx++) {
        tiles.push({
          z: zoom,
          x: ((tx % n) + n) % n,
          y: ty,
          left: (tx * TILE - originX) / widthPx,
          top: (ty * TILE - originY) / heightPx,
          w: TILE / widthPx,
          h: TILE / heightPx,
        });
      }
    }

    const markers = pts.map((p, i) => ({
      number: p.number,
      stage: p.stage,
      x: (xs[i] - originX) / widthPx,
      y: (ys[i] - originY) / heightPx,
    }));
    return { zoom, widthPx, heightPx, tiles, markers };
  } catch {
    return null;
  }
}

const OPENTOPO_HOSTS = ['a', 'b', 'c'] as const;

/**
 * One map tile's address: MapTiler streets with a key (the clearest print), the
 * keyless OpenTopoMap otherwise, the same fallback the live maps use. Column wraps.
 */
export function printTileUrl(z: number, x: number, y: number, key: string | null | undefined): string {
  const n = 2 ** z;
  const col = ((Math.floor(x) % n) + n) % n;
  const k = typeof key === 'string' ? key.trim() : '';
  if (k) return `https://api.maptiler.com/maps/streets-v2/256/${z}/${col}/${y}.png?key=${encodeURIComponent(k)}`;
  return `https://${OPENTOPO_HOSTS[(col + y) % 3]}.tile.opentopomap.org/${z}/${col}/${y}.png`;
}

/** A marker label, possibly carrying several missions that share one spot. */
export interface PrintMapMarkerGroup {
  numbers: number[];
  stage: number;
  x: number;
  y: number;
}

/**
 * Markers closer than a marker's own size become ONE label ("4·5·6"): a station
 * that hosts several missions would otherwise stack its circles and hide every
 * number but the top one. Groups by distance in frame pixels, keeps the first
 * marker's position, lists numbers in order. Total.
 */
export function mergeMarkers(
  markers: readonly PrintMapLayout['markers'][number][] | null | undefined,
  widthPx: number,
  heightPx: number,
  radiusPx = 24,
): PrintMapMarkerGroup[] {
  if (!Array.isArray(markers)) return [];
  const groups: PrintMapMarkerGroup[] = [];
  for (const m of markers) {
    if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    const near = groups.find((g) => Math.hypot((g.x - m.x) * widthPx, (g.y - m.y) * heightPx) < radiusPx);
    if (near) near.numbers.push(m.number);
    else groups.push({ numbers: [m.number], stage: m.stage, x: m.x, y: m.y });
  }
  for (const g of groups) g.numbers.sort((a, b) => a - b);
  return groups;
}
