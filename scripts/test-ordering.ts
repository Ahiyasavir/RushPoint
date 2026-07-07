// Pure-logic test for the ordering quiz variant (change: quiz-ordering).
// The authored orderItems array IS the answer key, so the shuffle must be
// deterministic per seed, always a real permutation (never the authored order),
// and grading/validation must be normalization-aware.
//   npx tsx scripts/test-ordering.ts
import { seededShuffle, matchesOrderedAnswer, validateOrderItems } from '../packages/shared/src/ordering';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const ITEMS5 = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
const ITEMS3 = ['one', 'two', 'three'];
const sameArr = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const sameMultiset = (a: string[], b: string[]) => sameArr([...a].sort(), [...b].sort());

// ── seededShuffle — deterministic ────────────────────────────────────────────
check('same seed twice → identical permutation',
  sameArr(seededShuffle(ITEMS5, 'team-1:task-1'), seededShuffle(ITEMS5, 'team-1:task-1')));

{
  // Different seeds must actually spread: 10 seeds on a 5-item list should
  // produce more than one distinct permutation.
  const perms = new Set(
    Array.from({ length: 10 }, (_, i) => seededShuffle(ITEMS5, `team-${i}:task-1`).join('|')),
  );
  check('different seeds → different permutations (10 seeds, >1 distinct)', perms.size > 1,
    `distinct=${perms.size}`);
}

check('input array is not mutated by the shuffle', (() => {
  const copy = [...ITEMS5];
  seededShuffle(copy, 'any-seed');
  return sameArr(copy, ITEMS5);
})());

// ── seededShuffle — permutation + identity guard ─────────────────────────────
{
  // Across many seeds, EVERY output must be the same multiset AND never equal
  // the authored order. With ~500 seeds on a 3-item list the identity
  // permutation is drawn dozens of times by chance, so this exercises the
  // rotate-by-one identity guard for real (not just probabilistically).
  let allPermutations = true;
  let neverIdentity3 = true;
  let neverIdentity5 = true;
  for (let i = 0; i < 500; i++) {
    const s3 = seededShuffle(ITEMS3, `seed-${i}`);
    const s5 = seededShuffle(ITEMS5, `seed-${i}`);
    if (!sameMultiset(s3, ITEMS3) || !sameMultiset(s5, ITEMS5)) allPermutations = false;
    if (sameArr(s3, ITEMS3)) neverIdentity3 = false;
    if (sameArr(s5, ITEMS5)) neverIdentity5 = false;
  }
  check('output is always a permutation (same multiset, 500 seeds)', allPermutations);
  check('3-item list NEVER equals the authored order (identity guard)', neverIdentity3);
  check('5-item list NEVER equals the authored order (identity guard)', neverIdentity5);
}

// ── matchesOrderedAnswer ─────────────────────────────────────────────────────
const KEY = ['First stop', 'Second stop', 'Third stop'];
check('exact match → correct', matchesOrderedAnswer(KEY, ['First stop', 'Second stop', 'Third stop']));
check('case-insensitive per item', matchesOrderedAnswer(KEY, ['first STOP', 'SECOND stop', 'third stop']));
check('whitespace-insensitive (trim + collapse internal runs)',
  matchesOrderedAnswer(KEY, ['  First   stop ', 'Second  stop', ' Third stop  ']));
check('wrong order → incorrect', !matchesOrderedAnswer(KEY, ['Second stop', 'First stop', 'Third stop']));
check('too short → incorrect', !matchesOrderedAnswer(KEY, ['First stop', 'Second stop']));
check('too long → incorrect',
  !matchesOrderedAnswer(KEY, ['First stop', 'Second stop', 'Third stop', 'Third stop']));
check('non-array (string) → incorrect', !matchesOrderedAnswer(KEY, 'First stop'));
check('non-array (null) → incorrect', !matchesOrderedAnswer(KEY, null));
check('non-array (undefined) → incorrect', !matchesOrderedAnswer(KEY, undefined));
check('array with a non-string entry → incorrect',
  !matchesOrderedAnswer(KEY, ['First stop', 42, 'Third stop']));

// ── validateOrderItems ───────────────────────────────────────────────────────
check('absent → null (not an ordering task)', validateOrderItems(undefined) === null);
check('non-array → null (not an ordering task)', validateOrderItems('nope') === null);
check('2 items → rejected', validateOrderItems(['a', 'b']) !== null);
check('3 items → ok', validateOrderItems(['a', 'b', 'c']) === null);
check('10 items → ok',
  validateOrderItems(Array.from({ length: 10 }, (_, i) => `item ${i}`)) === null);
check('11 items → rejected',
  validateOrderItems(Array.from({ length: 11 }, (_, i) => `item ${i}`)) !== null);
check('empty item → rejected', validateOrderItems(['a', '   ', 'c']) !== null);
check('non-string item → rejected', validateOrderItems(['a', 7, 'c'] as unknown[]) !== null);
check('normalized duplicate → rejected (grading would be ambiguous)',
  validateOrderItems(['Paris', ' paris  ', 'Rome']) !== null);
check('near-duplicate differing only in inner whitespace → rejected',
  validateOrderItems(['Tel  Aviv', 'Tel Aviv', 'Haifa']) !== null);

console.log(`\n${failures === 0 ? 'ALL ORDERING TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
