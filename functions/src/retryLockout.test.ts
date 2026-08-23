// Retry lockout, clock-skew hardened (change: retry-lockout-clock-skew).
//
// The wrong-answer retry lockout used to travel to the participant as an ABSOLUTE
// epoch instant that the phone re-interpreted against ITS OWN clock. The server
// gate was (and stays) authoritative, so that was never a cheat — it was a
// STUCK-PLAYER bug: a phone whose clock is hours behind froze its own answer
// controls for hours in a game the server would happily let it play.
//
// These tests pin the pure decision function that replaces it:
//   evaluateRetryLockout(serverNow, storedRecord, policy) -> { locked, remainingMs, ... }
// It must be TOTAL (every malformed input has an explicit verdict), FAIL OPEN (an
// undecidable state never locks a team out of their own game) and BOUNDED (no
// stored value can imply a wait longer than the level that created it allows).
import { describe, test, expect } from 'vitest';
import {
  evaluateRetryLockout,
  retryLockoutPolicyFor,
  wrongAnswerCost,
  cooldownRemainingSeconds,
  WRONG_ANSWER_LEVELS,
} from '@rushpoint/shared';
import type { RetryLockoutRecord, WrongAnswerLevel } from '@rushpoint/shared';

const STANDARD = retryLockoutPolicyFor('standard');
const NOW = 1_800_000_000_000; // a fixed, readable server instant

/** A record in the NEW (duration) shape. */
function durationRec(lastFailureAt: number, lockoutSeconds: number, failureCount = 1): RetryLockoutRecord {
  return { charged: 0, lastHash: 'h', cooldownUntil: lastFailureAt + lockoutSeconds * 1000, lastFailureAt, lockoutMs: lockoutSeconds * 1000, failureCount };
}

/** A record exactly as `wrong-answer-cost` wrote it BEFORE this change. */
function legacyRec(cooldownUntil: number): RetryLockoutRecord {
  return { charged: 10, lastHash: 'h', cooldownUntil } as RetryLockoutRecord;
}

// ── 1. No failures ───────────────────────────────────────────────────────────
describe('evaluateRetryLockout — a team with no failures is never locked', () => {
  test('undefined / null record', () => {
    for (const rec of [undefined, null]) {
      const v = evaluateRetryLockout(NOW, rec, STANDARD);
      expect(v).toMatchObject({ locked: false, remainingMs: 0, remainingSeconds: 0, source: 'none' });
    }
  });

  test('empty record and a ledger row with no lockout at all', () => {
    for (const rec of [{}, { charged: 0, lastHash: '' }, { cooldownUntil: 0 }]) {
      const v = evaluateRetryLockout(NOW, rec as RetryLockoutRecord, STANDARD);
      expect(v.locked).toBe(false);
      expect(v.remainingMs).toBe(0);
      expect(v.source).toBe('none');
    }
  });
});

// ── 2. The free first attempt starts no lockout ──────────────────────────────
describe('evaluateRetryLockout — the free allowance starts no lockout', () => {
  test('the 1st wrong answer at standard earns a 0 s lockout, so nothing is locked', () => {
    const cost = wrongAnswerCost('standard', 'fixed_points_speed', 1, 0);
    expect(cost.cooldownSeconds).toBe(0);
    const v = evaluateRetryLockout(NOW, durationRec(NOW, cost.cooldownSeconds, 0), STANDARD);
    expect(v.locked).toBe(false);
    expect(v.remainingMs).toBe(0);
  });
});

