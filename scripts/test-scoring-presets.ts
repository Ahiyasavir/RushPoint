// Pure-logic tests for the THREE scoring presets and the shared final-score
// formula (packages/shared/src/scoringPresets.ts). Until now only computeTimeBonus
// (a helper) was covered — the actual per-preset run scorers, the Z-Score
// normalization, the completion bonus and the penalty subtraction had ZERO tests,
// yet every point shown on every leaderboard flows through them. No emulator.
//   npx tsx scripts/test-scoring-presets.ts
import {
  scoreTimeOnly,
  durationSeconds,
  speedBonus,
  scoreFixedPointsSpeed,
  taskScoreFixed,
  sigmoidMultiplier,
  taskScoreSmart,
  scoreSmartWeighted,
  applyPenalties,
  skipAward,
  finalSpeedBonus,
  FINAL_SPEED_BONUS_MAX_FRACTION,
  FINAL_SPEED_BONUS_MIN_FINISHERS,
  SPEED_BONUS_CAP,
  SPEED_BONUS_PER_MINUTE,
} from '../packages/shared/src/scoringPresets';
import * as presets from '../packages/shared/src/scoringPresets';
import type { RunStageRecord, RunTaskRecord } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── helpers to build run records ──────────────────────────────────────────────
function task(
  status: RunTaskRecord['status'],
  earnedScore?: number,
  // fix-fixed-points-speed-template-drift: the per-task EXPECTED route-minutes the
  // server stamps at a record's terminal transition. scoreFixedPointsSpeed now SUMS
  // these over the team's completed/skipped records (never re-reduces the template),
  // so a terminal record must carry it for the route expected-total to accrue.
  expectedStamp?: number,
): RunTaskRecord {
  return {
    taskId: 't', taskIndex: 0, status, earnedScore,
    ...(expectedStamp !== undefined ? { expectedDurationMinutesAtCompletion: expectedStamp } : {}),
  };
}
function stage(status: RunStageRecord['status'], tasks: RunTaskRecord[]): RunStageRecord {
  return { stageId: 's', order: 0, status, tasks };
}
const ISO = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min, 0)).toISOString();

// ── Preset A: time_only ───────────────────────────────────────────────────────
check('time_only always scores 0 (ranking is by duration)',
  scoreTimeOnly({ startedAt: ISO(0), finishedAt: ISO(30) }) === 0);

// ── durationSeconds — the time_only ranking key (edge cases) ──────────────────
check('durationSeconds: 30 min → 1800s', durationSeconds(ISO(0), ISO(30)) === 1800);
check('durationSeconds: missing start → Infinity (sorts last)', durationSeconds(undefined, ISO(30)) === Infinity);
check('durationSeconds: missing finish → Infinity', durationSeconds(ISO(0), undefined) === Infinity);
check('durationSeconds: finish before start clamps to 0 (no negative)',
  durationSeconds(ISO(30), ISO(0)) === 0);
check('durationSeconds: same instant → 0', durationSeconds(ISO(5), ISO(5)) === 0);

// ── speedBonus ────────────────────────────────────────────────────────────────
check('speedBonus: 5 min under target → +50', speedBonus(60, 55) === 5 * SPEED_BONUS_PER_MINUTE);
check('speedBonus: on target → 0', speedBonus(60, 60) === 0);
check('speedBonus: over target → 0 (never negative)', speedBonus(60, 90) === 0);
check('speedBonus: huge lead is capped', speedBonus(10_000, 1) === SPEED_BONUS_CAP);

// ── Preset B: fixed_points_speed ──────────────────────────────────────────────
{
  // The three terminal records carry stamps summing to the route expected-total
  // (30 + 30 + 0 = 60), exactly as the server would have stamped them at completion.
  const stages = [
    stage('completed', [task('completed', 100, 30), task('skipped', 50, 30)]),
    stage('completed', [task('completed', 75, 0), task('assigned', 999)]), // assigned not counted
  ];
  // No times → just the sum of completed+skipped earnedScore (100+50+75 = 225).
  check('fixed: sums completed + skipped earnedScore, ignores assigned',
    scoreFixedPointsSpeed(stages, undefined, undefined, { stages: [] }) === 225);

  // assigned/unassigned tasks must NOT contribute.
  const withPending = [stage('active', [task('completed', 40), task('unassigned'), task('assigned', 1000)])];
  check('fixed: pending tasks contribute 0',
    scoreFixedPointsSpeed(withPending, undefined, undefined, { stages: [] }) === 40);

  // With a finish faster than expected → speed bonus added on top. Expected total is
  // summed from the stored stamps (60), NOT re-reduced from the template — the template
  // arg is now only the legacy fallback for un-stamped records.
  const game = { stages: [{ tasks: [{ id: 't', estimatedMinutes: 30, expectedDurationMinutes: 30 }] }] } as never;
  const fast = scoreFixedPointsSpeed(stages, ISO(0), ISO(40), game); // expected 60, actual 40 → delta 20 → +200 capped
  check('fixed: finishing under expected adds a speed bonus', fast > 225, `score=${fast}`);
  const slow = scoreFixedPointsSpeed(stages, ISO(0), ISO(120), game); // way over
  check('fixed: finishing over expected adds no bonus', slow === 225, `score=${slow}`);
}
check('taskScoreFixed returns the task pointValue', taskScoreFixed({ pointValue: 42 }) === 42);

