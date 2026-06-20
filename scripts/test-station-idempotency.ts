// Lightweight unit test for smart-station submit idempotency (no double-complete /
// double-streak on simultaneous taps). No test runner is configured for functions,
// so this is a plain tsx assertion script (matches scripts/test-tiebreaker.ts).
// Run: npx tsx scripts/test-station-idempotency.ts
import {
  normalizeStationCode,
  isDuplicateStationCode,
  recordStationCode,
} from '../functions/src/scoring/stationVerification';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const TASK = 'task-42';

// ── 1. A fresh code is not a duplicate ────────────────────────────────────────
{
  check('unseen code is not a duplicate', !isDuplicateStationCode(undefined, TASK, 'ALPHA'));
  check('unseen code on a known task is not a duplicate',
    !isDuplicateStationCode({ [TASK]: ['BETA'.toLowerCase()] }, TASK, 'ALPHA'));
}

// ── 2. Rapid double-tap of the SAME code counts once ──────────────────────────
{
  // First tap records the code; the second (simultaneous) tap sees it on retry.
  const afterFirst = recordStationCode(undefined, TASK, 'ALPHA');
  check('same code is a duplicate after the first record',
    isDuplicateStationCode(afterFirst, TASK, 'ALPHA'));
  check('case/whitespace-insensitive duplicate match',
    isDuplicateStationCode(afterFirst, TASK, '  alpha '));
}

// ── 3. Recording is idempotent — no +2 entry on double-tap ────────────────────
{
  const once  = recordStationCode(undefined, TASK, 'ALPHA');
  const twice = recordStationCode(once, TASK, ' alpha ');
  check('re-recording the same code does not grow the list',
    twice[TASK].length === 1, `len=${twice[TASK].length}`);
  check('recorded key is normalized', twice[TASK][0] === normalizeStationCode('ALPHA'));
}

// ── 4. A DIFFERENT valid code is still accepted (both count) ───────────────────
{
  const afterAlpha = recordStationCode(undefined, TASK, 'ALPHA');
  check('a different code is NOT treated as a duplicate',
    !isDuplicateStationCode(afterAlpha, TASK, 'OMEGA'));
  const afterBoth = recordStationCode(afterAlpha, TASK, 'OMEGA');
  check('different codes accumulate independently',
    afterBoth[TASK].length === 2, `len=${afterBoth[TASK].length}`);
}

// ── 5. Verifications are isolated per task ─────────────────────────────────────
{
  const v = recordStationCode(undefined, TASK, 'ALPHA');
  check('a code accepted on one task is not a duplicate on another',
    !isDuplicateStationCode(v, 'task-99', 'ALPHA'));
}

console.log(`\n${failures === 0 ? 'ALL STATION-IDEMPOTENCY TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
