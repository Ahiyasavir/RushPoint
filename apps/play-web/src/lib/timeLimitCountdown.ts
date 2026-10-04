// The per team mission countdown on the phone (change: mission-time-limit). The server sends
// `activeTaskTimeLeftMs`, a DURATION measured on its own clock; the phone counts it down from the
// moment it received it. Never an instant compared with the phone's clock (a slow clock would
// freeze it). scripts/test-time-limit-countdown.ts.

/** Time left now. A clock that jumps backwards never adds time. */
export function countdownLeftMs(leftMs: number | null | undefined, receivedAtMs: number, nowMs: number): number | null {
  if (typeof leftMs !== 'number' || !Number.isFinite(leftMs)) return null;
  return Math.max(0, leftMs - Math.max(0, nowMs - receivedAtMs));
}

/** m:ss, rounded UP so the display only reads 0:00 when the time is really gone. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function countdownUrgent(ms: number): boolean {
  return ms <= 60_000;
}

// ── The fuse (change: mission-countdown-fuse) ────────────────────────────────────────────────────────
// The countdown is drawn as a burning fuse that changes phase as time runs out, and marks the moments
// that matter (half time, the final stretch, the last seconds, time up) ONCE each. Pure and total, so
// the component only renders. scripts/test-time-limit-countdown.ts.

export type CountdownPhase = 'calm' | 'hurry' | 'critical' | 'final' | 'up';
const PHASE_DEPTH: Record<CountdownPhase, number> = { calm: 0, hurry: 1, critical: 2, final: 3, up: 4 };

const validTotal = (total: number | null | undefined): total is number =>
  typeof total === 'number' && Number.isFinite(total) && total > 0;

/**
 * Where each phase starts, as time LEFT: hurry at half time, critical at the last minute, final at
 * the last 10 seconds. A short mission scales critical and final down to a quarter of its length,
 * so a 1 minute sprint does not start red. Unknown total: 2 min / 60 s / 10 s.
 */
export function countdownThresholds(total: number | null | undefined): { hurry: number; critical: number; final: number } {
  if (!validTotal(total)) return { hurry: 120_000, critical: 60_000, final: 10_000 };
  return { hurry: total / 2, critical: Math.min(60_000, total / 4), final: Math.min(10_000, total / 4) };
}

export function countdownPhase(left: number, total: number | null | undefined): CountdownPhase {
  if (typeof left !== 'number' || Number.isNaN(left)) return 'calm';
  if (left <= 0) return 'up';
  const th = countdownThresholds(total);
  if (left <= th.final) return 'final';
  if (left <= th.critical) return 'critical';
  if (left <= th.hurry) return 'hurry';
  return 'calm';
}

/** Share of the time still LEFT, 0..1 (the fuse's length). Null when the total is unknown. */
export function countdownFraction(left: number, total: number | null | undefined): number | null {
  if (!validTotal(total) || typeof left !== 'number' || Number.isNaN(left)) return null;
  return Math.min(1, Math.max(0, left / total));
}

/**
 * The phase ENTERED going from `prevLeft` to `left`, or null. Only a move DOWN counts, so a re-anchor
 * that adds time back (a resumed hold, a fresh poll) never marks a moment twice; with no previous
 * value (first paint) nothing fires; a jump across several lines reports the deepest one.
 */
export function countdownMilestone(prevLeft: number | null | undefined, left: number, total: number | null | undefined): CountdownPhase | null {
  if (typeof prevLeft !== 'number' || Number.isNaN(prevLeft) || typeof left !== 'number' || Number.isNaN(left)) return null;
  if (left >= prevLeft) return null;
  const before = countdownPhase(prevLeft, total);
  const now = countdownPhase(left, total);
  return PHASE_DEPTH[now] > PHASE_DEPTH[before] ? now : null;
}
