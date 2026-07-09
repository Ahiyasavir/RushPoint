// Property / invariant tests for the pure logic most likely to hide a bug —
// the "oracle" lane. Instead of pinning one example, each test throws hundreds
// of SEEDED-random inputs at a function and asserts a property that must ALWAYS
// hold (an invariant). This is the fast (no-emulator) counterpart to the e2e's
// runtime oracle: an agent that breaks scoring, ranking, answer-matching, geo
// gating, or rate-limiting gets a RED here in milliseconds, with a reproducible
// counterexample (the seed is fixed).
//
// Deliberately dependency-free (a small LCG, no fast-check) to avoid adding a
// devDependency to the functions workspace.
import { describe, test, expect } from 'vitest';
import {
  speedBonus, SPEED_BONUS_CAP, sigmoidMultiplier, taskScoreSmart, taskScoreFixed,
  matchesTaskAnswer, evaluateTrigger, rateLimit, haversineKm,
} from '@rushpoint/shared';
import { buildRankings } from '../runs/index';
import type { Game, RunTeam } from '@rushpoint/shared';

// ── Seeded RNG (reproducible: a failure always repeats) ───────────────────────
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
const N = 300; // samples per property

describe('scoringPresets — value invariants', () => {
  test('speedBonus is bounded [0, CAP], zero when slower, monotonic non-increasing in elapsed time', () => {
    const rng = makeRng(1);
    for (let i = 0; i < N; i++) {
      const expected = rng() * 120;
      const actual = rng() * 120;
      const b = speedBonus(expected, actual);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(SPEED_BONUS_CAP);
      if (actual >= expected) expect(b).toBe(0);            // no bonus for being slow
      // slower can never earn MORE bonus than faster
      expect(speedBonus(expected, actual + 5)).toBeLessThanOrEqual(b);
    }
  });

  test('sigmoidMultiplier stays in (0.2, 1.5) and is monotonic decreasing in x', () => {
    const rng = makeRng(2);
    for (let i = 0; i < N; i++) {
      const x = (rng() - 0.5) * 8; // wide range around the estimate ratio 1
      const m = sigmoidMultiplier(x);
      expect(m).toBeGreaterThan(0.2);
      expect(m).toBeLessThan(1.5);
      expect(sigmoidMultiplier(x + 0.3)).toBeLessThanOrEqual(m + 1e-9);
    }
  });

  test('taskScoreSmart is finite and non-negative for ANY input (incl. garbage)', () => {
    const rng = makeRng(3);
    const garbage = [NaN, Infinity, -Infinity, 0, -5];
    for (let i = 0; i < N; i++) {
      const difficulty = rng() < 0.1 ? garbage[i % garbage.length] : rng() * 10;
      const actual = rng() < 0.1 ? garbage[i % garbage.length] : rng() * 60;
      const est = rng() < 0.1 ? garbage[i % garbage.length] : rng() * 30;
      const s = taskScoreSmart(difficulty, actual, est);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });

  test('taskScoreFixed returns the pointValue (0 for non-numeric)', () => {
    expect(taskScoreFixed({ pointValue: 42 })).toBe(42);
    // @ts-expect-error deliberately malformed
    expect(taskScoreFixed({ pointValue: 'x' })).toBe(0);
    // @ts-expect-error deliberately malformed
    expect(taskScoreFixed({ pointValue: undefined })).toBe(0);
  });
});

describe('matchesTaskAnswer — answer-key invariants', () => {
  test('numeric: accepted ⇔ |given − answer| ≤ tolerance', () => {
    const rng = makeRng(4);
    for (let i = 0; i < N; i++) {
      const answer = Math.round((rng() - 0.5) * 200);
      const tol = Math.round(rng() * 5);
      const given = answer + Math.round((rng() - 0.5) * 12);
      const task = { type: 'numeric', numericAnswer: answer, numericTolerance: tol } as const;
      const within = Math.abs(given - answer) <= tol;
      expect(matchesTaskAnswer(task, String(given))).toBe(within);
    }
  });

  test('numeric: non-numeric input never matches', () => {
    const task = { type: 'numeric', numericAnswer: 5, numericTolerance: 1 } as const;
    for (const junk of ['', ' ', 'abc', 'NaN', 'five', '  ']) {
      expect(matchesTaskAnswer(task, junk)).toBe(false);
    }
  });

  test('quiz: a correct answer matches under random casing + surrounding whitespace', () => {
    const rng = makeRng(5);
    const answers = ['Jerusalem', 'Tel Aviv', 'Haifa'];
    for (let i = 0; i < N; i++) {
      const pick = answers[Math.floor(rng() * answers.length)];
      const mangled = `  ${[...pick].map((c) => (rng() < 0.5 ? c.toLowerCase() : c.toUpperCase())).join('')}\t`;
      expect(matchesTaskAnswer({ type: 'quiz', answers }, mangled)).toBe(true);
      // a one-char-off decoy never matches
      expect(matchesTaskAnswer({ type: 'quiz', answers }, pick + 'z')).toBe(false);
    }
  });
});

describe('evaluateTrigger — geo gate invariants', () => {
  test('instant / locationless always pass regardless of distance', () => {
    const rng = makeRng(6);
    for (let i = 0; i < N; i++) {
      const d = rng() * 10000;
      expect(evaluateTrigger('instant', d).ok).toBe(true);
      expect(evaluateTrigger('locationless', d).ok).toBe(true);
    }
  });

  test('radius/exact: accepted ⇔ finite distance ≤ radius', () => {
    const rng = makeRng(7);
    for (let i = 0; i < N; i++) {
      const radius = 5 + rng() * 200;
      const dist = rng() * 400;
      const v = evaluateTrigger('radius', dist, radius);
      expect(v.ok).toBe(dist <= radius);
    }
  });

  test('a hidden out-of-range rejection never leaks a distance digit', () => {
    const rng = makeRng(8);
    for (let i = 0; i < N; i++) {
      const radius = 20 + rng() * 60;
      const dist = radius + 10 + rng() * 500; // always outside
      const v = evaluateTrigger('radius', dist, radius, { hidden: true });
      expect(v.ok).toBe(false);
      expect(/\d/.test(v.reason ?? '')).toBe(false);
    }
  });
});

describe('rateLimit — the cap can never be exceeded within a window', () => {
  test('across a burst of calls, allowed count ≤ max', () => {
    const rng = makeRng(9);
    for (let trial = 0; trial < 40; trial++) {
      const max = 1 + Math.floor(rng() * 8);
      const windowMs = 1000;
      let state: { count: number; windowStartMs: number } | null = null;
      let allowed = 0;
      const now = 10_000;
      for (let call = 0; call < max * 3; call++) {
        const d = rateLimit(state, max, windowMs, now); // same instant → one window
        if (d.allowed) allowed++;
        state = d.nextState;
      }
      expect(allowed).toBe(max); // exactly the budget, never more
    }
  });

  test('a fresh window after expiry re-allows', () => {
    const max = 2, windowMs = 1000;
    let state: { count: number; windowStartMs: number } | null = null;
    for (let i = 0; i < max; i++) state = rateLimit(state, max, windowMs, 0).nextState;
    expect(rateLimit(state, max, windowMs, 0).allowed).toBe(false);      // capped
    expect(rateLimit(state, max, windowMs, 2000).allowed).toBe(true);    // window rolled
  });
});

// ── buildRankings — leaderboard well-formedness under random team sets ────────
function randTeam(rng: () => number, i: number): RunTeam {
  const stageCount = 1 + Math.floor(rng() * 3);
  const finished = rng() < 0.7;
  const start = new Date(1_700_000_000_000).toISOString();
  const finish = finished ? new Date(1_700_000_000_000 + rng() * 3_600_000).toISOString() : undefined;
  const stages = Array.from({ length: stageCount }, (_, s) => ({
    stageId: `s${s}`,
    status: (finished || s < stageCount - 1 ? 'completed' : 'active') as 'completed' | 'active',
    tasks: [{ taskId: `s${s}t0`, taskIndex: 0, status: 'completed' as const, earnedScore: Math.round(rng() * 100) }],
  }));
  return {
    id: `team-${i}`, displayName: `Team ${i}`, status: finished ? 'finished' : 'active',
    startedAt: start, finishedAt: finish, score: 0, bonusPenalty: Math.round(rng() * 30),
    stages,
  } as unknown as RunTeam;
}

function gameFor(preset: Game['scoringPreset']): Game {
  return {
    id: 'g', title: 'G', mode: 'individual', scoringPreset: preset,
    stages: Array.from({ length: 3 }, (_, s) => ({
      id: `s${s}`, order: s, title: `S${s}`,
      tasks: [{ id: `s${s}t0`, title: 'T', type: 'field', coordinates: { lat: 0, lng: 0 },
        difficulty: 3, estimatedMinutes: 5, expectedDurationMinutes: 5, pointValue: 50, maxConcurrentTeams: 3 }],
    })),
  } as unknown as Game;
}

describe('buildRankings — leaderboard invariants (all presets)', () => {
  const presets: Game['scoringPreset'][] = ['time_only', 'fixed_points_speed', 'smart_weighted'];
  const now = new Date(1_700_000_100_000).toISOString();

  test('every team appears exactly once with contiguous ranks 1..n', () => {
    const rng = makeRng(10);
    for (let i = 0; i < 100; i++) {
      const preset = presets[i % presets.length];
      const n = 1 + Math.floor(rng() * 8);
      const teams = Array.from({ length: n }, (_, k) => randTeam(rng, k));
      const board = buildRankings(gameFor(preset), teams, now);
      expect(board).toHaveLength(n);
      expect(board.map((r) => r.rank)).toEqual(Array.from({ length: n }, (_, k) => k + 1));
      expect(new Set(board.map((r) => r.teamId)).size).toBe(n);
      for (const t of teams) expect(board.some((r) => r.teamId === t.id)).toBe(true);
      expect(board.every((r) => Number.isFinite(r.score))).toBe(true);
    }
  });

  test('non-time presets rank by non-increasing score', () => {
    const rng = makeRng(11);
    for (const preset of ['fixed_points_speed', 'smart_weighted'] as const) {
      for (let i = 0; i < 50; i++) {
        const teams = Array.from({ length: 2 + Math.floor(rng() * 6) }, (_, k) => randTeam(rng, k));
        const board = buildRankings(gameFor(preset), teams, now);
        for (let k = 1; k < board.length; k++) {
          expect(board[k - 1].score).toBeGreaterThanOrEqual(board[k].score);
        }
      }
    }
  });

  test('deterministic: identical input yields identical ranking', () => {
    const rng = makeRng(12);
    for (let i = 0; i < 50; i++) {
      const preset = presets[i % presets.length];
      const teams = Array.from({ length: 1 + Math.floor(rng() * 6) }, (_, k) => randTeam(rng, k));
      const a = buildRankings(gameFor(preset), teams, now);
      const b = buildRankings(gameFor(preset), teams.slice(), now);
      expect(a).toEqual(b);
    }
  });

  test('time_only: finished teams outrank unfinished, and rank by ascending duration', () => {
    const rng = makeRng(13);
    for (let i = 0; i < 50; i++) {
      const teams = Array.from({ length: 2 + Math.floor(rng() * 6) }, (_, k) => randTeam(rng, k));
      const board = buildRankings(gameFor('time_only'), teams, now);
      const finishedFlags = board.map((r) => !!r.finishedAt);
      // once we hit an unfinished team, no finished team may follow
      const firstUnfinished = finishedFlags.indexOf(false);
      if (firstUnfinished >= 0) {
        expect(finishedFlags.slice(firstUnfinished).every((f) => f === false)).toBe(true);
      }
      // finished teams are in ascending duration order
      const finishedDurations = board.filter((r) => r.finishedAt).map((r) => r.durationSeconds ?? 0);
      for (let k = 1; k < finishedDurations.length; k++) {
        expect(finishedDurations[k - 1]).toBeLessThanOrEqual(finishedDurations[k]);
      }
    }
  });
});

describe('haversineKm — metric invariants', () => {
  test('non-negative, symmetric, and zero for identical points', () => {
    const rng = makeRng(14);
    for (let i = 0; i < N; i++) {
      const a = { lat: (rng() - 0.5) * 160, lng: (rng() - 0.5) * 360 };
      const b = { lat: (rng() - 0.5) * 160, lng: (rng() - 0.5) * 360 };
      const d = haversineKm(a, b);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(Math.abs(d - haversineKm(b, a))).toBeLessThan(1e-9);
      expect(haversineKm(a, a)).toBeLessThan(1e-9);
    }
  });
});
