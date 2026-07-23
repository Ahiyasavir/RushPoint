// Safe-zone boundary (change: safe-zone-boundary). An organizer defines a circular
// play area; the server detects when a team's reported location leaves it. Pure +
// reuses haversineKm so the breach rule is unit-tested and server-authoritative.
import { haversineKm, isValidCoord } from './geo';

export interface SafeZone {
  center: { lat: number; lng: number };
  radiusMeters: number;
}

/**
 * True when `coords` is OUTSIDE the safe zone. No zone (or a non-positive radius)
 * means "no boundary" → never outside. Invalid coordinates throw (the caller must
 * not pass NaN/Infinity into a safety check).
 */
export function isOutsideSafeZone(
  coords: { lat: number; lng: number },
  safeZone?: SafeZone | null,
): boolean {
  if (!safeZone || !(safeZone.radiusMeters > 0)) return false;
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
    throw new Error('Invalid coordinates for safe-zone check');
  }
  const distanceM = haversineKm(coords, safeZone.center) * 1000;
  return distanceM > safeZone.radiusMeters;
}

// ─── Boundary validation (change: expose-enforced-settings) ───────────────────
//
// `updateGame` used to persist `safeZone` with a bare assignment, straight onto a
// field TWO safety paths read (`updateLocation` and the routing soft-pause). Any
// shape at all could land there. This is the door: PURE, TOTAL (never throws, for
// any input) and three-valued, because absent and cleared are different intents.

/** Widest boundary that configures anything. Past this the "play area" is a country. */
export const SAFE_ZONE_MAX_RADIUS_M = 50_000;

export type SafeZoneValidation =
  | { ok: true; value: SafeZone | undefined }
  | { ok: false; error: string };

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Validate a client-supplied safe-zone boundary.
 *
 * `undefined` ⇒ the field was not sent (no change). `null` ⇒ an explicit clear.
 * Anything else must be a well-formed boundary, or it is refused with a reason.
 *
 * An accepted boundary is REBUILT as exactly `{ center: { lat, lng }, radiusMeters }`,
 * so no extra client-supplied key rides into the enforcement path.
 *
 * A zero radius is refused rather than treated as "off": `evaluateSafeZoneStatus`
 * would read it as `no_zone`, so storing it would silently disable a boundary the
 * author believed they had configured.
 */
export function validateSafeZone(input: unknown): SafeZoneValidation {
  if (input === undefined || input === null) return { ok: true, value: undefined };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'safeZone must be an object with a center and a radius' };
  }

  const { center, radiusMeters } = input as { center?: unknown; radiusMeters?: unknown };
  if (typeof center !== 'object' || center === null || Array.isArray(center)) {
    return { ok: false, error: 'safeZone.center must be an object with lat and lng' };
  }
  const { lat, lng } = center as { lat?: unknown; lng?: unknown };
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    return { ok: false, error: 'safeZone.center lat and lng must be finite numbers' };
  }
  if (lat < -90 || lat > 90) return { ok: false, error: 'safeZone.center.lat must be between -90 and 90' };
  if (lng < -180 || lng > 180) return { ok: false, error: 'safeZone.center.lng must be between -180 and 180' };

  if (!isFiniteNumber(radiusMeters)) {
    return { ok: false, error: 'safeZone.radiusMeters must be a finite number' };
  }
  if (radiusMeters <= 0) {
    return { ok: false, error: 'safeZone.radiusMeters must be greater than 0' };
  }
  if (radiusMeters > SAFE_ZONE_MAX_RADIUS_M) {
    return { ok: false, error: `safeZone.radiusMeters must be at most ${SAFE_ZONE_MAX_RADIUS_M}` };
  }

  return { ok: true, value: { center: { lat, lng }, radiusMeters } };
}

// ─── Suggesting a boundary (change: expose-enforced-settings) ─────────────────
//
// The safe zone was enforced in two server paths, warned about on the player's
// screen and releasable from the run console — and NOTHING in either app ever set
// it, so the whole chain was dead unless a creator hand-edited a game file. Giving
// the Builder a control is the fix, but "type a centre latitude" is not a control
// anyone can use. This derives a starting boundary from the stops the creator has
// already placed, so the control opens with a play area that already fits the game.
//
// Pure and total, like everything else in this file, and unit-tested before it is
// wired to a button.
//
// It counts hideLocation tasks, unlike `publicTaskLocation`, and that difference is
// deliberate: the safe zone lives on the PRIVATE game document and is never copied
// into publicGames or any participant payload, so a hidden stop cannot leak through
// it — whereas a play area that omitted the hidden stops would fence players out of
// the very tasks they are sent to find.

/** Never suggest a zone so tight that standing at the only stop reads as a breach. */
export const SAFE_ZONE_MIN_SUGGESTED_RADIUS_M = 300;
/** Room to walk, get lost, and take the long way round, beyond the outermost stop. */
export const SAFE_ZONE_SUGGESTION_PADDING_M = 250;

