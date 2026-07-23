// "Focus the map back on me" — the verdict behind the participant map's recentre
// control (change: play-map-recenter-control).
//
// The control looks logic-free, which is exactly why its logic must live somewhere
// testable: play-web has NO component test runner, so anything decided inline in
// NavMap.tsx is decided unobserved. Two failure modes justify a module:
//
//   1. easeTo(NaN) — MapLibre does not recover from a non-finite camera; ONE
//      garbage GPS frame would permanently break the map for a racing player. So
//      this is TOTAL and never emits a non-finite number, for any input, including
//      inputs that are not objects at all. Even a DISABLED verdict carries a
//      usable `zoom`, so a caller reading it blind cannot produce NaN either.
//   2. the axis swap — [lng, lat] vs [lat, lng] is the most repeated bug in map
//      code. It is decided ONCE, here, in MapLibre's own order, so the component
//      never re-derives it.
//
// Not a blocking guard: nothing on a submit / check-in / navigation path reads
// this. The platform's fail-open rule applies to it as "a disabled recentre button
// must never be able to block anything else on the screen", NOT as "recentre
// anyway" — flying the camera to a coordinate we do not have is not an open door,
// it is a wrong answer. What it must never do is look active and silently do
// nothing, which is precisely the built-in control this replaces.
//
// No clock, no randomness, no I/O, no mutation of its argument.

/** Zoom the camera settles at when the player asks to be recentred. */
export const RECENTER_ZOOM = 16;
/** MapLibre's usable zoom floor for this map. */
export const RECENTER_MIN_ZOOM = 1;
/** MapLibre's usable zoom ceiling for this map. */
export const RECENTER_MAX_ZOOM = 20;

export type RecenterReason = 'ok' | 'no_fix';

export interface RecenterVerdict {
  /** May the control be tapped? */
  enabled: boolean;
  /** Why not, when it may not. Drives the control's accessible name. */
  reason: RecenterReason;
  /** [lng, lat] — MapLibre order. `null` whenever the verdict is disabled. */
  center: [number, number] | null;
  /** Always finite and within [RECENTER_MIN_ZOOM, RECENTER_MAX_ZOOM]. */
  zoom: number;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Clamp a requested zoom, falling back to the default for anything unusable. */
function resolveZoom(requested: unknown): number {
  if (!isFiniteNumber(requested)) return RECENTER_ZOOM;
  return Math.min(RECENTER_MAX_ZOOM, Math.max(RECENTER_MIN_ZOOM, requested));
}

/**
 * Can the map be recentred on this position, and where should the camera land?
 *
 * A position is usable when both axes are finite numbers in range AND it is not
 * the null-island placeholder `(0, 0)` — `blankTask()` ships that as "not placed
 * yet" and a phone with no fix reports it often enough that flying the player to
 * the Gulf of Guinea is a real outcome, not a hypothetical.
 */
export function recenterVerdict(
  me: { lat?: unknown; lng?: unknown } | null | undefined,
  opts?: { zoom?: unknown },
): RecenterVerdict {
  const zoom = resolveZoom(opts?.zoom);
  const noFix: RecenterVerdict = { enabled: false, reason: 'no_fix', center: null, zoom };
  if (!me || typeof me !== 'object' || Array.isArray(me)) return noFix;
  const { lat, lng } = me as { lat?: unknown; lng?: unknown };
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return noFix;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return noFix;
  if (lat === 0 && lng === 0) return noFix;
  return { enabled: true, reason: 'ok', center: [lng, lat], zoom };
}
