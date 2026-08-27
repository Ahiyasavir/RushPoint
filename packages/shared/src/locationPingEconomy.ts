// What a participant location ping is allowed to cost (change: spark-tier-location-load).
//
// MEASURED PROBLEM: `updateLocation` cost 3 reads + 2 writes on EVERY ping, and play-web
// pings every 20s per controller device. 225 pings x 120 participants projected to 81,000
// reads and 54,000 writes against Spark ceilings of 50,000 and 20,000 — location alone was
// 1.6x over the read ceiling and 2.7x over the write ceiling before a single mission,
// photo or chat message was counted.
//
// ⚠️ THIS IS THE ONLY MODULE IN THE CHANGE THAT CAN LOSE A POSITION. Everything else counts
// or caches; this decides whether a real fix is discarded. It is therefore pure, total,
// clock-injected and FAILS OPEN — every uncertain input resolves to "write". The same shape
// as safeZone.ts and stuckGuards.ts, for the same reason: on a live run, spending a write
// you did not need is trivially recoverable, and dropping a player off the staff map is not.
//
// WHY A TIME INTERVAL IS THE PRIMARY LEVER, NOT A MOVEMENT THRESHOLD: a movement threshold
// only suppresses STATIONARY teams. A walking team covers ~28m per 20s ping and exceeds any
// sane threshold every single time, so it would still write 225 times and save nothing.
// Bounding the write RATE is what actually caps the cost. Position accuracy on the live map
// is then bounded by the jump threshold, and staleness by the interval — and note the pin is
// only stale in TIME, never in POSITION: any real movement writes immediately.
//
// The safe-zone evaluation deliberately does NOT consult this module. Suppression governs
// whether a document is written, never whether the boundary is checked — see the call site
// in functions/src/index.ts, where the safety block sits upstream of the verdict.

import { haversineKm } from './geo';

/** At most one pin write per team per minute (3 of every 4 pings suppressed at 20s). */
export const PIN_MIN_WRITE_INTERVAL_MS = 60_000;

/**
 * A move beyond this writes immediately, without waiting for the interval. Set well above
 * walking pace (~28m per ping) on purpose: if it were near walking distance, a moving team
 * would trip it every ping and the interval would stop bounding anything.
 */
export const PIN_JUMP_METERS = 75;

/**
 * Ceiling on how much slack a fix's own reported accuracy may buy it. MUST stay above
 * PIN_JUMP_METERS or the accuracy rule below is dead code — a threshold of
 * max(75, min(accuracy, ceiling)) can never exceed 75 if the ceiling is under 75.
 *
 * It exists so a garbage fix (accuracy: 5000) cannot suppress a genuinely large movement.
 */
export const PIN_ACCURACY_CEILING_METERS = 150;

/**
 * Distance a team must travel before another history point is kept for the movement
 * heatmap. The heatmap bins onto a ~55m grid (movementHeatmap.ts), so retaining a point
 * every 20s was far finer than its own consumer's resolution.
 */
export const TRACK_RETENTION_METERS = 100;

export interface GeoFix {
  lat: number;
  lng: number;
  /** Reported GPS error radius in metres, if the device supplied one. */
  accuracyMeters?: number | null;
}

/** The last fix actually written for a team. */
export interface StoredFix {
  lat: number;
  lng: number;
  atMs: number;
}

export type PinWriteReason =
  | 'no-last-fix'        // nothing to compare against (first ping, or after a restart)
  | 'unusable-input'     // malformed data — fail open
  | 'significant-move'   // moved beyond the jump threshold
  | 'interval-elapsed'   // the pin is due a refresh
  | 'suppressed';        // still fresh, and the team has not really moved

export interface PinWriteVerdict {
  write: boolean;
  reason: PinWriteReason;
  /** Metres from the last written fix, when both were usable. Diagnostic only. */
  movedMeters?: number;
}

function usableCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
  );
}

/** Metres between two usable points. */
function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineKm(a, b) * 1000;
}

/**
 * How far this fix must have moved to count as real movement rather than GPS noise.
 *
 * A motionless phone reporting 20m accuracy jitters by 10-30m, so a naive fixed threshold
 * near that scale would read jitter as movement and write on nearly every ping — which is
 * precisely the urban condition this platform runs in. The fix's own error radius is
 * therefore part of the threshold, bounded by the ceiling so a nonsense accuracy cannot
 * suppress everything. A missing or malformed accuracy contributes nothing and the fixed
 * threshold stands.
 */
function significanceThresholdMeters(accuracyMeters: unknown): number {
  const a =
    typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters) && accuracyMeters > 0
      ? Math.min(accuracyMeters, PIN_ACCURACY_CEILING_METERS)
      : 0;
  return Math.max(PIN_JUMP_METERS, a);
}

