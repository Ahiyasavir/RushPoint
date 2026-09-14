// Is this fix good enough to prove arrival? (change: arrival-needs-a-usable-fix)
//
// THE ASYMMETRY THIS CLOSES. `./safeZone.ts` already learned that a position without
// its error radius is not evidence — its header records that the old version decided
// a breach "on that answer alone: no accuracy, no age" — and it now refuses to call a
// team out of bounds unless a fresh fix clears the boundary by MORE than its own
// accuracy.
//
// The arrival gate never learned it. `evaluateTrigger` in ./geo.ts compares a bare
// distance to a bare radius; the callables never accepted an accuracy; the participant
// app never sent one, although the browser hands it over on every fix as
// `GeolocationCoordinates.accuracy`. So a phone with a poor fix — indoors, an urban
// canyon, a cold start, which is exactly a field game — reports a point that can land
// inside a 40m radius while the player is hundreds of metres away, and the check-in is
// accepted. The organizer of run ijI9JMITSf8C9heN1Cwp reported precisely that: the
// button advanced teams "without precise verification of their physical location".
//
// THE DIRECTION IS THE OPPOSITE OF THE SAFE-ZONE ONE, AND THAT IS THE POINT.
// For a safety boundary an imprecise fix must not ACCUSE.
// For an arrival gate an imprecise fix must not PROVE.
// Same missing input, opposite fail-safe.
//
// ─── THE CORRECTION, AND WHY IT IS THE WHOLE DESIGN ──────────────────────────
//
// The first version of this module was `accuracy > radius ⇒ refuse`, full stop. It
// had no ceiling and no exit, and it HALTED THE GAME in two ordinary field
// situations — both of which Ahiya named on sight, before a line of it ever ran:
//
//   • A mission authored with a 4m radius. A consumer handset essentially never
//     reports 4m accuracy, so the refusal is unconditional and permanent. The
//     mission is unwinnable by construction.
//   • Anywhere the sky is poor: an alley, a courtyard, a stairwell, under trees.
//     The team is standing in exactly the right place and the button never works.
//
// A player who cannot advance is a worse outcome than a player who advanced on a
// weak fix, because the first ends their game and the second costs some points.
// CLAUDE.md states the underlying rule twice already — "every client-side blocking
// flag must fail OPEN", and "a disabled primary button explains nothing". A gate
// with no exit is the same defect wearing a server costume.
//
// So the rule now has two bounds, and neither is optional:
//
// 1. A RADIUS FLOOR. An authored radius below what a phone can resolve is not a
//    stricter mission, it is a broken one. The radius actually enforced is
//    `max(authored, ARRIVAL_RADIUS_FLOOR_M)`. This only ever WIDENS the gate.
//
// 2. A GRACE WINDOW. The first press on a useless fix is refused with "hold still" —
//    which is genuinely useful, because a cold fix usually sharpens within seconds.
//    Once COARSE_FIX_GRACE_MS has passed since that first refusal, the arrival is
//    ACCEPTED and recorded as `unverified`. The game always continues.
//
// WHAT THE WINDOW DOES NOT FORGIVE. It excuses an IMPRECISE fix, never a DISTANT
// one. A player at home is `tooFar` however long they wait — the distance check runs
// after the window opens, not instead of it. The window buys the phone time to
// answer; it never answers for the phone.
//
// AND THE PLAYER IS NEVER TOLD THEY WERE FLAGGED. `unverified` is for the
// organizer's console. Surfacing it to the participant would turn "wait 10 seconds"
// into a documented way through the gate, which is precisely the behaviour the flag
// exists to detect.
//
// AND IT MUST NEVER STRAND ANYONE. A refusal for a bad fix is RETRIABLE and is NOT
// charged as a wrong attempt — the player did nothing wrong, and a cooldown would
// strand them standing at the correct spot. An ABSENT accuracy reproduces the
// pre-change behaviour exactly, so an installed app that has not updated is never
// punished for not knowing about this.
//
// Dependency-free — scripts/test-arrival-fix-quality.ts.

/** What the evidence supports. */
export const ARRIVAL_VERDICT = {
  /** The fix places the player inside the radius. */
  arrived: 'arrived',
  /**
   * The fix could not prove it, the grace window has passed, and the player is let
   * through anyway. Recorded for the organizer; invisible to the player.
   */
  arrivedUnverified: 'arrivedUnverified',
  /** A usable fix places the player outside the radius. Moving is what fixes it. */
  tooFar: 'tooFar',
  /** The fix's own error exceeds the radius, and the grace window has not passed. */
  fixTooCoarse: 'fixTooCoarse',
} as const;

export type ArrivalOutcome = (typeof ARRIVAL_VERDICT)[keyof typeof ARRIVAL_VERDICT];

export interface ArrivalFixInput {
  /** Metres between the reported position and the target. */
  distanceM: number;
  /** The mission's radius. A missing or nonsensical value falls back. */
  radiusM?: number | null;
  /** `GeolocationCoordinates.accuracy`. Absent ⇒ decide exactly as before. */
  accuracyMeters?: number | null;
  /**
   * Epoch ms of the FIRST coarse refusal for this team on this task, as the caller
   * stamped it. Null/absent ⇒ the clock has not started and this press starts it.
   */
  coarseSinceMs?: number | null;
  /** Epoch ms now. Absent or unusable ⇒ the window cannot be judged, so it is shut. */
  nowMs?: number | null;
}

