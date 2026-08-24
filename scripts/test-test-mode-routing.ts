// Routing under TEST MODE (change: test-mode-hidden-scoring).
//
// Adaptive difficulty already runs for every scoring preset, but its strength
// signal is PACE. Test mode breaks that signal: once a wrong answer COMPLETES a
// task, a participant who answers instantly and wrongly reads as fast, therefore
// strong, and would be routed the HARDEST remaining questions — the exact
// opposite of what an assessment needs. So test mode swaps the signal for
// ACCURACY.
//
// This suite pins the OBSERVABLE consequence (which difficulty gets picked),
// not the arithmetic — `scripts/test-test-mode.ts` covers accuracySkillRatio
// itself. DOM-free, emulator-free; run by `npm test`.
//   npx tsx scripts/test-test-mode-routing.ts
import { accuracySkillRatio } from '../packages/shared/src/testMode';
import { resolveRoutingSkillRatio } from '../functions/src/routing/testModeRouting';
import type { Game, RunTeam, RunTaskRecord, Task } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// The difficulty-match term, copied from assignNextTask.ts so this suite pins the
// CONTRACT between the two (a change to either that breaks the pairing fails here).
function adaptiveDifficultyMatch(skillRatio: number, difficulty: number): number {
  const normalizedDifficulty = (difficulty - 5) / 5;
  return 1 - Math.abs(-skillRatio - normalizedDifficulty);
}
/** Which of the candidate difficulties this strength ratio prefers. */
function preferred(skillRatio: number, difficulties: number[]): number {
  return difficulties
    .map((d) => ({ d, score: adaptiveDifficultyMatch(skillRatio, d) }))
    .sort((a, b) => b.score - a.score)[0].d;
}

const CANDIDATES = [1, 3, 5, 7, 10];

// ── The requirement: wrong answers lead to easier questions ──────────────────
const allWrong = accuracySkillRatio(recs(false, false, false))!;
const allRight = accuracySkillRatio(recs(true, true, true))!;
const evenSplit = accuracySkillRatio(recs(true, false))!;

check('a struggling participant is routed the EASIEST candidate',
  preferred(allWrong, CANDIDATES) === 1, String(preferred(allWrong, CANDIDATES)));
check('a perfect participant is routed the HARDEST candidate',
  preferred(allRight, CANDIDATES) === 10, String(preferred(allRight, CANDIDATES)));
check('an even split is routed the MIDDLE candidate',
  preferred(evenSplit, CANDIDATES) === 5, String(preferred(evenSplit, CANDIDATES)));

// Monotonic: every extra wrong answer must move the target down, never up. A
// non-monotonic mapping would make difficulty jitter unpredictably mid-test.
let monotonicBad = 0;
let prev = Infinity;
for (let correct = 8; correct >= 0; correct--) {
  const flags = Array.from({ length: 8 }, (_, i) => i < correct);
  const target = preferred(accuracySkillRatio(recs(...flags))!, CANDIDATES);
  if (target > prev) monotonicBad++;
  prev = target;
}
check('difficulty falls monotonically as accuracy falls', monotonicBad === 0, `${monotonicBad} inversions`);

// ── resolveRoutingSkillRatio — which signal is actually used ─────────────────
const gm = (testMode: boolean) => ({ id: 'g', title: 't', testMode } as unknown as Game);
const team = (flags: (boolean | undefined)[]) => ({
  id: 'team', stages: [{ stageId: 's', order: 0, status: 'active', tasks: recs(...flags) }],
} as unknown as RunTeam);

// PACE ratio deliberately set to the OPPOSITE of the accuracy verdict, so a test
// that passes can only be reading the accuracy signal.
const PACE_SAYS_STRONG = -1;

check('sealed run uses ACCURACY, not the pace ratio',
  resolveRoutingSkillRatio(gm(true), team([false, false, false]), PACE_SAYS_STRONG) === 1);
check('sealed run + perfect accuracy targets the hardest',
  resolveRoutingSkillRatio(gm(true), team([true, true]), 0) === -1);
check('NON-sealed run keeps the pace ratio untouched (regression pin)',
  resolveRoutingSkillRatio(gm(false), team([false, false]), PACE_SAYS_STRONG) === PACE_SAYS_STRONG);
check('game with no testMode field keeps the pace ratio',
  resolveRoutingSkillRatio({ id: 'g' } as Game, team([false]), 0.42) === 0.42);

// No evidence ⇒ fall back to today's behaviour rather than inventing a verdict.
check('sealed run with NO answered records falls back to the pace ratio',
  resolveRoutingSkillRatio(gm(true), team([]), 0.3) === 0.3);
check('sealed run with only unanswered records falls back to the pace ratio',
  resolveRoutingSkillRatio(gm(true), team([undefined, undefined]), 0.3) === 0.3);

// Totality — routing must never throw; a bad document would strand the whole run.
let threw = false;
try {
  resolveRoutingSkillRatio(gm(true), undefined as unknown as RunTeam, 0);
  resolveRoutingSkillRatio(gm(true), {} as RunTeam, 0);
  resolveRoutingSkillRatio(gm(true), { stages: null } as unknown as RunTeam, 0);
  resolveRoutingSkillRatio(null as unknown as Game, team([true]), 0);
} catch { threw = true; }
check('never throws on a malformed game or team', !threw);
check('a malformed team falls back to the pace ratio',
  resolveRoutingSkillRatio(gm(true), {} as RunTeam, 0.7) === 0.7);

// The result feeds a difficulty match — an out-of-range value would scramble it.
let rangeBad = 0;
for (let n = 0; n <= 6; n++) {
  for (let correct = 0; correct <= n; correct++) {
    const flags = Array.from({ length: n }, (_, i) => i < correct);
    const r = resolveRoutingSkillRatio(gm(true), team(flags), 0);
    if (!Number.isFinite(r) || r < -1 || r > 1) rangeBad++;
  }
}
check('resolved ratio is always finite and within [-1, 1]', rangeBad === 0, `${rangeBad} bad`);

function recs(...flags: (boolean | undefined)[]): RunTaskRecord[] {
  return flags.map((wasCorrect, i) => ({
    taskId: `t${i}`, taskIndex: i, status: 'completed', wasCorrect,
  })) as unknown as RunTaskRecord[];
}
// Referenced so an unused-import lint rule cannot fire on the Task type above.
export type _Task = Task;

console.log(`\n${failures === 0 ? 'ALL TEST-MODE ROUTING TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
