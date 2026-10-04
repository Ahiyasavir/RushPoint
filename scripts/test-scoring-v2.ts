// scoring-v2 (openspec/changes/scoring-v2): a mission time the creator filled in wrong must not
// produce a wrong score, and every bonus is a PERCENTAGE of the mission points a team earned —
// never a flat amount that jumps the board regardless of the game's point scale. No emulator.
//   npx tsx scripts/test-scoring-v2.ts
import {
  sigmoidMultiplier,
  taskScoreSmart,
  skipAward,
  fieldPaceRatios,
  pacePct,
  completionBonus,
  composeLeaderboardScore,
  sumEarnedPoints,
  teamExpectedRouteMinutes,
  COMPLETION_BONUS_PCT,
  PACE_MAX_PCT,
  SMART_MULT_MIN,
  SMART_MULT_MAX,
} from '../packages/shared/src/scoringPresets';
import type { RunStageRecord, RunTaskRecord } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── D1: the per-mission curve is bounded, and on-target pays exactly the difficulty value ──────
check('curve: on target (x=1) is exactly 1.0', near(sigmoidMultiplier(1), 1));
check('curve: bounds are 0.7 … 1.3', SMART_MULT_MIN === 0.7 && SMART_MULT_MAX === 1.3);
for (const x of [0, 0.01, 0.5, 1, 2, 7.5, 15, 1e6]) {
  const m = sigmoidMultiplier(x);
  check(`curve: x=${x} stays within [0.7, 1.3]`, m >= SMART_MULT_MIN && m <= SMART_MULT_MAX, String(m));
}
check('curve: faster pays more than slower', sigmoidMultiplier(0.5) > sigmoidMultiplier(1) && sigmoidMultiplier(1) > sigmoidMultiplier(2));
{
  // The motivating case: a 2-minute estimate on a mission that really takes 15. The old curve paid
  // 20% of the mission's value (a 5× loss decided by the author's guess); the new one at most -30%.
  const wrong = taskScoreSmart(8, 15, 2);
  const right = taskScoreSmart(8, 15, 15);
  check('wrong estimate (2 min for a 15-min mission) costs at most 30%', wrong >= 0.7 * right - 1, `${wrong} vs ${right}`);
  // And the reverse, a 60-minute guess on a 5-minute mission, gains at most 30%.
  const generous = taskScoreSmart(8, 5, 60);
  check('generous estimate (60 min for a 5-min mission) gains at most 30%', generous <= 1.3 * right + 1, `${generous} vs ${right}`);
  check('on-target pays exactly 100 × d/10', taskScoreSmart(8, 15, 15) === 80);
  check('skipAward(smart) is the on-target value', skipAward('smart_weighted', { pointValue: 0, difficulty: 8, estimatedMinutes: 15 }) === 80);
}

// ── D2: pace is measured against the FIELD, so a wrong estimate cancels ───────────────────────
{
  const field = [
    { durationMin: 40, expectedMin: 50 },
    { durationMin: 50, expectedMin: 50 },
    { durationMin: 70, expectedMin: 50 },
  ];
  const r = fieldPaceRatios(field);
  check('pace: the median team has r = 1', near(r[1] as number, 1));
  check('pace: faster than the median → r < 1', (r[0] as number) < 1);
  check('pace: slower than the median → r > 1', (r[2] as number) > 1);
  // Every estimate wrong by ×10 (or ÷10): the ratios must not move AT ALL.
  for (const k of [10, 0.1, 3.7]) {
    const scaled = fieldPaceRatios(field.map((f) => ({ ...f, expectedMin: f.expectedMin * k })));
    check(`pace: every estimate ×${k} leaves every ratio unchanged`, scaled.every((v, i) => near(v as number, r[i] as number)),
      JSON.stringify(scaled));
  }
  // Teams that played different subsets: a team that completed half the work in half the time is
  // exactly on pace, not "twice as fast".
  const subsets = fieldPaceRatios([
    { durationMin: 60, expectedMin: 60 },
    { durationMin: 30, expectedMin: 30 },
    { durationMin: 60, expectedMin: 60 },
  ]);
  check('pace: half the work in half the time is on pace', near(subsets[1] as number, 1), JSON.stringify(subsets));
}
{
  // One finisher: no field. The author's estimate is only trusted when it is plausible.
  check('lone finisher: plausible estimate → r = d/E', near(fieldPaceRatios([{ durationMin: 40, expectedMin: 50 }])[0] as number, 0.8));
  check('lone finisher: estimate 10× too short → no pace term', fieldPaceRatios([{ durationMin: 50, expectedMin: 5 }])[0] === null);
  check('lone finisher: estimate 10× too long → no pace term', fieldPaceRatios([{ durationMin: 5, expectedMin: 50 }])[0] === null);
  check('lone finisher: no estimates at all → no pace term', fieldPaceRatios([{ durationMin: 40, expectedMin: 0 }])[0] === null);
}
{
  // Raw mode only when NO finisher has expected minutes; mixed ⇒ the one without gets no pace term.
  const r = fieldPaceRatios([
    { durationMin: 30, expectedMin: 0 },
    { durationMin: 60, expectedMin: 0 },
  ]);
  check('raw mode: median of 30 and 60 is 45', near(r[0] as number, 30 / 45) && near(r[1] as number, 60 / 45), JSON.stringify(r));
  check('everyone at zero duration → no pace term', fieldPaceRatios([{ durationMin: 0, expectedMin: 0 }, { durationMin: 0, expectedMin: 0 }]).every((v) => v === null));
  check('non-finite inputs never yield a non-finite ratio',
    fieldPaceRatios([{ durationMin: NaN, expectedMin: 10 }, { durationMin: 10, expectedMin: Infinity }]).every((v) => v === null || Number.isFinite(v)));
  check('empty field → empty', fieldPaceRatios([]).length === 0);
}
{
  check('pacePct: on the median → 0', pacePct(1) === 0);
  check('pacePct: 20% faster → +10%', near(pacePct(0.8), 0.10));
  check('pacePct: 20% slower → -10%', near(pacePct(1.2), -0.10));
  check('pacePct: capped at +15%', pacePct(0) === PACE_MAX_PCT);
  check('pacePct: the slow side is capped at the completion bonus (-10%)', pacePct(10) === -COMPLETION_BONUS_PCT);
  check('pacePct: null → 0', pacePct(null) === 0);
  check('pacePct: NaN → 0', pacePct(NaN) === 0);
}

