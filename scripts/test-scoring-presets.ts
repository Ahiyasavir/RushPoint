// Pure-logic tests for the THREE scoring presets and the shared final-score
// formula (packages/shared/src/scoringPresets.ts). Until now only computeTimeBonus
// (a helper) was covered — the actual per-preset run scorers, the Z-Score
// normalization, the completion bonus and the penalty subtraction had ZERO tests,
// yet every point shown on every leaderboard flows through them. No emulator.
//   npx tsx scripts/test-scoring-presets.ts
import {
  scoreTimeOnly,
  durationSeconds,
  scoreFixedPointsSpeed,
  taskScoreFixed,
  sigmoidMultiplier,
  taskScoreSmart,
  scoreSmartWeighted,
  completionBonus,
  allStagesCompleted,
  applyPenalties,
  skipAward,
  teamExpectedRouteMinutes,
  COMPLETION_BONUS_PCT,
} from '../packages/shared/src/scoringPresets';
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

// ── Preset B: fixed_points_speed (scoring-v2: points only; speed is a ranking-time %) ──
{
  const stages = [
    stage('completed', [task('completed', 100, 30), task('skipped', 50, 30)]),
    stage('completed', [task('completed', 75, 0), task('assigned', 999)]), // assigned not counted
  ];
  check('fixed: sums completed + skipped earnedScore, ignores assigned', scoreFixedPointsSpeed(stages) === 225);
  const withPending = [stage('active', [task('completed', 40), task('unassigned'), task('assigned', 1000)])];
  check('fixed: pending tasks contribute 0', scoreFixedPointsSpeed(withPending) === 40);
  // The expected route is summed from the stored stamps of COMPLETED records only (30 + 0); the
  // skipped record's 30 minutes cost the team nothing and no longer count.
  const game = { stages: [{ tasks: [{ id: 't', estimatedMinutes: 30, expectedDurationMinutes: 30 }] }] } as never;
  check('fixed: expected route counts completed records only', teamExpectedRouteMinutes(stages, game) === 30,
    String(teamExpectedRouteMinutes(stages, game)));
}
check('taskScoreFixed returns the task pointValue', taskScoreFixed({ pointValue: 42 }) === 42);

// ── sigmoidMultiplier — the smart_weighted kernel (scoring-v2) ────────────────
// f(x) = 0.7 + 0.6 / (1 + e^(2.5(x-1))).  Monotonically DECREASING in x; exactly 1.0 on target.
{
  const onTarget = sigmoidMultiplier(1);
  check('sigmoid on-target (x=1) = 1.0', Math.abs(onTarget - 1) < 1e-9, `f(1)=${onTarget}`);
  check('sigmoid faster (x<1) > on-target', sigmoidMultiplier(0.5) > onTarget);
  check('sigmoid slower (x>1) < on-target', sigmoidMultiplier(2) < onTarget);
  check('sigmoid is strictly decreasing', sigmoidMultiplier(0.2) > sigmoidMultiplier(0.8)
    && sigmoidMultiplier(0.8) > sigmoidMultiplier(1.5));
  check('sigmoid lower asymptote → 0.7 (very slow)', Math.abs(sigmoidMultiplier(100) - 0.7) < 1e-6);
  check('sigmoid upper asymptote → 1.3 (instant)', Math.abs(sigmoidMultiplier(-100) - 1.3) < 1e-6);
}

// ── taskScoreSmart ────────────────────────────────────────────────────────────
{
  // difficulty 10, on target: 100 * 1.0 * 1.0 = 100.
  check('smart task: max difficulty on target = 100', taskScoreSmart(10, 30, 30) === 100);
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

// ── completion bonus (scoring-v2: a percentage of the earned points, not a flat +500) ──
{
  const allDone = [stage('completed', []), stage('completed', [])];
  const partial = [stage('completed', []), stage('active', [])];
  check('completion: all stages completed', allStagesCompleted(allDone));
  check('completion: an unfinished stage is not complete', !allStagesCompleted(partial));
  check('completion: no stages is not complete', !allStagesCompleted([]));
  check('completion bonus = 10% of points', completionBonus(1000, true) === 1000 * COMPLETION_BONUS_PCT);
  check('completion bonus: not done → 0', completionBonus(1000, false) === 0);
}

// ── applyPenalties — never drives score negative ──────────────────────────────
check('penalties subtract from score', applyPenalties(1000, 250) === 750);
check('penalties clamp at 0 (never negative)', applyPenalties(100, 999) === 0);
check('zero penalty is a no-op', applyPenalties(500, 0) === 500);

// ── skipAward — fair substitute score per preset ──────────────────────────────
{
  const t = { pointValue: 120, difficulty: 8, estimatedMinutes: 25 };
  check('skipAward time_only → 0', skipAward('time_only', t) === 0);
  check('skipAward fixed → full pointValue', skipAward('fixed_points_speed', t) === t.pointValue);
  check('skipAward smart → on-target score', skipAward('smart_weighted', t) === taskScoreSmart(t.difficulty, t.estimatedMinutes, t.estimatedMinutes));
}

console.log(`\n${failures === 0 ? 'ALL SCORING-PRESET TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