// ── sigmoidMultiplier — the smart_weighted kernel ─────────────────────────────
// f(x) = 0.2 + 1.3 / (1 + e^(3(x-1))).  Monotonically DECREASING in x.
{
  const onTarget = sigmoidMultiplier(1);
  check('sigmoid on-target (x=1) ≈ 0.85', Math.abs(onTarget - 0.85) < 1e-9, `f(1)=${onTarget}`);
  check('sigmoid faster (x<1) > on-target', sigmoidMultiplier(0.5) > onTarget);
  check('sigmoid slower (x>1) < on-target', sigmoidMultiplier(2) < onTarget);
  check('sigmoid is strictly decreasing', sigmoidMultiplier(0.2) > sigmoidMultiplier(0.8)
    && sigmoidMultiplier(0.8) > sigmoidMultiplier(1.5));
  check('sigmoid lower asymptote → 0.2 (very slow)', Math.abs(sigmoidMultiplier(100) - 0.2) < 1e-6);
  check('sigmoid upper asymptote → 1.5 (instant)', Math.abs(sigmoidMultiplier(-100) - 1.5) < 1e-6);
}

// ── taskScoreSmart ────────────────────────────────────────────────────────────
{
  // difficulty 10, on target: 100 * 1.0 * 0.85 = 85.
  check('smart task: max difficulty on target = 85', taskScoreSmart(10, 30, 30) === 85);
  // harder task is worth strictly more for the same pace.
  check('smart task: harder difficulty scores more', taskScoreSmart(10, 30, 30) > taskScoreSmart(5, 30, 30));
  // faster than estimate scores more than slower.
  check('smart task: faster beats slower', taskScoreSmart(8, 15, 30) > taskScoreSmart(8, 60, 30));
  // degenerate estimate → 0 (no divide-by-zero blowup).
  check('smart task: zero estimate → 0', taskScoreSmart(8, 30, 0) === 0);
  check('smart task: negative estimate → 0', taskScoreSmart(8, 30, -5) === 0);
}

// ── scoreSmartWeighted — sums earnedScore of completed/skipped ────────────────
{
  const stages = [
    stage('completed', [task('completed', 85), task('skipped', 40)]),
    stage('active', [task('completed', 30), task('assigned', 500)]),
  ];
  check('smart_weighted sums completed+skipped earnedScore', scoreSmartWeighted(stages) === 155);
  check('smart_weighted: empty run → 0', scoreSmartWeighted([]) === 0);
}

// ── No completion bonus (change: fair-final-score) ───────────────────────────
// Run pCADVITcbzIZMEPjVqcV, 2026-10-05: +500 for finishing and ±200 Z-score turned 100/50 on
// the phones into 800/350 on the organizer's board. Both are gone; the only addition is
// finalSpeedBonus below.
check('the completion bonus and the Z-score are gone (no export left to apply them)',
  !('applyCompletionBonus' in presets) && !('COMPLETION_BONUS' in presets) && !('applyZScoreBonus' in presets));

// ── applyPenalties — never drives score negative ──────────────────────────────
check('penalties subtract from score', applyPenalties(1000, 250) === 750);
check('penalties clamp at 0 (never negative)', applyPenalties(100, 999) === 0);
check('zero penalty is a no-op', applyPenalties(500, 0) === 500);

// ── finalSpeedBonus — small, proportional, only with enough finishers ─────────
{
  check("max is 10% of the team's own points", FINAL_SPEED_BONUS_MAX_FRACTION === 0.1);
  check('needs at least 4 finishers', FINAL_SPEED_BONUS_MIN_FINISHERS === 4);
  const four = [10, 20, 30, 40];
  check('fastest of four: +10% of its points', finalSpeedBonus(100, 10, four) === 10);
  check('slowest of four: nothing', finalSpeedBonus(100, 40, four) === 0);
  check('in between: linear (20 of 10..40 → two thirds of 10%)', finalSpeedBonus(300, 20, four) === 20);
  check("proportional to the team's OWN points, never to a fixed number", finalSpeedBonus(50, 10, four) === 5);
  check('the 2026-10-05 run: two finishers → no bonus at all', finalSpeedBonus(100, 0, [0, 2.7]) === 0 && finalSpeedBonus(50, 2.7, [0, 2.7]) === 0);
  check('three finishers → no bonus', finalSpeedBonus(100, 10, [10, 20, 30]) === 0);
  check('everyone equally fast → no bonus', finalSpeedBonus(100, 20, [20, 20, 20, 20]) === 0);
  check('0 points → 0 bonus', finalSpeedBonus(0, 10, four) === 0);
  check('a non-finite duration never poisons the result',
    finalSpeedBonus(100, Infinity, four) === 0 && Number.isFinite(finalSpeedBonus(100, 10, [10, 20, 30, 40, Infinity])));
  check('never negative, never more than 10%',
    [5, 10, 25, 40, 99].every((d) => { const b = finalSpeedBonus(200, d, four); return b >= 0 && b <= 20; }));
}

// ── skipAward — fair substitute score per preset ──────────────────────────────
{
  const t = { pointValue: 120, difficulty: 8, estimatedMinutes: 25 };
  check('skipAward time_only → 0', skipAward('time_only', t) === 0);
  check('skipAward fixed → full pointValue', skipAward('fixed_points_speed', t) === t.pointValue);
  check('skipAward smart → on-target sigmoid score', skipAward('smart_weighted', t) === taskScoreSmart(t.difficulty, t.estimatedMinutes, t.estimatedMinutes));
}

console.log(`\n${failures === 0 ? 'ALL SCORING-PRESET TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