// ── 3. Escalating failures track the curve and saturate at the ceiling ───────
describe('evaluateRetryLockout — escalating failures', () => {
  const expectations: Record<Exclude<WrongAnswerLevel, 'off'>, number[]> = {
    // attempts 1..8, seconds of lockout expected (0 = still free)
    gentle: [0, 0, 10, 20, 30, 30, 30, 30],
    standard: [0, 15, 30, 45, 60, 75, 90, 90],
    strict: [30, 60, 90, 120, 150, 180, 180, 180],
  };

  for (const [level, seconds] of Object.entries(expectations) as [Exclude<WrongAnswerLevel, 'off'>, number[]][]) {
    test(`${level}: the verdict mirrors wrongAnswerCost and never exceeds the ceiling`, () => {
      const policy = retryLockoutPolicyFor(level);
      let charged = 0;
      seconds.forEach((expectedSeconds, i) => {
        const cost = wrongAnswerCost(level, 'fixed_points_speed', i + 1, charged);
        charged += cost.points;
        expect(cost.cooldownSeconds).toBe(expectedSeconds);
        const v = evaluateRetryLockout(NOW, durationRec(NOW, cost.cooldownSeconds, cost.chargedIndex), policy);
        expect(v.remainingMs).toBe(expectedSeconds * 1000);
        expect(v.locked).toBe(expectedSeconds > 0);
        expect(v.remainingMs).toBeLessThanOrEqual(WRONG_ANSWER_LEVELS[level].maxCooldownSeconds * 1000);
      });
    });
  }
});

// ── 4. The boundary, to the millisecond ──────────────────────────────────────
describe('evaluateRetryLockout — the expiry boundary is exact', () => {
  const end = NOW + 15_000;
  const forms: [string, RetryLockoutRecord][] = [
    ['duration form', durationRec(NOW, 15)],
    ['legacy form', legacyRec(end)],
  ];

  for (const [label, rec] of forms) {
    test(`${label}: end-1 ms is locked, end is UNLOCKED, end+1 ms is unlocked`, () => {
      const before = evaluateRetryLockout(end - 1, rec, STANDARD);
      expect(before.locked).toBe(true);
      expect(before.remainingMs).toBe(1);
      expect(before.remainingSeconds).toBe(1); // rounded UP: never show 0 while locked

      const at = evaluateRetryLockout(end, rec, STANDARD);
      expect(at.locked).toBe(false);
      expect(at.remainingMs).toBe(0);

      const after = evaluateRetryLockout(end + 1, rec, STANDARD);
      expect(after.locked).toBe(false);
      expect(after.remainingMs).toBe(0);
    });
  }
});

// ── 5. An expired lockout never goes negative ────────────────────────────────
describe('evaluateRetryLockout — expiry', () => {
  test('a long-expired lockout reports exactly 0, never a negative remainder', () => {
    const v = evaluateRetryLockout(NOW + 86_400_000, durationRec(NOW, 90), STANDARD);
    expect(v.locked).toBe(false);
    expect(v.remainingMs).toBe(0);
    expect(v.remainingSeconds).toBe(0);
    expect(Object.is(v.remainingMs, -0)).toBe(false);
  });
});

// ── 6 & 7. Client clock skew ─────────────────────────────────────────────────
// The verdict is a function of the SERVER clock alone. These two tests also pin
// the OLD behaviour that motivated the change, so a regression to shipping an
// absolute instant is immediately visible.
describe('evaluateRetryLockout — client clock skew is irrelevant', () => {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const rec = durationRec(NOW, 90);
  const serverNow = NOW + 30_000; // 30 s in: 60 s should remain

  test('the remaining duration depends only on the server clock', () => {
    const truth = evaluateRetryLockout(serverNow, rec, STANDARD);
    expect(truth.remainingMs).toBe(60_000);
    // Whatever the phone's clock says, the duration it is handed is the same.
    for (const skew of [0, SIX_HOURS, -SIX_HOURS, 3, -86_400_000]) {
      const clientDeadline = (serverNow + skew) + truth.remainingMs; // client-local deadline
      const clientNow = serverNow + skew;                            // same client clock
      expect(cooldownRemainingSeconds(clientDeadline, clientNow)).toBe(60);
    }
  });

  test('OLD behaviour, pinned: a clock 6 h AHEAD unlocked the controls early', () => {
    // The bug: an absolute server instant compared against a skewed client clock.
    expect(cooldownRemainingSeconds(rec.cooldownUntil, serverNow + SIX_HOURS)).toBe(0);
    // The fix: the server's own verdict still says 60 s.
    expect(evaluateRetryLockout(serverNow, rec, STANDARD).remainingSeconds).toBe(60);
  });

  test('OLD behaviour, pinned: a clock 6 h BEHIND froze the player out for six hours', () => {
    const naive = cooldownRemainingSeconds(rec.cooldownUntil, serverNow - SIX_HOURS);
    expect(naive).toBeGreaterThan(21_000); // ~6 h of dead answer controls
    expect(evaluateRetryLockout(serverNow, rec, STANDARD).remainingSeconds).toBe(60);
  });
});

