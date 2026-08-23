// Pure-logic tests for challenge-a-friend (deep-link parse + answer match).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  parseChallengeParam,
  buildChallengeParam,
  matchesTaskAnswer,
} from '@rushpoint/shared';
import type { Task } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}
function eq(a: unknown, b: unknown, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// ── parseChallengeParam ──────────────────────────────────────────────────────
eq(parseChallengeParam('game1:task1'), { gameId: 'game1', taskId: 'task1' }, 'valid pair parses');
eq(parseChallengeParam('  g : t '), { gameId: 'g', taskId: 't' }, 'trims whitespace');
eq(parseChallengeParam(''), null, 'empty → null');
eq(parseChallengeParam(null), null, 'null → null');
eq(parseChallengeParam(undefined), null, 'undefined → null');
eq(parseChallengeParam('nogame'), null, 'no colon → null');
eq(parseChallengeParam(':task'), null, 'missing gameId → null');
eq(parseChallengeParam('game:'), null, 'missing taskId → null');
eq(parseChallengeParam('game:'), null, 'trailing colon only → null');

// round-trip
const param = buildChallengeParam('abc', 'xyz');
eq(param, 'abc:xyz', 'buildChallengeParam joins with colon');
eq(parseChallengeParam(param), { gameId: 'abc', taskId: 'xyz' }, 'round-trips');

// ── matchesTaskAnswer ────────────────────────────────────────────────────────
const quiz = { type: 'quiz', answers: ['Paris', 'paris '] } as unknown as Task;
ok(matchesTaskAnswer(quiz, 'paris'), 'quiz: case-insensitive match');
ok(matchesTaskAnswer(quiz, '  PARIS  '), 'quiz: trims + uppercase match');
ok(!matchesTaskAnswer(quiz, 'London'), 'quiz: wrong answer rejected');
ok(!matchesTaskAnswer({ type: 'quiz' } as unknown as Task, 'x'), 'quiz: no answers → no match');

const numeric = { type: 'numeric', numericAnswer: 42, numericTolerance: 1 } as unknown as Task;
ok(matchesTaskAnswer(numeric, '42'), 'numeric: exact match');
ok(matchesTaskAnswer(numeric, '43'), 'numeric: within tolerance');
ok(!matchesTaskAnswer(numeric, '44'), 'numeric: outside tolerance');
ok(!matchesTaskAnswer(numeric, 'abc'), 'numeric: NaN rejected');
ok(!matchesTaskAnswer({ type: 'numeric' } as unknown as Task, '42'), 'numeric: no answer → no match');

// strict parse (wave-h #5): a trailing-garbage answer must NOT grade correct
ok(!matchesTaskAnswer(numeric, '42abc'), 'numeric: "42abc" rejected (strict parse, not parseFloat)');
ok(!matchesTaskAnswer(numeric, '42 43'), 'numeric: "42 43" rejected (not a single number)');
// but legitimate numeric forms still grade
ok(matchesTaskAnswer(numeric, '  42  '), 'numeric: whitespace-padded still matches');
const negNum = { type: 'numeric', numericAnswer: -3.5, numericTolerance: 0 } as unknown as Task;
ok(matchesTaskAnswer(negNum, '-3.5'), 'numeric: negative decimal still matches');
const zeroNum = { type: 'numeric', numericAnswer: 0, numericTolerance: 0 } as unknown as Task;
ok(!matchesTaskAnswer(zeroNum, ''), 'numeric: empty string does NOT match 0 (Number("") guard)');
ok(matchesTaskAnswer(zeroNum, '0'), 'numeric: "0" matches 0');

console.log(failed === 0
  ? `\n✅ ALL CHALLENGE TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
