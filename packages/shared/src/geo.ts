// ─── Geo utilities — generic, not tied to any specific race geography ─────────
//
// These utilities are used by routing, heatmaps, and map display.
// All event-specific geography (race route, station coordinates) lives in the
// Firestore game template (Game.stages[].tasks[].coordinates), not here.

import type { GeoPoint, TriggerMode, GameRequirement } from './types';


// ─── Coordinate validation ────────────────────────────────────────────────────

export const INVALID_LOCATION = 'INVALID_LOCATION' as const;

export function isValidCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export class LocationError extends Error {
  readonly code = INVALID_LOCATION;
  constructor(message = 'Invalid coordinates') {
    super(message);
    this.name = 'LocationError';
  }
}


// ─── Distance ─────────────────────────────────────────────────────────────────

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  if (!a || !b || !isValidCoord(a.lat, a.lng) || !isValidCoord(b.lat, b.lng)) {
    throw new LocationError();
  }
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}


// ─── Task trigger modes (change: task-trigger-modes) ──────────────────────────
// Shared by the server completion gate (functions/src/runs/index.ts completeTask)
// and the creator wizard so the proximity rule can't drift between them.

/** Default trigger radius (metres) for a mode. 0 means "no proximity gate". */
export function defaultRadiusFor(mode: TriggerMode): number {
  switch (mode) {
    case 'radius': return 40;
    case 'exact':  return 4;
    case 'instant':
    case 'locationless':
    default:       return 0;
  }
}

/**
 * Evaluate whether a task may complete given the participant's distance from the
 * task coordinates. `radius`/`exact` require a finite distance within the radius
 * (defaulting to defaultRadiusFor); `instant`/`locationless` always pass (no GPS).
 */
export function evaluateTrigger(
  mode: TriggerMode,
  distanceM: number | undefined,
  radiusM?: number,
): { ok: boolean; reason?: string } {
  if (mode === 'instant' || mode === 'locationless') return { ok: true };
  if (distanceM == null || !Number.isFinite(distanceM)) {
    return { ok: false, reason: 'Location required to check in here' };
  }
  const limit = radiusM != null && Number.isFinite(radiusM) ? radiusM : defaultRadiusFor(mode);
  if (distanceM > limit) {
    return { ok: false, reason: `Too far from the spot (${Math.round(distanceM)}m away)` };
  }
  return { ok: true };
}

/**
 * Resolve the effective trigger mode for a (possibly legacy) task. An explicit
 * `triggerMode` wins; otherwise `locationless` → 'locationless', a `geofence`
 * type → 'radius', and everything else defaults to 'radius'. Keeps the invariant
 * locationless ⇔ 'locationless'.
 */
export function normalizeTriggerMode(task: {
  triggerMode?: TriggerMode;
  locationless?: boolean;
  type?: string;
}): TriggerMode {
  if (task.triggerMode) return task.triggerMode;
  if (task.locationless) return 'locationless';
  // 'geofence' type and any plain located task both behave as a radius gate.
  return 'radius';
}


// ─── Game welcome-screen helpers (change: fix-live-launch-demo-text) ──────────
// Derive an ACCURATE requirement indicator from real task config instead of
// trusting free-text claims in a description (which is how demo placeholder copy
// leaked onto live games). Returns only enum keys — never any placeholder text.

/** 'gps' if any task is located (radius/exact); 'anywhere' if all are instant/locationless. */
export function describeGameRequirements(game: {
  stages?: Array<{ tasks?: Array<{ triggerMode?: TriggerMode; locationless?: boolean; type?: string }> }>;
}): GameRequirement {
  for (const stage of game.stages ?? []) {
    for (const task of stage.tasks ?? []) {
      const mode = normalizeTriggerMode(task);
      if (mode === 'radius' || mode === 'exact') return 'gps';
    }
  }
  return 'anywhere';
}

/** The real game description, trimmed. Blank/whitespace → '' so the UI shows a
 *  neutral empty state rather than any demo fallback copy. */
export function selectGameDescription(game: { description?: string }): string {
  const d = (game.description ?? '').trim();
  return d;
}


// ─── Web-Mercator projection (for static map overlays) ────────────────────────
// Used when showing a GPS "You Are Here" dot over a fixed static map image.
// TILE_SIZE = 512 must match the map tile provider (e.g. MapTiler).

const TILE_SIZE = 512;

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

export function fitBoundsView(
  width: number,
  height: number,
  points: readonly GeoPoint[],
  pad = 0.12,
): MapView {
  if (points.length === 0) {
    return { centerLat: 0, centerLng: 0, zoom: 2 };
  }
  const xs = points.map((p) => worldX(p.lng));
  const ys = points.map((p) => worldY(p.lat));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const fit = (px: number, span: number) =>
    Math.log2((px * (1 - 2 * pad)) / (span * TILE_SIZE));
  let zoom = Math.min(fit(width, spanX), fit(height, spanY));
  zoom = Math.max(1, Math.min(18, zoom));
  return { centerLng: lngFromWorldX(cx), centerLat: latFromWorldY(cy), zoom };
}

export interface Projected {
  leftPct: number;
  topPct: number;
  inBounds: boolean;
}

export function projectToPixel(
  lat: number,
  lng: number,
  width: number,
  height: number,
  view: MapView,
): Projected {
  const scale = TILE_SIZE * Math.pow(2, view.zoom);
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


// ─── Marker color helper ──────────────────────────────────────────────────────
// Generic stage-order colors for map markers (no hardcoded slot types).

export function stageMarkerColor(stageOrder: number): string {
  const PALETTE = [
    '#10b981', // emerald
    '#3b82f6', // blue
    '#f97316', // orange
    '#f59e0b', // amber
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#14b8a6', // teal
    '#ef4444', // red
  ];
  return PALETTE[stageOrder % PALETTE.length];
}


// ─── GeoJSON helpers ──────────────────────────────────────────────────────────

export function routeGeoJSON(points: readonly GeoPoint[]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: points.map((p) => [p.lng, p.lat]),
    },
  };
}

/** Compute a center + zoom that frames all task coordinates in a game. */
export function gameMapView(
  stages: Array<{ tasks: Array<{ coordinates?: GeoPoint }> }>,
  width = 800,
  height = 600,
): MapView {
  const points: GeoPoint[] = [];
  for (const stage of stages) {
    for (const task of stage.tasks) {
      if (task.coordinates && isValidCoord(task.coordinates.lat, task.coordinates.lng)) {
        points.push(task.coordinates);
      }
    }
  }
  return fitBoundsView(width, height, points);
}
