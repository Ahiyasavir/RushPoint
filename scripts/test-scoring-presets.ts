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
  applyCompletionBonus,
  applyPenalties,
  applyZScoreBonus,
  skipAward,
  COMPLETION_BONUS,
  SPEED_BONUS_CAP,
  SPEED_BONUS_PER_MINUTE,
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

// ── applyCompletionBonus ──────────────────────────────────────────────────────
{
  const allDone = [stage('completed', []), stage('completed', [])];
  const partial = [stage('completed', []), stage('active', [])];
  check('completion bonus applied only when ALL stages completed',
    applyCompletionBonus(1000, allDone) === 1000 + COMPLETION_BONUS);
  check('completion bonus NOT applied with an unfinished stage',
    applyCompletionBonus(1000, partial) === 1000);
  check('completion bonus: empty stage list counts as all-done (vacuous truth)',
    applyCompletionBonus(1000, []) === 1000 + COMPLETION_BONUS);
}

// ── applyPenalties — never drives score negative ──────────────────────────────
check('penalties subtract from score', applyPenalties(1000, 250) === 750);
check('penalties clamp at 0 (never negative)', applyPenalties(100, 999) === 0);
check('zero penalty is a no-op', applyPenalties(500, 0) === 500);

// ── applyZScoreBonus — final time normalization ───────────────────────────────
{
  // Fewer than 2 finishers → no normalization (can't compute a distribution).
  check('z-score: <2 finishers → score unchanged', applyZScoreBonus(1000, 30, [30]) === 1000);

  // All identical durations → sigma 0 → no bonus.
  check('z-score: zero variance → score unchanged', applyZScoreBonus(1000, 30, [30, 30, 30]) === 1000);

  // Faster than the mean → bonus (z negative → -z positive → +points).
  const durations = [20, 40, 60]; // mean 40
  const faster = applyZScoreBonus(1000, 20, durations);
  const slower = applyZScoreBonus(1000, 60, durations);
  check('z-score: faster-than-mean team gets a bonus', faster > 1000, `faster=${faster}`);
  check('z-score: slower-than-mean team gets a malus', slower < 1000, `slower=${slower}`);
  check('z-score: exactly-mean team unchanged', applyZScoreBonus(1000, 40, durations) === 1000);
  check('z-score: bonus is symmetric around the mean',
    (faster - 1000) === (1000 - slower), `+${faster - 1000} / -${1000 - slower}`);
  check('z-score: never drives score below 0', applyZScoreBonus(10, 999, [1, 2, 999]) >= 0);
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
