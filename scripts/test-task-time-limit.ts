// Mission time limits (change: mission-time-limit). Two kinds, both owner-requested (2026-09-27):
//  1. A countdown PER TEAM: `timeLimitMinutes` from the moment THAT team got the mission. When it
//     runs out the team moves on with no points.
//  2. A clock WINDOW for everyone: the existing `releaseAt` / `expiresAfterMinutes`, plus a new
//     absolute close `expiresAt`, so "only between 10:00 and 11:30" can be authored.
// The phone is only ever sent a REMAINING duration (never an instant to count against its own
// clock), so these helpers compute the remaining time on the server's clock.
//   npx tsx scripts/test-task-time-limit.ts
import {
  timeLimitRemainingMs, isTimeLimitUp, timeLimitProblem, TIME_LIMIT_GRACE_MS, TIME_LIMIT_MAX_MINUTES,
} from '../packages/shared/src/taskTimeLimit';
import { isExpired, expiryInstantMs, hasScheduleGate, validateAvailabilityWindow } from '../packages/shared/src/schedule';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const start = '2026-09-27T10:00:00.000Z';
const t0 = Date.parse(start);
const task = { timeLimitMinutes: 5 };

// ── Per team countdown ────────────────────────────────────────────────────────
check('remaining time counts down from when the team got the mission',
  timeLimitRemainingMs(task, start, t0 + 60_000) === 4 * 60_000);
check('remaining never goes below zero', timeLimitRemainingMs(task, start, t0 + 60 * 60_000) === 0);
check('no limit, or no start stamp: null (nothing to count)',
  timeLimitRemainingMs({}, start, t0) === null && timeLimitRemainingMs(task, undefined, t0) === null
  && timeLimitRemainingMs(task, 'garbage', t0) === null);
check('garbage limits are no limit', [0, -3, NaN, '5', null].every((v) => timeLimitRemainingMs({ timeLimitMinutes: v as never }, start, t0) === null));
check('not up before the limit', !isTimeLimitUp(task, start, t0 + 5 * 60_000 - 1));
check('a short grace absorbs a submission in flight at the buzzer',
  !isTimeLimitUp(task, start, t0 + 5 * 60_000 + TIME_LIMIT_GRACE_MS - 1) && isTimeLimitUp(task, start, t0 + 5 * 60_000 + TIME_LIMIT_GRACE_MS + 1));
check('the sweep can ask without grace', isTimeLimitUp(task, start, t0 + 5 * 60_000 + 1, 0));
check('no limit is never up', !isTimeLimitUp({}, start, t0 + 10 ** 9) && !isTimeLimitUp(task, undefined, t0 + 10 ** 9));
check('fractional minutes work (tests use seconds)', timeLimitRemainingMs({ timeLimitMinutes: 0.05 }, start, t0) === 3000);

// ── Save-time validation ──────────────────────────────────────────────────────
check('valid limits pass', [undefined, 1, 5, 0.5, TIME_LIMIT_MAX_MINUTES].every((v) => timeLimitProblem({ timeLimitMinutes: v }) === null));
check('invalid limits are named', [0, -1, NaN, TIME_LIMIT_MAX_MINUTES + 1, '5'].every((v) => typeof timeLimitProblem({ timeLimitMinutes: v as never }) === 'string'));

// ── Clock window: absolute close ──────────────────────────────────────────────
const at = '2026-09-27T11:30:00.000Z';
check('an absolute close shuts the mission at that time, with or without a run start',
  !isExpired({ expiresAt: at }, start, Date.parse(at) - 1) && isExpired({ expiresAt: at }, start, Date.parse(at))
  && isExpired({ expiresAt: at }, undefined, Date.parse(at) + 1));
check('a relative close still works as before', isExpired({ expiresAfterMinutes: 30 }, start, t0 + 30 * 60_000) && !isExpired({ expiresAfterMinutes: 30 }, start, t0));
check('with both, the EARLIER close wins',
  isExpired({ expiresAt: at, expiresAfterMinutes: 30 }, start, t0 + 30 * 60_000)
  && expiryInstantMs({ expiresAt: at, expiresAfterMinutes: 30 }, start) === t0 + 30 * 60_000
  && expiryInstantMs({ expiresAt: at, expiresAfterMinutes: 300 }, start) === Date.parse(at));
check('an unparsable absolute close is ignored, never a closed mission', !isExpired({ expiresAt: 'soon' }, start, t0 + 10 ** 9));
check('hasScheduleGate sees every gate', [{ releaseAt: at }, { releaseAfterMinutes: 1 }, { expiresAfterMinutes: 1 }, { expiresAt: at }].every(hasScheduleGate) && !hasScheduleGate({}) && !hasScheduleGate(null));
check('a window that closes before it opens is refused',
  typeof validateAvailabilityWindow({ releaseAt: at, expiresAt: start }) === 'string'
  && validateAvailabilityWindow({ releaseAt: start, expiresAt: at }) === null);
check('an unparsable absolute close is refused at save time', typeof validateAvailabilityWindow({ expiresAt: 'soon' }) === 'string');

console.log(`\n${failures === 0 ? 'ALL TIME-LIMIT TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
