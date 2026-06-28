// Surprise trivia waypoints / discovery POIs (change: surprise-trivia-waypoints).
// Pure logic shared by the claimDiscoveryPoi callable and (later) the play overlay.
// POI coordinates + answers are SERVER-SECRET — these helpers run server-side for
// validation; the Overpass query builder runs client-side in the Builder.
import type { GeoPoint } from './types';
import { haversineKm } from './geo';

/** A hidden geofenced trivia waypoint placed on a game (server-secret fields). */
export interface DiscoveryPoi {
  id: string;
  coordinates: GeoPoint;   // SERVER-SECRET — never sent to play clients
  radiusMeters: number;
  title: string;
  flavorText?: string;
  question: string;
  answers: string[];       // SERVER-SECRET — checked via matchesDiscoveryAnswer
  bonusPoints: number;
  hint?: string;
}

/** Coordinate- and answer-stripped POI shape safe to send to play clients. */
export interface DiscoveryPoiResult {
  id: string;
  title: string;
  flavorText?: string;
  question: string;
  radiusMeters: number;
  bonusPoints: number;
  hasHint?: boolean;
}

/** Per-team discovery progress: poiId → lifecycle state. */
export type TeamDiscoveryState = Record<string, 'triggered' | 'answered' | 'missed'>;

/** Strip a POI to the client-safe shape (no coordinates, no answer key). */
export function toDiscoveryPoiResult(poi: DiscoveryPoi): DiscoveryPoiResult {
  return {
    id: poi.id,
    title: poi.title,
    flavorText: poi.flavorText,
    question: poi.question,
    radiusMeters: poi.radiusMeters,
    bonusPoints: poi.bonusPoints,
    hasHint: !!poi.hint,
  };
}

/**
 * True when `coords` is within `radiusMeters` of `center` (boundary inclusive).
 * Throws LocationError (via haversineKm) on invalid coordinates — callers decide
 * how to treat that; the callable maps it to a precondition failure.
 */
export function isWithinPoiRadius(center: GeoPoint, coords: GeoPoint, radiusMeters: number): boolean {
  const distM = haversineKm(center, coords) * 1000;
  return distM <= radiusMeters;
}

/** Normalise an answer for comparison: trim, lowercase, strip diacritics. */
function normalizeAnswer(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

/** Case-, whitespace-, and diacritic-insensitive answer match against the key list. */
export function matchesDiscoveryAnswer(answers: string[] | undefined, raw: string): boolean {
  if (!answers || answers.length === 0) return false;
  const given = normalizeAnswer(raw);
  if (!given) return false;
  return answers.some((a) => normalizeAnswer(a) === given);
}

/** A POI is "claimed" (no re-trigger) only once it has been correctly answered. */
export function isPoiAlreadyClaimed(state: TeamDiscoveryState | undefined, poiId: string): boolean {
  return state?.[poiId] === 'answered';
}

/**
 * Build an injection-safe Overpass QL query for landmark POIs within a bbox.
 * All numeric bounds are coerced to numbers so no string can reach the query;
 * the OSM tag filters are a fixed allow-list.
 */
export function buildOverpassQuery(bounds: { south: number; west: number; north: number; east: number }): string {
  const s = Number(bounds.south), w = Number(bounds.west), n = Number(bounds.north), e = Number(bounds.east);
  if ([s, w, n, e].some((v) => !Number.isFinite(v))) {
    throw new Error('Invalid Overpass bounds');
  }
  const bbox = `${s},${w},${n},${e}`;
  // Fixed allow-list of "interesting landmark" tags — no interpolation of user input.
  const filters = [
    'node["historic"]',
    'node["tourism"="attraction"]',
    'node["tourism"="artwork"]',
    'node["amenity"="fountain"]',
    'node["natural"="peak"]',
  ];
  const body = filters.map((f) => `  ${f}(${bbox});`).join('\n');
  return `[out:json][timeout:25];\n(\n${body}\n);\nout center 40;`;
}
