// Pure-logic test for the wrong-answer cost model (change: wrong-answer-cost).
//   npx tsx scripts/test-wrong-answer-penalty.ts
//
// Before this change a wrong answer cost NOTHING, so brute-forcing a 4 choice
// quiz was strictly optimal play. The cost is now a creator-chosen strictness
// level with free attempts, a rising charge, a hard cap, and a retry cooldown
// that is the ENTIRE penalty under time_only (a preset that has no points).
//
// These are the boundaries the server and both apps all read through the same
// shared table, so the charge, the display and the creator preview cannot drift.
import {
  WRONG_ANSWER_LEVELS,
  DEFAULT_WRONG_ANSWER_LEVEL,
  resolveWrongAnswerLevel,
  wrongAnswerCost,
  cooldownRemainingSeconds,
  hashAnswerForReplay,
  answerCostDisplay,
} from '../packages/shared/src/wrongAnswerPenalty';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond || !detail ? '' : `  (${detail})`}`);
  if (!cond) failures++;
}

// ── Resolution: task > game > off ────────────────────────────────────────────
check('no game and no task → off (every pre-existing game)',
  resolveWrongAnswerLevel(undefined, undefined) === 'off');
check('game with no scoringOptions → off',
  resolveWrongAnswerLevel({}, {}) === 'off');
check('game level applies when the task says nothing',
  resolveWrongAnswerLevel({ scoringOptions: { wrongAnswerPenalty: 'gentle' } }, {}) === 'gentle');
check('task level overrides the game level',
  resolveWrongAnswerLevel(
    { scoringOptions: { wrongAnswerPenalty: 'gentle' } },
    { wrongAnswerPenalty: 'strict' },
  ) === 'strict');
check('a task may be softer than its game too',
  resolveWrongAnswerLevel(
    { scoringOptions: { wrongAnswerPenalty: 'strict' } },
    { wrongAnswerPenalty: 'off' },
  ) === 'off');
check('a garbage level falls back to off (never a surprise charge)',
  resolveWrongAnswerLevel(
    { scoringOptions: { wrongAnswerPenalty: 'BRUTAL' as never } },
    {},
  ) === 'off');
check('new games default to standard', DEFAULT_WRONG_ANSWER_LEVEL === 'standard');

// ── The standard curve: 1 free, then 10 / 20 / 30, capped at 60 ──────────────
// cooldown: 15 / 30 / 45 … rising to a 90 second ceiling.
{
  const seq: { points: number; cooldownSeconds: number }[] = [];
  let charged = 0;
  for (let attempt = 1; attempt <= 8; attempt++) {
    const c = wrongAnswerCost('standard', 'fixed_points_speed', attempt, charged);
    charged += c.points;
    seq.push({ points: c.points, cooldownSeconds: c.cooldownSeconds });
  }
  const pts = seq.map((s) => s.points);
  const cds = seq.map((s) => s.cooldownSeconds);
  check('standard: the first wrong answer is free (a typo is not a crime)',
    pts[0] === 0 && cds[0] === 0, JSON.stringify(seq[0]));
  check('standard: point escalation is 0,10,20,30 then capped 0,0,0,0',
    JSON.stringify(pts) === JSON.stringify([0, 10, 20, 30, 0, 0, 0, 0]), JSON.stringify(pts));
  check('standard: cumulative charge stops at the 60 point cap', charged === 60, String(charged));
  check('standard: cooldown escalates 0,15,30,45,60,75,90 and holds at 90',
    JSON.stringify(cds) === JSON.stringify([0, 15, 30, 45, 60, 75, 90, 90]), JSON.stringify(cds));
  check('standard: guessing is never free again once the point cap is spent',
    cds[7] === 90 && pts[7] === 0);
}

// ── gentle: 2 free, 5 point steps, 20 cap, 30 second ceiling ─────────────────
{
  let charged = 0;
  const pts: number[] = [];
  const cds: number[] = [];
  for (let attempt = 1; attempt <= 6; attempt++) {
    const c = wrongAnswerCost('gentle', 'smart_weighted', attempt, charged);
    charged += c.points;
    pts.push(c.points);
    cds.push(c.cooldownSeconds);
  }
  check('gentle: two free attempts', pts[0] === 0 && pts[1] === 0 && cds[0] === 0 && cds[1] === 0);
  check('gentle: 5,10 then a partial 5 to land exactly on the 20 cap',
    JSON.stringify(pts) === JSON.stringify([0, 0, 5, 10, 5, 0]), JSON.stringify(pts));
  check('gentle: cumulative charge is exactly the 20 point cap', charged === 20, String(charged));
  check('gentle: cooldown holds at the 30 second ceiling',
    JSON.stringify(cds) === JSON.stringify([0, 0, 10, 20, 30, 30]), JSON.stringify(cds));
}

// ── strict: no free attempt at all ───────────────────────────────────────────
{
  const c1 = wrongAnswerCost('strict', 'fixed_points_speed', 1, 0);
  const c2 = wrongAnswerCost('strict', 'fixed_points_speed', 2, 15);
  const c3 = wrongAnswerCost('strict', 'fixed_points_speed', 3, 45);
  check('strict: the very first wrong answer is charged',
    c1.points === 15 && c1.cooldownSeconds === 30, JSON.stringify(c1));
  check('strict: escalates 15,30,45', c2.points === 30 && c3.points === 45,
    JSON.stringify([c2.points, c3.points]));
  check('strict: cooldown escalates 30,60,90 under a 180 second ceiling',
    c2.cooldownSeconds === 60 && c3.cooldownSeconds === 90);
  check('strict: cooldown ceiling holds',
    wrongAnswerCost('strict', 'fixed_points_speed', 20, 150).cooldownSeconds === 180);
}

// ── off: today's behaviour, exactly ───────────────────────────────────────────
for (let attempt = 1; attempt <= 10; attempt++) {
  const c = wrongAnswerCost('off', 'fixed_points_speed', attempt, 0);
  check(`off: attempt ${attempt} costs nothing at all`,
    c.points === 0 && c.cooldownSeconds === 0, JSON.stringify(c));
}

// ── Preset awareness: time_only has no points, so it charges time ────────────
{
  const t = wrongAnswerCost('standard', 'time_only', 2, 0);
  const f = wrongAnswerCost('standard', 'fixed_points_speed', 2, 0);
  const s = wrongAnswerCost('standard', 'smart_weighted', 2, 0);
  check('time_only: no point charge (points do not exist in that preset)', t.points === 0,
    String(t.points));
  check('time_only: the cooldown is the whole penalty and matches the other presets',
    t.cooldownSeconds === 15 && t.cooldownSeconds === f.cooldownSeconds, JSON.stringify(t));
  check('fixed_points_speed charges points', f.points === 10, String(f.points));
  check('smart_weighted charges points', s.points === 10, String(s.points));
  check('time_only never charges at any attempt index',
    [1, 2, 3, 4, 5, 9].every((a) => wrongAnswerCost('strict', 'time_only', a, 0).points === 0));
}

// ── Garbage input can never produce a charge, a NaN or a negative ────────────
for (const bad of [NaN, Infinity, -Infinity, 0, -3, 1.5]) {
  const c = wrongAnswerCost('standard', 'fixed_points_speed', bad, 0);
  check(`attemptIndex ${bad} → finite, non-negative, never a phantom charge`,
    Number.isFinite(c.points) && c.points >= 0 &&
    Number.isFinite(c.cooldownSeconds) && c.cooldownSeconds >= 0,
    JSON.stringify(c));
}
for (const bad of [NaN, Infinity, -Infinity, -50]) {
  const c = wrongAnswerCost('standard', 'fixed_points_speed', 3, bad);
  check(`alreadyCharged ${bad} → finite charge inside the cap`,
    Number.isFinite(c.points) && c.points >= 0 && c.points <= WRONG_ANSWER_LEVELS.standard.maxPoints,
    JSON.stringify(c));
}

// ── Cooldown remainder ───────────────────────────────────────────────────────
const NOW = 1_800_000_000_000;
check('no cooldown recorded → 0 remaining', cooldownRemainingSeconds(undefined, NOW) === 0);
check('cooldown of 0 → 0 remaining', cooldownRemainingSeconds(0, NOW) === 0);
check('expired cooldown → 0 remaining (never negative)',
  cooldownRemainingSeconds(NOW - 60_000, NOW) === 0);
check('exactly at expiry → 0 remaining (the boundary opens the gate)',
  cooldownRemainingSeconds(NOW, NOW) === 0);
check('30 seconds left → 30', cooldownRemainingSeconds(NOW + 30_000, NOW) === 30);
check('a partial second rounds UP so the UI never shows 0 while still locked',
  cooldownRemainingSeconds(NOW + 100, NOW) === 1);
check('a non-finite cooldown is treated as no cooldown (fail open, never a lockout)',
  cooldownRemainingSeconds(NaN, NOW) === 0 && cooldownRemainingSeconds(Infinity, NOW) === 0);

// ── Replay hash: the duplicate-submission guard ──────────────────────────────
check('same answer → same hash', hashAnswerForReplay('42') === hashAnswerForReplay('42'));
check('case and surrounding whitespace do not make a new attempt',
  hashAnswerForReplay('  Jerusalem ') === hashAnswerForReplay('jerusalem'));
check('a different answer → a different hash',
  hashAnswerForReplay('42') !== hashAnswerForReplay('43'));
check('an ordering arrangement hashes stably',
  hashAnswerForReplay(['b', 'a', 'c']) === hashAnswerForReplay(['b', 'a', 'c']));
check('a different arrangement is a different attempt',
  hashAnswerForReplay(['b', 'a', 'c']) !== hashAnswerForReplay(['a', 'b', 'c']));
check('an arrangement never collides with the joined string form',
  hashAnswerForReplay(['a', 'b']) !== hashAnswerForReplay('ab'));
check('the hash is a short opaque token, never the player text',
  !hashAnswerForReplay('Jerusalem').includes('erusalem'));

// The display object now takes the SERVER clock and emits a remaining DURATION
// (change: retry-lockout-clock-skew); a fixed instant keeps these deterministic.
const NOW_MS = 1_800_000_000_000;

// ── The participant-facing display object ────────────────────────────────────
{
  const fresh = answerCostDisplay('standard', 'fixed_points_speed', 0, 0, 0, NOW_MS);
  check('display: a fresh standard task announces one free attempt',
    fresh.freeAttemptsLeft === 1 && fresh.nextPoints === 0 && fresh.nextCooldownSeconds === 0,
    JSON.stringify(fresh));
  const afterOne = answerCostDisplay('standard', 'fixed_points_speed', 1, 0, 0, NOW_MS);
  check('display: after the free attempt the next wrong answer is priced',
    afterOne.freeAttemptsLeft === 0 && afterOne.nextPoints === 10 &&
    afterOne.nextCooldownSeconds === 15, JSON.stringify(afterOne));
  const capped = answerCostDisplay('standard', 'fixed_points_speed', 6, 60, 0, NOW_MS);
  check('display: past the cap the next answer costs 0 points but still time',
    capped.nextPoints === 0 && capped.nextCooldownSeconds > 0, JSON.stringify(capped));
  const timed = answerCostDisplay('standard', 'time_only', 1, 0, 0, NOW_MS);
  check('display: time_only advertises no point cost',
    timed.nextPoints === 0 && timed.nextCooldownSeconds === 15, JSON.stringify(timed));
  check('display: level is carried so the UI can stay silent when off',
    answerCostDisplay('off', 'time_only', 3, 0, 0, NOW_MS).level === 'off');
  check('display: charged so far is reported back',
    answerCostDisplay('standard', 'fixed_points_speed', 3, 30, 0, NOW_MS).charged === 30);
  // retry-lockout-clock-skew: the display carries a remaining DURATION computed
  // against the SERVER clock, so a device with a wrong clock still counts down
  // the right number of seconds. A live lockout 40 s out reports 40 000 ms.
  const cooling = answerCostDisplay(
    'standard', 'fixed_points_speed', 2, 10,
    { charged: 10, lastHash: 'h', cooldownUntil: NOW_MS + 40_000, lastFailureAt: NOW_MS - 5_000, lockoutMs: 45_000 },
    NOW_MS,
  );
  check('display: a live lockout is reported as a remaining duration',
    cooling.cooldownRemainingMs === 40_000, JSON.stringify(cooling));
  check('display: the deprecated absolute expiry is still carried for older bundles',
    cooling.cooldownUntil === NOW_MS + 40_000, String(cooling.cooldownUntil));
  check('display: an expired lockout reports 0 ms, never a negative remainder',
    answerCostDisplay('standard', 'fixed_points_speed', 2, 10,
      { charged: 10, lastHash: 'h', cooldownUntil: NOW_MS - 1 }, NOW_MS).cooldownRemainingMs === 0);
}

console.log(`\n${failures === 0 ? 'ALL WRONG-ANSWER-PENALTY TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
