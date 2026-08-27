// Should this device spend a callable on this location fix?
// (change: participant-read-budget)
//
// MEASURED PROBLEM. `updateLocation` costs 1.00 Firestore read per call in production, and
// the participant app takes a fix every 20s. Over a 75-minute run that is 225 calls and 225
// reads per team — 22,500 at 100 teams — to perform, after spark-tier-location-load, roughly
// 75 pin writes. Most of those calls exist only to be suppressed server-side. The cheapest
// read is the one never requested.
//
// THE SERVER REMAINS THE AUTHORITY. This gate can only cause a fix to be withheld; it can
// never cause one to be accepted. A client that ignores it entirely is still correct, just
// more expensive. That asymmetry is deliberate — see design D2 of the change.
//
// ⚠️ SAFETY, READ THIS BEFORE CHANGING THE FLOOR. The server evaluates the safe zone ONLY
// when a ping arrives. So the maximum-silence floor below is not a tuning knob: it is the
// bound on how late a team standing still OUTSIDE the boundary can be noticed. It equals the
// server's current write interval today — so this change widens that window by nothing — but
// it is its OWN constant, deliberately, so that raising the server's interval later cannot
// drag the safety bound along with it. Never raise it to save reads.
import { shouldWritePin, type StoredFix } from '@rushpoint/shared';

/**
 * The longest this device may go without reporting a fix, whatever the verdict.
 *
 * DELIBERATELY ITS OWN LITERAL, not an alias of `PIN_MIN_WRITE_INTERVAL_MS`. The two happen
 * to be equal today, which is why this change does not widen the safety window at all: a
 * stationary team's pin was already written only once per 60s. But they mean different
 * things, and tying them together would make this constant unable to do the one job it has.
 * If someone later raises the server's write interval to save writes — an entirely
 * reasonable thing to want — an aliased floor would follow it upward and silently extend how
 * long a team can stand outside the safe zone unnoticed. Kept separate, the floor holds at
 * 60s and the client keeps reporting on time.
 *
 * Never raise this to save reads. It bounds a safety verdict, not a refresh rate.
 */
export const PING_MAX_SILENCE_MS = 60_000;

export interface PingFix {
  lat: number;
  lng: number;
  /** The fix's own reported error radius in metres, when the device supplied one. */
  accuracyMeters?: number | null;
}

/** The last fix this DEVICE sent — not the last fix the server wrote. See design D2. */
export type SentFix = StoredFix | null | undefined;

export type PingSendReason =
  /** The shared verdict says a write would happen (moved, interval elapsed, or no history). */
  | 'server-would-write'
  /** Nothing would be written, but the silence floor elapsed — safety, not freshness. */
  | 'safety-floor'
  /** Suppressed: the server would discard this fix and the floor has not elapsed. */
  | 'suppressed';

export interface PingSendVerdict {
  send: boolean;
  reason: PingSendReason;
}

/**
 * Decide whether to invoke `updateLocation` for this fix.
 *
 * Total and clock-injected: every uncertain input — a missing previous fix, a non-finite
 * coordinate, an unusable clock, a malformed argument object — resolves to SEND. Withholding
 * a fix is the only harmful direction this function has, so it never takes it on a guess.
 */
export function shouldSendPing(opts: {
  fix: PingFix;
  lastSent: SentFix;
  nowMs: number;
  /**
   * The server's minimum write interval, when it is not the compiled-in default. Exposed so
   * the floor's independence from it is provable: raise this above PING_MAX_SILENCE_MS and
   * the floor must still force a send. Production passes nothing.
   */
  minWriteIntervalMs?: number;
}): PingSendVerdict {
  try {
    const lastSent = opts?.lastSent;
    const nowMs = opts?.nowMs;

    // Delegate significance to the SAME function the server applies, so the two can never
    // disagree about what counts as movement. It is already total and fails open.
    const verdict = shouldWritePin({
      fix: { lat: opts?.fix?.lat as number, lng: opts?.fix?.lng as number, accuracyMeters: opts?.fix?.accuracyMeters },
      lastFix: lastSent ?? null,
      nowMs: nowMs as number,
      ...(typeof opts?.minWriteIntervalMs === 'number' ? { minWriteIntervalMs: opts.minWriteIntervalMs } : {}),
    });
    if (verdict.write) return { send: true, reason: 'server-would-write' };

    // The server would discard this fix. Send it anyway once the floor has elapsed, because
    // the safe-zone verdict rides on the ping and nothing else triggers it.
    const lastAt = lastSent?.atMs;
    if (!Number.isFinite(lastAt) || !Number.isFinite(nowMs)) {
      return { send: true, reason: 'safety-floor' };
    }
    if ((nowMs as number) - (lastAt as number) >= PING_MAX_SILENCE_MS) {
      return { send: true, reason: 'safety-floor' };
    }
    return { send: false, reason: 'suppressed' };
  } catch {
    // Instrumentation and optimisation must never cost a player their position.
    return { send: true, reason: 'safety-floor' };
  }
}