export interface SafeZoneSuggestion extends SafeZone {
  /**
   * False when the game's stops are spread wider than `SAFE_ZONE_MAX_RADIUS_M` and
   * the suggestion had to be clamped. The caller must say so rather than present a
   * boundary that would flag players standing on the game's own tasks.
   */
  coversAllTasks: boolean;
}

/** A task carries a location only if it is placed, in range, and not "anywhere". */
function placedPoint(task: unknown): { lat: number; lng: number } | undefined {
  if (!task || typeof task !== 'object') return undefined;
  const t = task as { coordinates?: { lat?: unknown; lng?: unknown }; locationless?: boolean };
  if (t.locationless) return undefined;
  const c = t.coordinates;
  if (!c || typeof c !== 'object') return undefined;
  if (!isValidCoord(c.lat, c.lng)) return undefined;
  const lat = c.lat as number;
  const lng = c.lng as number;
  // Null island is the shape an unplaced task takes, not a place in the game.
  if (lat === 0 && lng === 0) return undefined;
  return { lat, lng };
}

/**
 * Derive a play area that contains every placed stop of a game, or `undefined` when
 * the game has no placed stop to build one around.
 *
 * The centre is the midpoint of the stops' extent (not their mean), so one cluster
 * of stops cannot drag the boundary off the outliers. The radius is the distance to
 * the furthest stop plus walking padding, floored at
 * `SAFE_ZONE_MIN_SUGGESTED_RADIUS_M`, rounded UP to a tidy 10 m so rounding can never
 * shrink the area below its own stops, and clamped at `SAFE_ZONE_MAX_RADIUS_M`.
 */
export function suggestSafeZone(
  stages: readonly { tasks?: unknown[] }[] | null | undefined,
): SafeZoneSuggestion | undefined {
  if (!Array.isArray(stages)) return undefined;
  const points: { lat: number; lng: number }[] = [];
  for (const stage of stages) {
    const tasks = (stage as { tasks?: unknown } | null | undefined)?.tasks;
    if (!Array.isArray(tasks)) continue;
    for (const task of tasks) {
      const point = placedPoint(task);
      if (point) points.push(point);
    }
  }
  if (points.length === 0) return undefined;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const center = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };

  const furthestM = Math.max(...points.map((p) => haversineKm(p, center) * 1000));
  const wanted = Math.max(
    SAFE_ZONE_MIN_SUGGESTED_RADIUS_M,
    Math.ceil((furthestM + SAFE_ZONE_SUGGESTION_PADDING_M) / 10) * 10,
  );
  const radiusMeters = Math.min(wanted, SAFE_ZONE_MAX_RADIUS_M);
  return { center, radiusMeters, coversAllTasks: furthestM <= radiusMeters };
}

// ─── Out-of-bounds recovery (change: out-of-bounds-recovery) ──────────────────
//
// `isOutsideSafeZone` answers "is this point outside?" — but the safe-zone LATCH
// (`team.outOfBounds`) was decided on that answer alone: no accuracy, no age, no
// override, and it THROWS on bad input. A phone that reported one imprecise fix and
// then lost GPS stayed blocked for the rest of the run, with no path back for the
// player and no override for staff.
//
// `evaluateSafeZoneStatus` is the decision the server actually needs: PURE, TOTAL
// (every input yields a verdict, it never throws) and FAIL-OPEN — an absent, stale,
// malformed or low-confidence signal is NOT proof of a violation. Only a fresh,
// confident fix that clears the boundary by more than its own error radius is a
// breach. `isOutsideSafeZone` is untouched; this wraps it after guarding the inputs.

/** How old the last known fix may be before it stops being evidence (5 min). */
export const DEFAULT_SAFE_ZONE_STALE_MS = 5 * 60 * 1000;
/** A fix worse than this can never place a team relative to a play-area boundary (200 m). */
export const DEFAULT_MAX_TRUSTED_ACCURACY_M = 200;
/** How long a staff release keeps a team un-flaggable, so one bad fix can't re-latch it (30 min). */
export const DEFAULT_OUT_OF_BOUNDS_GRACE_MS = 30 * 60 * 1000;

/** The last position a team's device reported, as stored on `teamLocations/{teamId}`. */
export interface SafeZoneFix {
  lat?: number;
  lng?: number;
  /** Reported horizontal accuracy in metres (GeolocationCoordinates.accuracy). */
  accuracyMeters?: number | null;
  /** When the fix was taken, epoch ms. Unknown ⇒ treated as stale (fail open). */
  atMs?: number | null;
}

export interface SafeZonePolicy {
  staleAfterMs?: number;
  maxTrustedAccuracyMeters?: number;
}