// ── 8. MIGRATION: records written before this change ─────────────────────────
describe('evaluateRetryLockout — backward compatibility with stored lockouts', () => {
  test('a legacy record is still locked before its expiry (not permanently unlocked)', () => {
    const v = evaluateRetryLockout(NOW + 5_000, legacyRec(NOW + 15_000), STANDARD);
    expect(v.locked).toBe(true);
    expect(v.remainingMs).toBe(10_000);
    expect(v.source).toBe('legacy');
  });

  test('a legacy record still expires (not permanently locked)', () => {
    const v = evaluateRetryLockout(NOW + 15_000, legacyRec(NOW + 15_000), STANDARD);
    expect(v.locked).toBe(false);
    expect(v.source).toBe('legacy');
  });

  test('a legacy expiry 30 days out is clamped to the level ceiling and self-heals', () => {
    const v = evaluateRetryLockout(NOW, legacyRec(NOW + 30 * 86_400_000), STANDARD);
    expect(v.clamped).toBe(true);
    expect(v.remainingMs).toBe(WRONG_ANSWER_LEVELS.standard.maxCooldownSeconds * 1000);
    // …and it really does expire: one ceiling later the team can answer again.
    const later = evaluateRetryLockout(NOW + 90_000 + 1, legacyRec(NOW + 30 * 86_400_000), STANDARD);
    expect(later.remainingMs).toBeLessThanOrEqual(90_000);
  });
});

// ── 9. Malformed stored state ────────────────────────────────────────────────
describe('evaluateRetryLockout — malformed stored state fails OPEN', () => {
  const JUNK = [-1, NaN, Infinity, -Infinity, null, undefined, '123' as unknown as number, {} as unknown as number];

  test('a junk cooldownUntil never locks and never NaNs', () => {
    for (const bad of JUNK) {
      const v = evaluateRetryLockout(NOW, { charged: 0, lastHash: '', cooldownUntil: bad } as RetryLockoutRecord, STANDARD);
      expect(Number.isFinite(v.remainingMs)).toBe(true);
      expect(v.remainingMs).toBe(0);
      expect(v.locked).toBe(false);
    }
  });

  test('a junk lastFailureAt / lockoutMs never locks unboundedly', () => {
    for (const bad of JUNK) {
      for (const rec of [
        { lastFailureAt: bad, lockoutMs: 15_000 },
        { lastFailureAt: NOW, lockoutMs: bad },
      ] as RetryLockoutRecord[]) {
        const v = evaluateRetryLockout(NOW, rec, STANDARD);
        expect(Number.isFinite(v.remainingMs)).toBe(true);
        expect(v.remainingMs).toBeGreaterThanOrEqual(0);
        expect(v.remainingMs).toBeLessThanOrEqual(STANDARD.maxCooldownSeconds * 1000);
      }
    }
  });

  test('a negative lockoutMs is not a lockout', () => {
    const v = evaluateRetryLockout(NOW, { lastFailureAt: NOW, lockoutMs: -60_000 } as RetryLockoutRecord, STANDARD);
    expect(v.locked).toBe(false);
  });

  test('a lastFailureAt in the far future is clamped, not honoured', () => {
    const v = evaluateRetryLockout(NOW, { lastFailureAt: NOW + 30 * 86_400_000, lockoutMs: 15_000 } as RetryLockoutRecord, STANDARD);
    expect(v.remainingMs).toBeLessThanOrEqual(STANDARD.maxCooldownSeconds * 1000);
  });

  test('a junk server `now` is not allowed to lock a team out', () => {
    for (const badNow of [NaN, Infinity, -Infinity, undefined as unknown as number]) {
      const v = evaluateRetryLockout(badNow, durationRec(NOW, 90), STANDARD);
      expect(Number.isFinite(v.remainingMs)).toBe(true);
      expect(v.remainingMs).toBeLessThanOrEqual(STANDARD.maxCooldownSeconds * 1000);
    }
  });
});