/**
 * Decide whether this ping must write the team's `teamLocations` pin.
 *
 * Total by construction: any missing, malformed, non-finite or out-of-range input yields
 * `write: true`. Never throws.
 */
export function shouldWritePin(opts: {
  fix: GeoFix;
  lastFix?: StoredFix | null;
  nowMs: number;
  minWriteIntervalMs?: number;
}): PinWriteVerdict {
  try {
    const fix = opts?.fix;
    const lastFix = opts?.lastFix;
    const nowMs = opts?.nowMs;
    const interval = typeof opts?.minWriteIntervalMs === 'number'
      && Number.isFinite(opts.minWriteIntervalMs)
      ? opts.minWriteIntervalMs
      : PIN_MIN_WRITE_INTERVAL_MS;

    // An incoming fix we cannot read is not a reason to suppress — hand it on and let the
    // caller's own validation reject it.
    if (!fix || !usableCoord(fix.lat, fix.lng)) {
      return { write: true, reason: 'unusable-input' };
    }
    if (!Number.isFinite(nowMs)) {
      return { write: true, reason: 'unusable-input' };
    }
    // Nothing to compare against. This is also the post-restart case: the in-process store
    // is empty, so every team writes once and then settles back into the interval.
    if (!lastFix || !usableCoord(lastFix.lat, lastFix.lng)) {
      return { write: true, reason: 'no-last-fix' };
    }
    if (typeof lastFix.atMs !== 'number' || !Number.isFinite(lastFix.atMs)) {
      return { write: true, reason: 'unusable-input' };
    }

    const movedMeters = metersBetween(fix, lastFix);
    if (!Number.isFinite(movedMeters)) {
      return { write: true, reason: 'unusable-input' };
    }

    // Real movement wins over the interval, so a fast-moving team stays responsive on the
    // staff map. Checked FIRST: it is the cheaper guarantee to reason about.
    if (movedMeters > significanceThresholdMeters(fix.accuracyMeters)) {
      return { write: true, reason: 'significant-move', movedMeters };
    }

    const elapsed = nowMs - lastFix.atMs;
    // A negative elapsed means the clock moved backwards (NTP correction, device drift).
    // "Cannot tell" must resolve to write, or a bad timestamp could latch suppression on
    // for as long as the skew lasts.
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      return { write: true, reason: 'unusable-input', movedMeters };
    }
    if (elapsed >= interval) {
      return { write: true, reason: 'interval-elapsed', movedMeters };
    }

    return { write: false, reason: 'suppressed', movedMeters };
  } catch {
    // Unreachable by design, but the contract is "never throws" — and this decides whether
    // a live participant stays visible.
    return { write: true, reason: 'unusable-input' };
  }
}

export interface TrackRetentionVerdict {
  retain: boolean;
  reason: 'no-reference' | 'unusable-input' | 'travelled' | 'too-close';
  movedMeters?: number;
}

/**
 * Decide whether this ping contributes a point to the movement history track.
 *
 * Distance-based rather than count-based on purpose. A movement heatmap built from
 * time-sampled points grows a hot cell wherever teams merely STOOD STILL — at a task, in a
 * queue — which is the opposite of what it is meant to show. Retaining by distance travelled
 * means a stationary team contributes nothing, and a walking team contributes evenly.
 *
 * Total by construction; never throws.
 */
export function shouldRetainTrackPoint(opts: {
  fix: GeoFix;
  lastRetained?: { lat: number; lng: number } | null;
  retentionMeters?: number;
}): TrackRetentionVerdict {
  try {
    const fix = opts?.fix;
    const lastRetained = opts?.lastRetained;
    const retention = typeof opts?.retentionMeters === 'number'
      && Number.isFinite(opts.retentionMeters) && opts.retentionMeters > 0
      ? opts.retentionMeters
      : TRACK_RETENTION_METERS;

    if (!fix || !usableCoord(fix.lat, fix.lng)) {
      return { retain: true, reason: 'unusable-input' };
    }
    if (!lastRetained || !usableCoord(lastRetained.lat, lastRetained.lng)) {
      return { retain: true, reason: 'no-reference' };
    }

    const movedMeters = metersBetween(fix, lastRetained);
    if (!Number.isFinite(movedMeters)) {
      return { retain: true, reason: 'unusable-input' };
    }
    return movedMeters > retention
      ? { retain: true, reason: 'travelled', movedMeters }
      : { retain: false, reason: 'too-close', movedMeters };
  } catch {
    return { retain: true, reason: 'unusable-input' };
  }
}