export type SafeZoneReason =
  | 'no_zone'         // the game has no boundary to violate
  | 'override'        // staff released this team; a human decision outranks a sensor
  | 'no_fix'          // nothing was ever reported
  | 'invalid_fix'     // coordinates missing/NaN/Infinity — malformed, not incriminating
  | 'stale_fix'       // too old (or of unknown age) to prove anything
  | 'low_confidence'  // outside by less than its own error radius, or too imprecise to use
  | 'inside'
  | 'outside';        // the ONLY reason that means out of bounds

export interface SafeZoneStatus {
  outOfBounds: boolean;
  reason: SafeZoneReason;
  /** Metres from the zone centre, when it could be computed. */
  distanceMeters: number | null;
  /** Age of the fix in ms, clamped at 0; null when unknown. */
  stalenessMs: number | null;
  /** The error radius actually applied (0 when unreported/unusable). */
  confidenceMeters: number;
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Server-authoritative, fail-open verdict on whether a team is out of bounds.
 * Precedence (fixed, and every branch but the last returns `outOfBounds: false`):
 * override → no zone → no fix → invalid fix → stale fix → low confidence → position.
 */
export function evaluateSafeZoneStatus(input: {
  fix?: SafeZoneFix | null;
  safeZone?: SafeZone | null;
  nowMs: number;
  /** Epoch ms until which a staff release suppresses the flag. */
  overrideUntilMs?: number | null;
  policy?: SafeZonePolicy;
}): SafeZoneStatus {
  const { fix, safeZone, nowMs, overrideUntilMs, policy } = input ?? ({} as never);
  const staleAfterMs = finite(policy?.staleAfterMs) && policy!.staleAfterMs! >= 0
    ? policy!.staleAfterMs!
    : DEFAULT_SAFE_ZONE_STALE_MS;
  const maxAccuracy = finite(policy?.maxTrustedAccuracyMeters) && policy!.maxTrustedAccuracyMeters! > 0
    ? policy!.maxTrustedAccuracyMeters!
    : DEFAULT_MAX_TRUSTED_ACCURACY_M;

  const base = { outOfBounds: false, distanceMeters: null, stalenessMs: null, confidenceMeters: 0 };

  // 1. A human decision outranks any sensor reading — that is what a rescue IS.
  if (finite(overrideUntilMs) && finite(nowMs) && overrideUntilMs > nowMs) {
    return { ...base, reason: 'override' };
  }

  // 2. No boundary configured ⇒ nothing to violate. Checked before the fix so a game
  //    without a safe zone never reports a location problem it does not have.
  const zoneOk = !!safeZone
    && finite(safeZone.radiusMeters) && safeZone.radiusMeters > 0
    && !!safeZone.center && finite(safeZone.center.lat) && finite(safeZone.center.lng);
  if (!zoneOk) return { ...base, reason: 'no_zone' };

  // 3/4. Nothing reported, or reported nonsense.
  if (!fix || typeof fix !== 'object') return { ...base, reason: 'no_fix' };
  if (fix.lat == null || fix.lng == null) return { ...base, reason: 'no_fix' };
  if (!finite(fix.lat) || !finite(fix.lng)) return { ...base, reason: 'invalid_fix' };

  // 5. Age. An unknown age, or an unusable server clock, is not evidence. A device
  //    clock AHEAD of the server is clamped rather than treated as stale — skew is
  //    not a violation, and clamping keeps the verdict monotone in `nowMs`.
  if (!finite(fix.atMs) || !finite(nowMs)) return { ...base, reason: 'stale_fix' };
  const stalenessMs = Math.max(0, nowMs - fix.atMs);
  if (stalenessMs > staleAfterMs) return { ...base, reason: 'stale_fix', stalenessMs };

  const distanceMeters = haversineKm({ lat: fix.lat, lng: fix.lng }, safeZone!.center) * 1000;
  const reported = finite(fix.accuracyMeters) && fix.accuracyMeters > 0 ? fix.accuracyMeters : 0;

  // 6. Confidence. A fix worse than the ceiling cannot locate a team relative to a
  //    150–500 m play area at all; and a miss smaller than the fix's own error radius
  //    is equally consistent with the team standing well inside the zone.
  if (reported > maxAccuracy) {
    return { ...base, reason: 'low_confidence', distanceMeters, stalenessMs, confidenceMeters: reported };
  }
  const common = { distanceMeters, stalenessMs, confidenceMeters: reported };
  if (distanceMeters > safeZone!.radiusMeters) {
    if (distanceMeters - reported > safeZone!.radiusMeters) {
      return { ...common, outOfBounds: true, reason: 'outside' };
    }
    return { ...common, outOfBounds: false, reason: 'low_confidence' };
  }
  return { ...common, outOfBounds: false, reason: 'inside' };
}
