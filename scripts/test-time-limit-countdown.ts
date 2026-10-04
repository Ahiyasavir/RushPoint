// The phone's per team countdown (change: mission-time-limit). The server sends the time LEFT as a
// duration; the phone counts it down from the moment it received it, so a phone clock that is
// hours off cannot freeze or skip it. Pure and total.
//   npx tsx scripts/test-time-limit-countdown.ts
import {
  countdownLeftMs, formatCountdown, countdownUrgent,
  countdownThresholds, countdownPhase, countdownFraction, countdownMilestone,
} from '../apps/play-web/src/lib/timeLimitCountdown';

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

// ── The fuse (change: mission-countdown-fuse) ────────────────────────────────
// Ahiya, 2026-10-02: the timer should be live and cool and push players into action. The phases and
// the moments it marks are pure here so the component only renders them.
const MIN = 60_000;
const j = (x: unknown) => JSON.stringify(x);
check('thresholds for 4 minutes: half, 60 s, 10 s', j(countdownThresholds(4 * MIN)) === j({ hurry: 2 * MIN, critical: MIN, final: 10_000 }));
check('a 1 minute sprint does not start red: critical and final shrink to a quarter',
  j(countdownThresholds(MIN)) === j({ hurry: 30_000, critical: 15_000, final: 10_000 }));
check('a 20 second mission: final is a quarter (5 s)', countdownThresholds(20_000).final === 5_000);
check('unknown total: 2 min / 60 s / 10 s', j(countdownThresholds(null)) === j({ hurry: 2 * MIN, critical: MIN, final: 10_000 })
  && j(countdownThresholds(Number.NaN)) === j(countdownThresholds(null)) && j(countdownThresholds(-5)) === j(countdownThresholds(null)));

check('phase: calm with most of the time left', countdownPhase(3 * MIN, 4 * MIN) === 'calm');
check('phase: hurry from half time', countdownPhase(2 * MIN, 4 * MIN) === 'hurry' && countdownPhase(90_000, 4 * MIN) === 'hurry');
check('phase: critical in the last minute', countdownPhase(MIN, 4 * MIN) === 'critical' && countdownPhase(11_000, 4 * MIN) === 'critical');
check('phase: final in the last 10 seconds', countdownPhase(10_000, 4 * MIN) === 'final' && countdownPhase(1, 4 * MIN) === 'final');
check('phase: up at zero', countdownPhase(0, 4 * MIN) === 'up' && countdownPhase(-5, 4 * MIN) === 'up');
check('phase: junk time left reads as calm, never throws', countdownPhase(Number.NaN, 4 * MIN) === 'calm');

check('fraction of time LEFT', countdownFraction(MIN, 4 * MIN) === 0.25 && countdownFraction(4 * MIN, 4 * MIN) === 1);
check('fraction is clamped (a hold can never show more than full)', countdownFraction(9 * MIN, 4 * MIN) === 1 && countdownFraction(-1, 4 * MIN) === 0);
check('no total, no fraction', countdownFraction(MIN, null) === null && countdownFraction(MIN, 0) === null);

check('milestone: crossing half time', countdownMilestone(121_000, 119_000, 4 * MIN) === 'hurry');
check('milestone: nothing between lines', countdownMilestone(200_000, 199_000, 4 * MIN) === null);
check('milestone: entering the last minute', countdownMilestone(61_000, 60_000, 4 * MIN) === 'critical');
check('milestone: entering the last 10 seconds', countdownMilestone(10_500, 9_500, 4 * MIN) === 'final');
check('milestone: time up once', countdownMilestone(500, 0, 4 * MIN) === 'up' && countdownMilestone(0, 0, 4 * MIN) === null);
check('milestone: a jump across two lines reports the deeper one', countdownMilestone(3 * MIN, 30_000, 4 * MIN) === 'critical');
check('milestone: time going UP (a re-anchor after a hold) never fires', countdownMilestone(30_000, 3 * MIN, 4 * MIN) === null);
check('milestone: no previous value never fires (first paint)', countdownMilestone(null, 30_000, 4 * MIN) === null);

console.log(`\n${failures === 0 ? 'ALL COUNTDOWN TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