// ── D3: every bonus is a percentage of earned mission points; penalties apply last ────────────
check('completion bonus is 10%', COMPLETION_BONUS_PCT === 0.10 && completionBonus(400, true) === 40);
check('no completion bonus when not done', completionBonus(400, false) === 0);
check('completion bonus on a 10-point-per-mission game stays proportional', completionBonus(50, true) === 5);
check('compose: points + 10% + pace% − penalty',
  composeLeaderboardScore({ points: 400, allStagesDone: true, pacePct: 0.1, bonusPenalty: 20 }) === 400 + 40 + 40 - 20);
check('compose: a flat 20-point fine is exactly 20 points', composeLeaderboardScore({ points: 400, allStagesDone: true, pacePct: 0.1, bonusPenalty: 20 })
  === composeLeaderboardScore({ points: 400, allStagesDone: true, pacePct: 0.1, bonusPenalty: 0 }) - 20);
check('compose: a flat bonus (negative penalty) with 0 mission points is the bonus alone',
  composeLeaderboardScore({ points: 0, allStagesDone: false, pacePct: 0, bonusPenalty: -40 }) === 40);
check('compose: never below 0', composeLeaderboardScore({ points: 10, allStagesDone: false, pacePct: -0.15, bonusPenalty: 999 }) === 0);
check('compose: non-finite inputs never yield a non-finite score',
  Number.isFinite(composeLeaderboardScore({ points: NaN, allStagesDone: true, pacePct: NaN, bonusPenalty: NaN })));
{
  // The whole point of the change: the maximum swing from bonuses is bounded by the points.
  const pts = 300;
  const top = composeLeaderboardScore({ points: pts, allStagesDone: true, pacePct: PACE_MAX_PCT, bonusPenalty: 0 });
  check('bonuses can add at most 25% of the earned points', top <= Math.round(pts * 1.25) + 1, String(top));
}

// ── Expected route minutes count COMPLETED missions only (bug fix) ─────────────────────────────
{
  const rec = (status: RunTaskRecord['status'], stamp: number, earnedScore = 0): RunTaskRecord =>
    ({ taskId: `t${stamp}-${status}`, taskIndex: 0, status, earnedScore, expectedDurationMinutesAtCompletion: stamp });
  const stages: RunStageRecord[] = [{ stageId: 's', order: 0, status: 'completed', tasks: [
    rec('completed', 10, 100), rec('skipped', 30, 50), rec('completed', 5, 100),
  ] }];
  check('expected route: skipped records do not count', teamExpectedRouteMinutes(stages, { stages: [] }) === 15,
    String(teamExpectedRouteMinutes(stages, { stages: [] })));
  check('points: completed and skipped (consolation) both count', sumEarnedPoints(stages) === 250);
  check('points: a poisoned record counts as 0', sumEarnedPoints([{ stageId: 's', order: 0, status: 'active', tasks: [rec('completed', 1, NaN)] }]) === 0);
}

{
  // One finisher with NO expected minutes (every mission skipped by staff) must not drag the whole
  // field onto raw durations: it gets no pace term, the others keep their paced comparison.
  const r = fieldPaceRatios([
    { durationMin: 40, expectedMin: 50 },
    { durationMin: 60, expectedMin: 50 },
    { durationMin: 2, expectedMin: 0 },
  ]);
  check('a finisher with no expected minutes gets no pace term', r[2] === null, JSON.stringify(r));
  check('…and the others are still compared paced, among themselves', near(r[0] as number, 0.8) && near(r[1] as number, 1.2), JSON.stringify(r));
}

{
  // Finishing must never hurt: the slowest finisher still scores at least what an unfinished team
  // with the same mission points scores.
  const slowest = composeLeaderboardScore({ points: 100, allStagesDone: true, pacePct: pacePct(100), bonusPenalty: 0 });
  const unfinished = composeLeaderboardScore({ points: 100, allStagesDone: false, pacePct: 0, bonusPenalty: 0 });
  check('the slowest finisher never scores below an unfinished team with the same points', slowest >= unfinished, `${slowest} vs ${unfinished}`);
}

console.log(`\n${failures === 0 ? 'ALL SCORING-V2 TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
