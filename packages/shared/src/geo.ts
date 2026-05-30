// ═══════════════════════════════════════════════════════════════════════════════
// Canonical race geography — single source of truth for BOTH apps + the seed.
//
// The event runs in Ramot Bet, Jerusalem: from Motza, up through Arazim Valley
// Park, to Gan HaKipod (Ramot, Derech HaHoresh — beside Ramot Forest). ~200m of
// climb, which is why the maps use a topographic style (the hills are the point).
//
// ⚠️ These coordinates are RESEARCHED APPROXIMATIONS — verify each one on the
// ground (GPS walk) before the event and adjust. The 6-stage flow maps onto the
// route: 3 green field missions → gate (matchmaking) → orange (find the Tene) →
// gold (craft + judge, the finish at Gan HaKipod).
// ═══════════════════════════════════════════════════════════════════════════════

import type { GeoPoint } from './types';

/** Map default center — frames the whole Motza→Gan HaKipod route at ~zoom 13.5. */
export const RACE_CENTER: GeoPoint = { lat: 31.803, lng: 35.176 };
export const RACE_DEFAULT_ZOOM = 13.5;

/** The starting point of the race (Motza / Arazim valley floor). */
export const RACE_START: GeoPoint = { lat: 31.7905, lng: 35.164 };

/** Gan HaKipod — the finish (Ramot, Derech HaHoresh). */
export const RACE_FINISH: GeoPoint = { lat: 31.8155, lng: 35.1875 };

export type StationType = 'green' | 'gate' | 'orange' | 'gold';

export interface StationGeo {
  /** Matches the Firestore task id where one exists (gate has no task). */
  id: string;
  type: StationType;
  /** Slot index in the 6-stage board (0–5). */
  slot: number;
  lat: number;
  lng: number;
}

/** Ordered stations along the route (Motza → Gan HaKipod). */
export const STATION_GEO: readonly StationGeo[] = [
  { id: 'task-green-001',  type: 'green',  slot: 0, lat: 31.795,  lng: 35.169  },
  { id: 'task-green-002',  type: 'green',  slot: 1, lat: 31.801,  lng: 35.174  },
  { id: 'task-green-003',  type: 'green',  slot: 2, lat: 31.807,  lng: 35.18   },
  { id: 'gate',            type: 'gate',   slot: 3, lat: 31.811,  lng: 35.184  },
  { id: 'task-orange-001', type: 'orange', slot: 4, lat: 31.814,  lng: 35.1865 },
  { id: 'task-gold-001',   type: 'gold',   slot: 5, lat: 31.8155, lng: 35.1875 },
] as const;

/**
 * Ordered polyline for the route line drawn on the maps: start → each station →
 * finish (the last station IS the finish, so it isn't duplicated).
 */
export const ROUTE_PATH: readonly GeoPoint[] = [
  RACE_START,
  ...STATION_GEO.map((s) => ({ lat: s.lat, lng: s.lng })),
];

/** GeoJSON LineString for the route (MapLibre Source data). lng,lat order. */
export const ROUTE_GEOJSON = {
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'LineString' as const,
    coordinates: ROUTE_PATH.map((p) => [p.lng, p.lat]),
  },
};

/** Marker colours per station type (hex with '#', shared by both maps). */
export const STATION_COLOR: Record<StationType, string> = {
  green:  '#10b981',
  gate:   '#3b82f6',
  orange: '#f97316',
  gold:   '#f59e0b',
};

/** Look up a station's coordinates by its Firestore task id. */
export function stationCoord(taskId: string): GeoPoint | undefined {
  const s = STATION_GEO.find((x) => x.id === taskId);
  return s ? { lat: s.lat, lng: s.lng } : undefined;
}

// ─── Web-Mercator projection (for the mobile "You Are Here" overlay) ──────────
// The mobile mission map is a STATIC image. To overlay a live GPS dot accurately
// we render the image with a KNOWN center+zoom (not auto-fit) and project the
// device's lat/lng into pixel/percent coordinates against that exact frame.

/** Normalised world coordinates in [0,1] (Web Mercator). */
function worldX(lng: number): number {
  return (lng + 180) / 360;
}
function worldY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
function lngFromWorldX(x: number): number {
  return x * 360 - 180;
}
function latFromWorldY(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

export interface MapView {
  centerLng: number;
  centerLat: number;
  zoom: number;
}

/**
 * Compute the center + (fractional) zoom that frames the whole ROUTE_PATH within
 * a width×height image, leaving `pad` fractional padding on each edge. Used BOTH
 * to build the static-map URL and to project the GPS dot — identical (w,h) in →
 * identical frame, so the dot lines up.
 */
export function fitRouteView(width: number, height: number, pad = 0.12): MapView {
  const xs = ROUTE_PATH.map((p) => worldX(p.lng));
  const ys = ROUTE_PATH.map((p) => worldY(p.lat));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Zoom that fits the bbox (with padding) in both axes; 256px tiles.
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const fit = (px: number, span: number) =>
    Math.log2((px * (1 - 2 * pad)) / (span * 256));
  let zoom = Math.min(fit(width, spanX), fit(height, spanY));
  zoom = Math.max(1, Math.min(18, zoom)); // clamp to sane range

  return { centerLng: lngFromWorldX(cx), centerLat: latFromWorldY(cy), zoom };
}

export interface Projected {
  leftPct: number;  // 0..100 across the image width
  topPct: number;   // 0..100 down the image height
  inBounds: boolean; // true if the point falls inside the image frame
}

/** Project a lat/lng to percent-position over a width×height image at `view`. */
export function projectToPixel(lat: number, lng: number, width: number, height: number, view: MapView): Projected {
  const scale = 256 * Math.pow(2, view.zoom);
  const px = worldX(lng) * scale;
  const py = worldY(lat) * scale;
  const cx = worldX(view.centerLng) * scale;
  const cy = worldY(view.centerLat) * scale;
  const x = width / 2 + (px - cx);
  const y = height / 2 + (py - cy);
  return {
    leftPct: (x / width) * 100,
    topPct: (y / height) * 100,
    inBounds: x >= 0 && x <= width && y >= 0 && y <= height,
  };
}
