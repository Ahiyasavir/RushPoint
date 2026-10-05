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
  /** World pixel of the frame's top-left corner at `zoom` (host-sheet-map-context: the overview
   *  is centred on the same spot). */
  originX: number;
  originY: number;
}

/** The "where is this" map beside the detail map (change: host-sheet-map-context). */
export interface PrintOverviewLayout {
  zoom: number;
  widthPx: number;
  heightPx: number;
  tiles: PrintMapTile[];
  /** The detail map's frame, as fractions of the overview frame. */
  detailRect: { left: number; top: number; w: number; h: number };
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
/**
 * The detail map never goes closer than this (host-sheet-map-context, 2026-10-05). At 17 a tight
 * cluster showed a few houses and no names; 16 still reads street by street on foot.
 */
const MAX_DETAIL_ZOOM = 16;
/** The overview sits this many levels further out than the detail map, so towns are named. */
export const OVERVIEW_ZOOM_STEP = 3;
const OVERVIEW_W = 320;
const OVERVIEW_H = 240;
const MAX_LAT = 85.0511;

const worldPx = (z: number) => TILE * 2 ** z;
const lngToPx = (lng: number, z: number) => ((lng + 180) / 360) * worldPx(z);
function latToPx(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * worldPx(z);
}

/** Every tile that covers the frame, positioned as fractions of it. */
function tilesForFrame(zoom: number, originX: number, originY: number, widthPx: number, heightPx: number): PrintMapTile[] {
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
  return tiles;
}

/**
 * The "where is this" overview for a detail map (change: host-sheet-map-context). Ahiya,
 * 2026-10-05: a station in open fields printed as thin lines with no name at all. The overview is
 * OVERVIEW_ZOOM_STEP levels further out, centred on the same spot, with the detail frame marked,
 * so the sheet always says which town or road this is. Null when the detail is already a
 * country-scale map (nothing further out would help) or there is no detail map.
 */
export function printOverviewLayout(detail: PrintMapLayout | null | undefined): PrintOverviewLayout | null {
  try {
    if (!detail || !Number.isFinite(detail.originX) || !Number.isFinite(detail.originY)) return null;
    const zoom = detail.zoom - OVERVIEW_ZOOM_STEP;
    if (zoom < 3) return null;
    const scale = 2 ** OVERVIEW_ZOOM_STEP;
    const cx = (detail.originX + detail.widthPx / 2) / scale;
    const cy = (detail.originY + detail.heightPx / 2) / scale;
    const originX = cx - OVERVIEW_W / 2;
    const originY = cy - OVERVIEW_H / 2;
    const w = detail.widthPx / scale / OVERVIEW_W;
    const h = detail.heightPx / scale / OVERVIEW_H;
    return {
      zoom,
      widthPx: OVERVIEW_W,
      heightPx: OVERVIEW_H,
      tiles: tilesForFrame(zoom, originX, originY, OVERVIEW_W, OVERVIEW_H),
      detailRect: { left: 0.5 - w / 2, top: 0.5 - h / 2, w, h },
    };
  } catch {
    return null;
  }
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
    const maxZoom = Math.min(MAX_DETAIL_ZOOM, Math.floor(opts?.maxZoom ?? MAX_DETAIL_ZOOM));
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

    const tiles = tilesForFrame(zoom, originX, originY, widthPx, heightPx);

    const markers = pts.map((p, i) => ({
      number: p.number,
      stage: p.stage,
      x: (xs[i] - originX) / widthPx,
      y: (ys[i] - originY) / heightPx,
    }));
    return { zoom, widthPx, heightPx, tiles, markers, originX, originY };
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
  // @2x: the same 256px layout drawn from 512px images, so street and place names stay sharp on
  // paper (host-sheet-map-context). OpenTopoMap has no retina tiles.
  if (k) return `https://api.maptiler.com/maps/streets-v2/256/${z}/${col}/${y}@2x.png?key=${encodeURIComponent(k)}`;
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
