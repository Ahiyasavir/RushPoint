// Property / invariant tests for the power-ups seeded roll (change: power-ups).
// The roll is a PURE deterministic hash — no Math.random — so a completion replay
// recomputes the same award and can never double-grant. This lane pins the exact
// FNV vectors (the anti-drift contract the e2e script copies), proves determinism,
// checks the ~25% award rate over a large corpus, and asserts input sensitivity.
//
// Deliberately dependency-free (a small LCG, no fast-check).
import { describe, test, expect } from 'vitest';
import { powerUpHash, rollPowerUp, POWER_UP_RATE, POWER_UP_BONUS } from '@rushpoint/shared';

// ── Seeded RNG (reproducible: a failure always repeats) ───────────────────────
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

describe('powerUps — constants', () => {
  test('rate is 25% and bonus is +15', () => {
    expect(POWER_UP_RATE).toBe(25);
    expect(POWER_UP_BONUS).toBe(15);
  });
});

describe('powerUps — pinned known vectors (anti-drift contract for the e2e copy)', () => {
  // Any change to these must be intentional and mirrored in scripts/e2e-verify.mjs's
  // embedded FNV copy — that is the whole point of pinning them.
  const VECTORS: Array<[string, string, string, number, 'double_points' | 'bonus_points' | null]> = [
    ['run1', 'teamA', 't13', 1474030213, 'double_points'],
    ['run1', 'teamA', 't6',   226382113, 'bonus_points'],
    ['run1', 'teamA', 't0',   259937351, null],
    ['run1', 'teamA', 't1',   243159732, null],
    ['runX', 'teamZ', 'taskQ', 3168554615, 'double_points'],
    ['r',    't',     'k',      3785323512, 'bonus_points'],
  ];
  for (const [r, tm, tk, hash, expected] of VECTORS) {
    test(`${r}/${tm}/${tk} ⇒ hash ${hash}, roll ${expected}`, () => {
      expect(powerUpHash(r, tm, tk)).toBe(hash);
      expect(rollPowerUp(r, tm, tk)).toBe(expected);
    });
  }
});

describe('powerUps — determinism', () => {
  test('rollPowerUp is a pure function: same inputs ⇒ same output (1000 triples)', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const r = `run${Math.floor(rng() * 1e6)}`;
      const tm = `team${Math.floor(rng() * 1e6)}`;
      const tk = `task${Math.floor(rng() * 1e6)}`;
      const a = rollPowerUp(r, tm, tk);
      const b = rollPowerUp(r, tm, tk);
      expect(b).toBe(a);
      expect(powerUpHash(r, tm, tk)).toBe(powerUpHash(r, tm, tk));
    }
  });
});

describe('powerUps — award rate + type balance over a corpus', () => {
  test('~25% award (±2pts) and both types roughly balanced over 20000 triples', () => {
    let award = 0, dbl = 0, bon = 0;
    const total = 20000;
    for (let i = 0; i < total; i++) {
      const r = rollPowerUp(`run${i % 97}`, `team${i % 53}`, `task${i}`);
      if (r) {
        award++;
        if (r === 'double_points') dbl++; else bon++;
      }
    }
    const rate = (award / total) * 100;
    expect(rate).toBeGreaterThan(POWER_UP_RATE - 2);
    expect(rate).toBeLessThan(POWER_UP_RATE + 2);
    // Both types occur with roughly equal frequency among awards (within 10% split).
    const share = dbl / award;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });
});

describe('powerUps — input sensitivity', () => {
  test('changing any single input field changes the hash', () => {
    const base = powerUpHash('a', 'b', 'c');
    expect(powerUpHash('a2', 'b', 'c')).not.toBe(base);
    expect(powerUpHash('a', 'b2', 'c')).not.toBe(base);
    expect(powerUpHash('a', 'b', 'c2')).not.toBe(base);
  });
});
