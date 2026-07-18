// Covers the run-wide PIN-lockout counter added alongside the per-caller one
// (see functions/src/index.ts staffSignIn). A per-uid-only lockout is
// bypassable by minting a fresh anonymous identity per guess (trivial
// client-side, no server control) — the run-wide counter is what actually
// bounds total brute-force attempts against a single run's PIN, regardless of
// how many identities the attacker rotates through.
import { describe, it, expect } from 'vitest';
import {
  shouldLockout,
  isWithinCooldown,
  STAFF_LOCKOUT_LIMIT,
  STAFF_COOLDOWN_MS,
  STAFF_RUN_LOCKOUT_LIMIT,
  STAFF_RUN_COOLDOWN_MS,
} from '@rushpoint/shared';

describe('staff PIN lockout — run-wide counter', () => {
  it('is a materially higher threshold than the per-caller one (so it never trips a handful of legit staff typos)', () => {
    expect(STAFF_RUN_LOCKOUT_LIMIT).toBeGreaterThan(STAFF_LOCKOUT_LIMIT);
  });

  it('does NOT lock out after only a few failures across several different callers (existing scenario: 5 from one caller + a fresh caller succeeding)', () => {
    // Mirrors the e2e "locker fails 5x, then a different staff account succeeds"
    // scenario — the run-wide count after those 5 failures must stay well under
    // the run-wide limit so the legitimate different-account sign-in isn't blocked.
    const runFailuresSoFar = 5;
    expect(shouldLockout(runFailuresSoFar, STAFF_RUN_LOCKOUT_LIMIT)).toBe(false);
  });

  it('DOES lock out once enough failures accumulate run-wide, even spread across many different caller uids', () => {
    // Simulates an attacker rotating through fresh anonymous uids, a handful of
    // guesses per identity, until the run-wide total crosses the threshold.
    const runFailuresAfterRotatingIdentities = STAFF_RUN_LOCKOUT_LIMIT;
    expect(shouldLockout(runFailuresAfterRotatingIdentities, STAFF_RUN_LOCKOUT_LIMIT)).toBe(true);
  });

  it('run-wide cooldown forgives failures once the window has passed, same shape as the per-caller cooldown', () => {
    const now = Date.parse('2026-07-10T00:00:00.000Z');
    const justInside = now - STAFF_RUN_COOLDOWN_MS + 1;
    const justOutside = now - STAFF_RUN_COOLDOWN_MS - 1;
    expect(isWithinCooldown(justInside, now, STAFF_RUN_COOLDOWN_MS)).toBe(true);
    expect(isWithinCooldown(justOutside, now, STAFF_RUN_COOLDOWN_MS)).toBe(false);
  });

  it('per-caller and run-wide cooldown windows are independently configurable (both currently 10 min)', () => {
    expect(STAFF_COOLDOWN_MS).toBe(10 * 60 * 1000);
    expect(STAFF_RUN_COOLDOWN_MS).toBe(10 * 60 * 1000);
  });
});
