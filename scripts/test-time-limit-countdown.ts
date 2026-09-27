// The phone's per team countdown (change: mission-time-limit). The server sends the time LEFT as a
// duration; the phone counts it down from the moment it received it, so a phone clock that is
// hours off cannot freeze or skip it. Pure and total.
//   npx tsx scripts/test-time-limit-countdown.ts
import { countdownLeftMs, formatCountdown, countdownUrgent } from '../apps/play-web/src/lib/timeLimitCountdown';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

check('counts down from when the value arrived', countdownLeftMs(90_000, 1_000, 31_000) === 60_000);
check('never below zero', countdownLeftMs(5_000, 0, 60_000) === 0);
check('a phone clock that jumps BACK does not add time', countdownLeftMs(60_000, 10_000, 5_000) === 60_000);
check('no value: null', countdownLeftMs(null, 0, 0) === null && countdownLeftMs(undefined, 0, 0) === null && countdownLeftMs(NaN, 0, 0) === null);
check('formats as m:ss, rounding up so 0:00 means really zero',
  formatCountdown(61_000) === '1:01' && formatCountdown(59_001) === '1:00' && formatCountdown(0) === '0:00' && formatCountdown(600_000) === '10:00');
check('urgent in the last minute only', countdownUrgent(59_000) && !countdownUrgent(61_000) && countdownUrgent(0));

console.log(`\n${failures === 0 ? 'ALL COUNTDOWN TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
