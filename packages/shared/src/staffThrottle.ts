// Staff-PIN brute-force throttle predicates (change: auth-anticheat-hardening,
// row 40). A staff PIN is only 6 digits, so staffSignIn must lock a caller out
// after a few failures within a cooldown window. Pure + time-injected so the
// boundaries are unit-tested without a clock or emulator.

/** Max failed PIN attempts (per run, per caller) before lockout. */
export const STAFF_LOCKOUT_LIMIT = 5;

/** How long a lockout lasts; also the window failures are counted within. */
export const STAFF_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/** True once the recorded failed-attempt count has reached the limit. */
export function shouldLockout(attempts: number, limit: number = STAFF_LOCKOUT_LIMIT): boolean {
  return attempts >= limit;
}

/** True while `now` is still inside the cooldown window after the last failure. */
export function isWithinCooldown(
  lastFailedAtMs: number,
  nowMs: number,
  cooldownMs: number = STAFF_COOLDOWN_MS,
): boolean {
  return nowMs - lastFailedAtMs < cooldownMs;
}
