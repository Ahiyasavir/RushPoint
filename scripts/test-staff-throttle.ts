// Pure-logic test for staff-PIN throttle predicates (change: auth-anticheat, row 40).
// staffSignIn must lock a caller out after too many failed PIN attempts within a
// cooldown window, to stop brute-forcing a 6-digit PIN. No emulator.
//   npx tsx scripts/test-staff-throttle.ts
import {
  shouldLockout, isWithinCooldown, STAFF_LOCKOUT_LIMIT, STAFF_COOLDOWN_MS,
} from '../packages/shared/src/staffThrottle';

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

check('default limit is 5', STAFF_LOCKOUT_LIMIT === 5);
check('default cooldown is 10 min', STAFF_COOLDOWN_MS === 10 * 60 * 1000);

check('0 attempts → not locked', !shouldLockout(0));
check('limit-1 attempts → not locked', !shouldLockout(STAFF_LOCKOUT_LIMIT - 1));
check('limit attempts → locked', shouldLockout(STAFF_LOCKOUT_LIMIT));
check('over limit → locked', shouldLockout(STAFF_LOCKOUT_LIMIT + 1));

const COOL = STAFF_COOLDOWN_MS;
check('just inside cooldown → within', isWithinCooldown(1000, 1000 + COOL - 1, COOL));
check('exactly at cooldown boundary → expired', !isWithinCooldown(1000, 1000 + COOL, COOL));
check('past cooldown → expired', !isWithinCooldown(1000, 1000 + COOL + 1, COOL));

console.log(`\n${failures === 0 ? 'ALL STAFF-THROTTLE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
