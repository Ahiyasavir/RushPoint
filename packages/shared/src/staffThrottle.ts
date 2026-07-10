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

// ─── Run-scoped (cross-caller) lockout ─────────────────────────────────────
// The per-caller lockout above is bypassable by an attacker who simply mints a
// fresh anonymous Firebase Auth identity for every few guesses (trivial from
// play-web's client SDK — no server-side control over anonymous sign-in). A
// 6-digit PIN has only 900,000 possibilities, so without a SECOND counter keyed
// on the run itself (not the caller), per-uid lockout provides no real
// brute-force protection at all. This limit is deliberately higher than
// STAFF_LOCKOUT_LIMIT so a handful of legitimate staff mistyping a PIN in quick
// succession (a normal, testable scenario) never trips it — only sustained,
// bulk guessing across many identities does.
export const STAFF_RUN_LOCKOUT_LIMIT = 20;

/** How long a run-wide lockout lasts; also the window failures are counted within. */
export const STAFF_RUN_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
