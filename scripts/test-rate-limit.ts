// Pure-logic test for the fixed-window rate limiter (change: callable-rate-limiting,
// Appendix B #19). Realizes the RED-phase todos: allow-up-to-max then deny, window
// reset, independent keys, retryAfterMs boundary. No emulator.
//   npx tsx scripts/test-rate-limit.ts
import { rateLimit, RATE_LIMITS, type WindowState } from '../packages/shared/src/rateLimit';

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const WIN = 60_000;
const T0 = 1_000_000; // arbitrary fixed clock (no Date.now — deterministic)

// Drive `max` calls from empty; each should be allowed, threading nextState.
let state: WindowState | null = null;
for (let i = 0; i < 3; i++) {
  const d = rateLimit(state, 3, WIN, T0);
  check(`call ${i + 1}/3 within window → allowed`, d.allowed);
  check(`call ${i + 1} retryAfterMs is 0 while allowed`, d.retryAfterMs === 0);
  state = d.nextState;
}

// The 4th call in the same window is denied, with a positive retry.
const over = rateLimit(state, 3, WIN, T0);
check('4th call in window → denied', !over.allowed);
check('denied retryAfterMs is the full window (no time elapsed)', over.retryAfterMs === WIN);
check('denied does not increment the count past max', over.nextState.count === 3);

// Part-way through the window the retry shrinks.
const mid = rateLimit(state, 3, WIN, T0 + 20_000);
check('denied mid-window → retryAfterMs = window - elapsed', mid.retryAfterMs === WIN - 20_000);

// Once the window elapses, calls are allowed again and the window resets.
const reset = rateLimit(state, 3, WIN, T0 + WIN);
check('after windowMs → allowed again', reset.allowed);
check('reset window restarts at nowMs', reset.nextState.windowStartMs === T0 + WIN);
check('reset count is 1 (this call)', reset.nextState.count === 1);

// Independent keys: a fresh (null) state is unaffected by another key's exhaustion.
const otherKey = rateLimit(null, 3, WIN, T0);
check('a different key has its own bucket → allowed', otherKey.allowed);

// Budgets are sane and present for every wired callable.
const WIRED = [
  'submitTaskAnswer', 'submitSequenceStep', 'verifyStationCode', 'submitStationPhoto',
  'completeTask', 'requestTaskHint', 'claimDiscoveryPoi', 'checkOutTask', 'joinRun',
  'triggerSOS', 'requestGuardianConsent', 'getMyTeamState', 'requestNextTask',
  'getRecommendedTasks', 'getRunDiscoveryPois', 'getJoinInfo', 'updateLocation',
];
for (const name of WIRED) {
  const b = RATE_LIMITS[name];
  check(`budget defined for ${name}`, !!b && b.max > 0 && b.windowMs > 0);
}

console.log(`\n${failures === 0 ? 'ALL RATE-LIMIT TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
