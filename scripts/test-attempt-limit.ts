// Pure-logic test for the answer attempt limit (change: auth-anticheat, row 42).
//   npx tsx scripts/test-attempt-limit.ts
import { attemptLimitReached } from '../packages/shared/src/answerAttempts';

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

check('0/3 → not blocked', !attemptLimitReached(0, 3));
check('2/3 → not blocked', !attemptLimitReached(2, 3));
check('3/3 → blocked', attemptLimitReached(3, 3));
check('4/3 → blocked', attemptLimitReached(4, 3));
check('undefined limit → never blocked', !attemptLimitReached(999, undefined));
check('zero limit → never blocked (unlimited)', !attemptLimitReached(999, 0));

console.log(`\n${failures === 0 ? 'ALL ATTEMPT-LIMIT TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
