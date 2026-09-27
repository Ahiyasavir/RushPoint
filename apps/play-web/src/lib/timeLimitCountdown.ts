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
