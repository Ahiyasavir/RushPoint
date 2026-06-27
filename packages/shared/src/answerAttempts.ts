// Per-task answer attempt limit (change: auth-anticheat-hardening, row 42).
// A quiz/numeric task may cap how many wrong answers a team can make before it is
// locked. Pure predicate so the boundary is unit-tested without the emulator.
// A limit of undefined or <= 0 means "unlimited".
export function attemptLimitReached(attempts: number, limit?: number): boolean {
  return typeof limit === 'number' && limit > 0 && attempts >= limit;
}
