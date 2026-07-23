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
  scoreFixedPointsSpeed,
  // pause-clock-tasks: the excluded-duration rule.
  taskExcludedMs, teamExcludedMs, adjustedElapsedMs,
  matchesTaskAnswer, evaluateTrigger, rateLimit, haversineKm,
  wrongAnswerCost, cooldownRemainingSeconds, hashAnswerForReplay, WRONG_ANSWER_LEVELS,
  // task-duration-defaults: the derived per-interaction duration safety envelope.
  defaultExpectedDurationMinutes, effectiveExpectedDurationMinutes,
  TASK_DURATION_MIN_MINUTES, TASK_DURATION_MAX_MINUTES,
} from '@rushpoint/shared';
import { buildRankings } from '../runs/index';
import type { Game, RunTeam, ScoringPreset, WrongAnswerLevel } from '@rushpoint/shared';

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

  // Per-interaction default durations (change: task-duration-defaults). The derived
  // default is an AUTHORING-time value — no scoring function calls it, which is why
  // every scoring invariant above is unchanged — but a NaN/0/negative escaping it
  // into a task template would poison taskScoreSmart's divisor and computeSkillRatio's
  // pace term. Pin the safety envelope against arbitrary garbage.
  test('defaultExpectedDurationMinutes is finite and within [0.5, 30] for ANY input', () => {
    const rng = makeRng(11);
    const types = ['field', 'smart_station', 'photo', 'self_report', 'quiz', 'numeric',
      'geofence', 'sequence', 'survey', 'teleport', '', undefined, null, 7, {}];
    const garbageArrays = [undefined, null, 'nope', 5, {}, [], ['a'], ['a', 'b', 'c']];
    for (let i = 0; i < N; i++) {
      const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
      const task = {
        type: pick(types),
        choices: pick(garbageArrays),
        orderItems: pick(garbageArrays),
        surveyChoices: pick(garbageArrays),
        steps: pick(garbageArrays),
        smart: rng() < 0.5 ? { verificationType: pick(['code_verification', 'photo_upload', 'x']) } : undefined,
      };
      const m = defaultExpectedDurationMinutes(task as never);
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBeGreaterThanOrEqual(TASK_DURATION_MIN_MINUTES);
      expect(m).toBeLessThanOrEqual(TASK_DURATION_MAX_MINUTES);

      // The authored value wins when usable, and garbage never wins.
      const authored = pick([NaN, Infinity, -Infinity, 0, -5, 1e9, 7, undefined]);
      const eff = effectiveExpectedDurationMinutes({ ...task, expectedDurationMinutes: authored } as never);
      expect(Number.isFinite(eff)).toBe(true);
      expect(eff).toBeGreaterThan(0);
      expect(eff).toBeLessThanOrEqual(TASK_DURATION_MAX_MINUTES);
      if (authored === 7) expect(eff).toBe(7);
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

  test('non-time presets: mid-run ties (still-active teams, equal score) rank ' +
    'deterministically by progress, not by input array order (leaderboard rank must ' +
    'not depend on the unordered Firestore team query order — this shuffles the live ' +
    'board between refreshes for any two teams that happen to be tied)', () => {
    // Two ACTIVE (unfinished) teams with identical score but different progress —
    // teamB has completed more stages, so is meaningfully "ahead" even though the
    // raw point total happens to match right now.
    const makeTeam = (id: string, completedStages: number, activeStages: number): RunTeam => {
      const start = new Date(1_700_000_000_000).toISOString();
      const stages = [
        ...Array.from({ length: completedStages }, (_, s) => ({
          stageId: `c${s}`, status: 'completed' as const,
          tasks: [{ taskId: `c${s}t0`, taskIndex: 0, status: 'completed' as const, earnedScore: 0 }],
        })),
        ...Array.from({ length: activeStages }, (_, s) => ({
          stageId: `a${s}`, status: 'active' as const,
          tasks: [{ taskId: `a${s}t0`, taskIndex: 0, status: 'active' as const, earnedScore: 0 }],
        })),
      ];
      return {
        id, displayName: id, status: 'active', startedAt: start, finishedAt: undefined,
        score: 0, bonusPenalty: 0, stages,
      } as unknown as RunTeam;
    };
    const behind = makeTeam('behind', 1, 2);
    const ahead = makeTeam('ahead', 2, 1);

    for (const preset of ['fixed_points_speed', 'smart_weighted'] as const) {
      const boardA = buildRankings(gameFor(preset), [behind, ahead], now);
      const boardB = buildRankings(gameFor(preset), [ahead, behind], now);
      // Both boards must agree on who ranks first, regardless of input order.
      expect(boardA[0].teamId).toBe(boardB[0].teamId);
      // The team with more completed stages should win the tie.
      expect(boardA[0].teamId).toBe('ahead');
    }
  });
});

describe('buildRankings — NaN-poison resistance', () => {
  const now = new Date(1_700_000_100_000).toISOString();

  // A team whose ONE task record carries a non-finite earnedScore (legacy/hand-
  // written data, or a scoring bug upstream). parseRunTeam validates the top-level
  // `score` but never the nested earnedScore, so this class reaches buildRankings.
  function poisonedTeam(id: string): RunTeam {
    const start = new Date(1_700_000_000_000).toISOString();
    return {
      id, displayName: id, status: 'finished',
      startedAt: start, finishedAt: new Date(1_700_000_050_000).toISOString(),
      score: 0, bonusPenalty: 0,
      stages: [{
        stageId: 's0', status: 'completed',
        tasks: [{ taskId: 's0t0', taskIndex: 0, status: 'completed', earnedScore: NaN }],
      }],
    } as unknown as RunTeam;
  }

  // A clean, finished team (finite earnedScore).
  function cleanTeam(id: string, earned: number): RunTeam {
    const start = new Date(1_700_000_000_000).toISOString();
    return {
      id, displayName: id, status: 'finished',
      startedAt: start, finishedAt: new Date(1_700_000_040_000).toISOString(),
      score: 0, bonusPenalty: 0,
      stages: [{
        stageId: 's0', status: 'completed',
        tasks: [{ taskId: 's0t0', taskIndex: 0, status: 'completed', earnedScore: earned }],
      }],
    } as unknown as RunTeam;
  }

  // A game whose single task omits BOTH expectedDurationMinutes and estimatedMinutes,
  // exercising the expectedTotal reduce in scoreFixedPointsSpeed.
  function gameNoDurations(preset: Game['scoringPreset']): Game {
    return {
      id: 'g', title: 'G', mode: 'individual', scoringPreset: preset,
      stages: [{
        id: 's0', order: 0, title: 'S0',
        tasks: [{ id: 's0t0', title: 'T', type: 'field', coordinates: { lat: 0, lng: 0 },
          difficulty: 3, pointValue: 50, maxConcurrentTeams: 3 }],
      }],
    } as unknown as Game;
  }

  test('a poisoned earnedScore never yields a non-finite leaderboard score (all point presets)', () => {
    for (const preset of ['smart_weighted', 'fixed_points_speed'] as const) {
      const teams = [poisonedTeam('poison'), cleanTeam('clean-a', 40), cleanTeam('clean-b', 70)];
      const board = buildRankings(gameFor(preset), teams, now);
      expect(board.every((r) => Number.isFinite(r.score))).toBe(true);
      expect(board.map((r) => r.rank)).toEqual([1, 2, 3]);
      expect(new Set(board.map((r) => r.teamId)).size).toBe(3);
    }
  });

  test('a task missing both durations still yields a finite fixed_points_speed score', () => {
    const board = buildRankings(gameNoDurations('fixed_points_speed'), [cleanTeam('t0', 50)], now);
    expect(board).toHaveLength(1);
    expect(Number.isFinite(board[0].score)).toBe(true);
  });

  test('live/final parity under poison: ranking is independent of (unordered) input order', () => {
    for (const preset of ['smart_weighted', 'fixed_points_speed'] as const) {
      const teams = [poisonedTeam('poison'), cleanTeam('a', 40), cleanTeam('b', 70), cleanTeam('c', 55)];
      const forward = buildRankings(gameFor(preset), teams, now);
      const reversed = buildRankings(gameFor(preset), teams.slice().reverse(), now);
      expect(forward).toEqual(reversed);
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

// ── Wrong-answer cost (change: wrong-answer-cost) ─────────────────────────────
// The curve charges bonusPenalty, so a NaN or a negative here would poison every
// finisher's Z-score, and an uncapped charge could spiral one bad question into an
// unwinnable game. These properties pin exactly that.
describe('wrongAnswerCost — penalty invariants', () => {
  const LEVELS: WrongAnswerLevel[] = ['off', 'gentle', 'standard', 'strict'];
  const PRESETS: ScoringPreset[] = ['time_only', 'fixed_points_speed', 'smart_weighted'];
  const GARBAGE = [NaN, Infinity, -Infinity, -7, 0, 1.5];

  test('finite, non-negative, and inside both caps for ANY input (incl. garbage)', () => {
    const rng = makeRng(21);
    for (let i = 0; i < N; i++) {
      const level = LEVELS[Math.floor(rng() * LEVELS.length)];
      const preset = PRESETS[Math.floor(rng() * PRESETS.length)];
      const attempt = rng() < 0.15 ? GARBAGE[i % GARBAGE.length] : Math.floor(rng() * 20);
      const charged = rng() < 0.15 ? GARBAGE[i % GARBAGE.length] : Math.floor(rng() * 200);
      const c = wrongAnswerCost(level, preset, attempt, charged);
      const tuning = WRONG_ANSWER_LEVELS[level];
      expect(Number.isFinite(c.points)).toBe(true);
      expect(c.points).toBeGreaterThanOrEqual(0);
      expect(c.points).toBeLessThanOrEqual(tuning.maxPoints);
      expect(Number.isFinite(c.cooldownSeconds)).toBe(true);
      expect(c.cooldownSeconds).toBeGreaterThanOrEqual(0);
      expect(c.cooldownSeconds).toBeLessThanOrEqual(tuning.maxCooldownSeconds);
    }
  });

  test('the cumulative point cap can never be exceeded, however many wrong answers', () => {
    for (const level of LEVELS) {
      for (const preset of PRESETS) {
        let charged = 0;
        for (let attempt = 1; attempt <= 40; attempt++) {
          const c = wrongAnswerCost(level, preset, attempt, charged);
          expect(charged + c.points).toBeLessThanOrEqual(WRONG_ANSWER_LEVELS[level].maxPoints);
          charged += c.points;
        }
        expect(charged).toBeLessThanOrEqual(WRONG_ANSWER_LEVELS[level].maxPoints);
      }
    }
  });

  test('cumulative points are non-decreasing and the cooldown is monotonic in attempts', () => {
    for (const level of LEVELS) {
      let charged = 0;
      let prevCooldown = -1;
      for (let attempt = 1; attempt <= 30; attempt++) {
        const c = wrongAnswerCost(level, 'smart_weighted', attempt, charged);
        // per-attempt points fall to 0 once the cap is spent, so the honest
        // monotonic quantity is the CUMULATIVE charge.
        expect(c.points).toBeGreaterThanOrEqual(0);
        charged += c.points;
        expect(c.cooldownSeconds).toBeGreaterThanOrEqual(prevCooldown);
        prevCooldown = c.cooldownSeconds;
      }
    }
  });

  test('time_only never charges points; the cooldown is identical across presets', () => {
    for (const level of LEVELS) {
      for (let attempt = 1; attempt <= 12; attempt++) {
        const t = wrongAnswerCost(level, 'time_only', attempt, 0);
        const p = wrongAnswerCost(level, 'fixed_points_speed', attempt, 0);
        expect(t.points).toBe(0);
        expect(t.cooldownSeconds).toBe(p.cooldownSeconds);
      }
    }
  });

  test('level off is a total no-op (every pre-existing game)', () => {
    const rng = makeRng(22);
    for (let i = 0; i < N; i++) {
      const preset = PRESETS[Math.floor(rng() * PRESETS.length)];
      const c = wrongAnswerCost('off', preset, Math.floor(rng() * 50), Math.floor(rng() * 500));
      expect(c).toEqual({ points: 0, cooldownSeconds: 0, chargedIndex: 0 });
    }
  });

  test('cooldownRemainingSeconds is non-negative, finite, and fails OPEN on garbage', () => {
    const rng = makeRng(23);
    const now = 1_800_000_000_000;
    for (let i = 0; i < N; i++) {
      const until = rng() < 0.15 ? GARBAGE[i % GARBAGE.length] : now + (rng() - 0.4) * 300_000;
      const left = cooldownRemainingSeconds(until, now);
      expect(Number.isFinite(left)).toBe(true);
      expect(left).toBeGreaterThanOrEqual(0);
      if (!Number.isFinite(until) || until <= now) expect(left).toBe(0);
    }
  });

  test('the replay hash is stable, normalizing, and collision-free on the sampled space', () => {
    const rng = makeRng(24);
    const seen = new Map<string, string>();
    for (let i = 0; i < N; i++) {
      const raw = Math.floor(rng() * 100000).toString(36);
      const mangled = `  ${[...raw].map((ch) => (rng() < 0.5 ? ch.toUpperCase() : ch)).join('')} `;
      expect(hashAnswerForReplay(mangled)).toBe(hashAnswerForReplay(raw));
      const prior = seen.get(hashAnswerForReplay(raw));
      if (prior !== undefined) expect(prior).toBe(raw);   // same hash ⇒ same answer
      seen.set(hashAnswerForReplay(raw), raw);
    }
  });
});

// ── pause-clock-tasks — excluded-time invariants ──────────────────────────────
// The excluded duration is subtracted from EVERY time-derived scoring term, so
// the one thing it must never do is add time, go negative, or turn a finite
// elapsed time into garbage. These properties are the oracle for that.
describe('pausedClock — excluded-time invariants', () => {
  test('adjustedElapsedMs never adds time, never goes negative, stays finite', () => {
    const rng = makeRng(31);
    const garbage = [NaN, Infinity, -Infinity, -1, 0];
    for (let i = 0; i < N; i++) {
      const raw = rng() * 7_200_000;                                  // up to 2h
      const exc = rng() < 0.15 ? garbage[i % garbage.length] : rng() * 9_000_000;
      const adj = adjustedElapsedMs(raw, exc);
      expect(Number.isFinite(adj)).toBe(true);
      expect(adj).toBeGreaterThanOrEqual(0);
      expect(adj).toBeLessThanOrEqual(raw + 1e-9);                    // can only subtract
    }
  });

  test('adjustedElapsedMs is monotonic non-increasing in the excluded amount', () => {
    const rng = makeRng(32);
    for (let i = 0; i < N; i++) {
      const raw = rng() * 7_200_000;
      const exc = rng() * 7_200_000;
      expect(adjustedElapsedMs(raw, exc + rng() * 60_000))
        .toBeLessThanOrEqual(adjustedElapsedMs(raw, exc) + 1e-9);
    }
  });

  test('teamExcludedMs is finite and non-negative for ANY stored records (incl. garbage)', () => {
    const rng = makeRng(33);
    const garbage = [NaN, Infinity, -Infinity, -5_000];
    for (let i = 0; i < N; i++) {
      const stages = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => ({
        tasks: Array.from({ length: Math.floor(rng() * 4) }, (_, k) => ({
          excludedMs: rng() < 0.25 ? garbage[k % garbage.length] : rng() * 600_000,
        })),
      }));
      const total = teamExcludedMs(stages);
      expect(Number.isFinite(total)).toBe(true);
      expect(total).toBeGreaterThanOrEqual(0);
    }
  });

  test('taskExcludedMs is 0 or a non-negative finite span, never NaN', () => {
    const rng = makeRng(34);
    const stamps: (string | undefined)[] = [
      undefined, '', 'not-a-date', new Date(1_700_000_000_000).toISOString(),
      new Date(1_700_000_600_000).toISOString(),
    ];
    for (let i = 0; i < N; i++) {
      const a = stamps[Math.floor(rng() * stamps.length)];
      const b = stamps[Math.floor(rng() * stamps.length)];
      const v = taskExcludedMs({ startedAt: a, completedAt: b }, rng() < 0.5);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  test('an excluded amount can only INCREASE a fixed_points_speed score, and stays capped', () => {
    const rng = makeRng(35);
    const game = gameFor('fixed_points_speed');
    for (let i = 0; i < N; i++) {
      const start = new Date(1_700_000_000_000).toISOString();
      const finish = new Date(1_700_000_000_000 + rng() * 7_200_000).toISOString();
      const stages = [{ stageId: 's0', order: 0, status: 'completed' as const,
        tasks: [{ taskId: 's0t0', taskIndex: 0, status: 'completed' as const, earnedScore: 50 }] }];
      const exc = rng() * 9_000_000;
      const withOut = scoreFixedPointsSpeed(stages, start, finish, game);
      const withExc = scoreFixedPointsSpeed(stages, start, finish, game, exc);
      expect(withExc).toBeGreaterThanOrEqual(withOut);
      expect(withExc - 50).toBeLessThanOrEqual(SPEED_BONUS_CAP);
    }
  });
});

describe('buildRankings — a run in which EVERY task pauses the clock', () => {
  const now = new Date(1_700_000_100_000).toISOString();

  // The degenerate case the feature makes reachable: total excluded >= total
  // elapsed, so every adjusted duration floors at exactly 0. Nothing divides by
  // the elapsed time, and the Z-Score's sigma-of-zeros guard must hold.
  function allPausedTeam(i: number, elapsedMs: number): RunTeam {
    const start = 1_700_000_000_000;
    return {
      id: `team-${i}`, displayName: `Team ${i}`, status: 'finished',
      startedAt: new Date(start).toISOString(),
      finishedAt: new Date(start + elapsedMs).toISOString(),
      score: 0, bonusPenalty: 0,
      stages: [{
        stageId: 's0', order: 0, status: 'completed',
        // Excluded >= elapsed on purpose: the floor, not the arithmetic, is the guard.
        tasks: [{ taskId: 's0t0', taskIndex: 0, status: 'completed', earnedScore: 40,
          excludedMs: elapsedMs + 60_000 }],
      }],
    } as unknown as RunTeam;
  }

  for (const preset of ['time_only', 'fixed_points_speed', 'smart_weighted'] as const) {
    test(`${preset}: ranks stay contiguous, scores finite, durations exactly 0`, () => {
      const rng = makeRng(36);
      const teams = Array.from({ length: 4 }, (_, k) => allPausedTeam(k, 60_000 + rng() * 3_600_000));
      const board = buildRankings(gameFor(preset), teams, now);
      expect(board.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
      expect(board.every((r) => Number.isFinite(r.score))).toBe(true);
      expect(board.every((r) => r.score >= 0)).toBe(true);
      expect(board.every((r) => r.durationSeconds === 0)).toBe(true);
      expect(board.every((r) => r.totalMinutes === 0)).toBe(true);
      expect(new Set(board.map((r) => r.teamId)).size).toBe(4);
    });
  }
});