// ── 10. Seeded invariant sweep ───────────────────────────────────────────────
describe('evaluateRetryLockout — invariants over random inputs', () => {
  function makeRng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  test('remainingMs is always finite, >= 0 and <= the policy ceiling', () => {
    const rng = makeRng(9137);
    const levels: WrongAnswerLevel[] = ['off', 'gentle', 'standard', 'strict'];
    const junk = [NaN, Infinity, -Infinity, -5, 0];
    for (let i = 0; i < 3000; i++) {
      const level = levels[Math.floor(rng() * levels.length)];
      const policy = retryLockoutPolicyFor(level);
      const now = rng() < 0.1 ? junk[i % junk.length] : NOW + Math.floor((rng() - 0.5) * 1e9);
      const rec: RetryLockoutRecord = {
        cooldownUntil: rng() < 0.15 ? junk[i % junk.length] : NOW + Math.floor((rng() - 0.5) * 1e9),
        lastFailureAt: rng() < 0.5 ? (rng() < 0.15 ? junk[i % junk.length] : NOW + Math.floor((rng() - 0.5) * 1e9)) : undefined,
        lockoutMs: rng() < 0.5 ? (rng() < 0.15 ? junk[i % junk.length] : Math.floor(rng() * 400_000)) : undefined,
      };
      const v = evaluateRetryLockout(now, rec, policy);
      expect(Number.isFinite(v.remainingMs)).toBe(true);
      expect(v.remainingMs).toBeGreaterThanOrEqual(0);
      expect(v.remainingMs).toBeLessThanOrEqual(policy.maxCooldownSeconds * 1000);
      expect(v.locked).toBe(v.remainingMs > 0);
      expect(v.remainingSeconds).toBe(Math.ceil(v.remainingMs / 1000));
    }
  });

  test('level off can never lock anyone (every pre-existing game)', () => {
    const v = evaluateRetryLockout(NOW, legacyRec(NOW + 10 * 86_400_000), retryLockoutPolicyFor('off'));
    expect(v.locked).toBe(false);
    expect(v.remainingMs).toBe(0);
  });
});

// ── 11. Precedence ───────────────────────────────────────────────────────────
describe('evaluateRetryLockout — the duration form wins over the legacy instant', () => {
  test('conflicting forms resolve to the duration form', () => {
    const rec: RetryLockoutRecord = {
      cooldownUntil: NOW + 90_000, // a stale/legacy instant
      lastFailureAt: NOW,
      lockoutMs: 15_000,           // the authoritative duration
    };
    const v = evaluateRetryLockout(NOW, rec, STANDARD);
    expect(v.source).toBe('duration');
    expect(v.remainingMs).toBe(15_000);
  });
});

// ── 12. The policy helper ────────────────────────────────────────────────────
describe('retryLockoutPolicyFor', () => {
  test('each level maps to its own ceiling', () => {
    expect(retryLockoutPolicyFor('off').maxCooldownSeconds).toBe(0);
    expect(retryLockoutPolicyFor('gentle').maxCooldownSeconds).toBe(30);
    expect(retryLockoutPolicyFor('standard').maxCooldownSeconds).toBe(90);
    expect(retryLockoutPolicyFor('strict').maxCooldownSeconds).toBe(180);
  });

  test('a garbage level falls back to off, which can never lock', () => {
    const policy = retryLockoutPolicyFor('BRUTAL' as never);
    expect(policy.maxCooldownSeconds).toBe(0);
    expect(evaluateRetryLockout(NOW, durationRec(NOW, 90), policy).locked).toBe(false);
  });
});