export interface ArrivalVerdict {
  outcome: ArrivalOutcome;
  /** Would waiting for a better fix, without moving, change the answer? */
  retriable: boolean;
  /** Should this be charged against the team as a failed attempt? */
  countsAsAttempt: boolean;
  /** Was the player let through without the fix proving it? Never shown to them. */
  unverified: boolean;
  /**
   * Should the caller stamp the coarse clock now? True only on the FIRST refusal, so
   * that pressing repeatedly cannot push the window away from the player.
   */
  startCoarseClock: boolean;
  /** The radius actually enforced, after the floor. Callers must not re-derive it. */
  effectiveRadiusM: number;
  /** Echoed back so a message can name them. Null when unusable. */
  distanceM: number | null;
  accuracyMeters: number | null;
}

/**
 * Fallback when a mission carries no usable radius. Mirrors the reasoning in
 * `evaluateTrigger`: a zero or negative radius is legacy or hand-written data, and
 * honouring it literally would strand a player standing on the exact spot.
 */
const FALLBACK_RADIUS_M = 40;

/**
 * The smallest radius this gate will enforce, whatever a mission authored.
 *
 * A good handset fix in the open is 5–10m; a typical one is 20–50m; near buildings or
 * under cover it is worse. A mission authored at 4m is therefore not asking for
 * precision, it is asking for something the hardware cannot supply — so honouring it
 * literally produces a mission nobody can ever complete.
 *
 * 25m is deliberately modest: large enough that an ordinary outdoor fix clears it,
 * small enough that it still means "at this spot" rather than "on this street". It
 * only ever RAISES a radius, so no mission becomes harder than it was authored.
 */
export const ARRIVAL_RADIUS_FLOOR_M = 25;

/**
 * How long a team may be held at "hold still" before the gate opens regardless.
 *
 * Ten seconds, chosen by the product owner and correct for the reason he gave: it is
 * long enough for a cold fix to sharpen — which is the entire benefit the refusal
 * buys — and short enough that a team standing in the right place experiences a
 * pause rather than a wall. Anything longer converts a GPS problem into a game-design
 * problem, which is the defect this whole module is a correction to.
 */
export const COARSE_FIX_GRACE_MS = 10_000;

/** A finite positive number, or null. */
function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** A finite non-negative number, or null. */
function distance(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Has the team been held at "hold still" for long enough that the gate must open?
 *
 * Fails SHUT on every unusable input — a missing clock, a NaN, a stamp in the future.
 * A window that cannot be measured has not elapsed, and inventing elapsed time would
 * open the gate on the strength of corrupt data rather than on a decision.
 */
function graceElapsed(coarseSinceMs: unknown, nowMs: unknown): boolean {
  const since = positive(coarseSinceMs);
  const now = positive(nowMs);
  if (since === null || now === null) return false;
  return now - since >= COARSE_FIX_GRACE_MS;
}

/**
 * What this fix can and cannot prove about arrival.
 *
 * Order matters and is load-bearing:
 *
 * 1. The radius is floored first, because every later comparison is against it.
 * 2. The coarse check runs BEFORE the distance check. Telling a player "you are 500m
 *    away" on the strength of a fix with 800m of error asserts something the evidence
 *    does not support, and it is not advice they can act on — whereas "hold still, we
 *    cannot see you well enough yet" is.
 * 3. But once the grace window has passed, the coarse check STOPS SHORT-CIRCUITING
 *    and the distance check runs. That is what keeps the window from forgiving a
 *    player who is genuinely somewhere else.
 *
 * The boundary belongs to the player: an accuracy EQUAL to the effective radius is
 * still usable, so the common "40m radius, 40m fix" case keeps working. Only a
 * strictly worse fix is ever questioned.
 */
export function evaluateArrivalFix(input: ArrivalFixInput): ArrivalVerdict {
  const safe = (input && typeof input === 'object' && !Array.isArray(input))
    ? input
    : ({} as ArrivalFixInput);

  const dist = distance(safe.distanceM);
  const authored = positive(safe.radiusM) ?? FALLBACK_RADIUS_M;
  // The floor only ever widens. A mission authored more generously keeps its radius.
  const radius = Math.max(authored, ARRIVAL_RADIUS_FLOOR_M);
  const accuracy = positive(safe.accuracyMeters);
  const base = { effectiveRadiusM: radius, distanceM: dist, accuracyMeters: accuracy };

  // A fix that cannot resolve the target at all proves nothing — in either direction.
  const tooCoarse = accuracy !== null && accuracy > radius;
  if (tooCoarse && !graceElapsed(safe.coarseSinceMs, safe.nowMs)) {
    return {
      ...base,
      outcome: ARRIVAL_VERDICT.fixTooCoarse,
      retriable: true,
      // Never charged: the player did nothing wrong, and a cooldown would strand
      // them standing in exactly the right place.
      countsAsAttempt: false,
      unverified: false,
      // Only the FIRST refusal starts the clock. Re-stamping on every press would
      // push the window away each time the player tried, so it would never arrive.
      startCoarseClock: positive(safe.coarseSinceMs) === null,
    };
  }

  // An unusable distance is treated as "not here": without a position there is
  // nothing to prove arrival with, and the callable's own guard already refuses a
  // check-in that carries no coordinates at all.
  //
  // Reached by a coarse fix too, once the window is open — which is the point. The
  // window excuses an imprecise fix, never a distant one.
  if (dist === null || dist > radius) {
    return {
      ...base,
      outcome: ARRIVAL_VERDICT.tooFar,
      retriable: false,
      countsAsAttempt: true,
      unverified: false,
      startCoarseClock: false,
    };
  }

  // Inside the radius. Whether that is PROVEN or merely permitted is the one thing
  // the organizer needs to be able to tell apart afterwards.
  return {
    ...base,
    outcome: tooCoarse ? ARRIVAL_VERDICT.arrivedUnverified : ARRIVAL_VERDICT.arrived,
    retriable: false,
    countsAsAttempt: false,
    unverified: tooCoarse,
    startCoarseClock: false,
  };
}
