// Pure-logic test for hint auto escalation (change: hint-auto-escalation).
// isHintFree is the single decision point shared by requestTaskHint (charging)
// and getMyTeamState (display) — this truth table is the authoritative coverage
// for the TIME path (the e2e can't wait minutes; it drives the attempts path).
//   npx tsx scripts/test-hint-escalation.ts
import { isHintFree } from '../packages/shared/src/hintEscalation';

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const NOW = Date.parse('2026-07-06T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

// ── No thresholds → never free, whatever the state says ──────────────────────
check('no thresholds: fresh task → paid',
  !isHintFree({ startedAt: minutesAgo(0), wrongAttempts: 0 }, {}, NOW));
check('no thresholds: ancient task + many wrong attempts → still paid',
  !isHintFree({ startedAt: minutesAgo(600), wrongAttempts: 50 }, {}, NOW));

// ── Attempts path ─────────────────────────────────────────────────────────────
const A3 = { hintAutoRevealAttempts: 3 };
check('attempts 2/3 → paid', !isHintFree({ wrongAttempts: 2 }, A3, NOW));
check('attempts 3/3 (at threshold) → free', isHintFree({ wrongAttempts: 3 }, A3, NOW));
check('attempts 4/3 (above) → free', isHintFree({ wrongAttempts: 4 }, A3, NOW));
check('attempts undefined counts as 0 → paid', !isHintFree({}, A3, NOW));

// ── Time path (from RunTaskRecord.startedAt, server clock) ────────────────────
const M10 = { hintAutoRevealMinutes: 10 };
check('held 9 of 10 min → paid', !isHintFree({ startedAt: minutesAgo(9) }, M10, NOW));
check('held exactly 10 min (at threshold) → free', isHintFree({ startedAt: minutesAgo(10) }, M10, NOW));
check('held 11 of 10 min → free', isHintFree({ startedAt: minutesAgo(11) }, M10, NOW));
check('fractional threshold honored: 0.5 min, held 29s → paid',
  !isHintFree({ startedAt: new Date(NOW - 29_000).toISOString() }, { hintAutoRevealMinutes: 0.5 }, NOW));
check('fractional threshold honored: 0.5 min, held 31s → free',
  isHintFree({ startedAt: new Date(NOW - 31_000).toISOString() }, { hintAutoRevealMinutes: 0.5 }, NOW));

// Missing / unparseable startedAt → the time path is simply unsatisfied (fail
// safe toward "paid"), never a throw.
check('missing startedAt → time path off → paid', !isHintFree({}, M10, NOW));
check('unparseable startedAt → time path off → paid',
  !isHintFree({ startedAt: 'not-a-date' }, M10, NOW));
check('empty startedAt → time path off → paid', !isHintFree({ startedAt: '' }, M10, NOW));

// ── OR semantics — either path alone frees ────────────────────────────────────
const BOTH = { hintAutoRevealMinutes: 10, hintAutoRevealAttempts: 3 };
check('OR: attempts met while time unmet → free',
  isHintFree({ startedAt: minutesAgo(1), wrongAttempts: 3 }, BOTH, NOW));
check('OR: time met while attempts below → free',
  isHintFree({ startedAt: minutesAgo(15), wrongAttempts: 0 }, BOTH, NOW));
check('OR: attempts met with NO startedAt at all → free',
  isHintFree({ wrongAttempts: 3 }, BOTH, NOW));
check('OR: neither met → paid',
  !isHintFree({ startedAt: minutesAgo(1), wrongAttempts: 1 }, BOTH, NOW));

// ── Degenerate thresholds are ignored (0 / negative / non-finite) ─────────────
check('attempts threshold 0 → ignored (paid even at 99 wrong)',
  !isHintFree({ wrongAttempts: 99 }, { hintAutoRevealAttempts: 0 }, NOW));
check('attempts threshold -2 → ignored',
  !isHintFree({ wrongAttempts: 99 }, { hintAutoRevealAttempts: -2 }, NOW));
check('attempts threshold NaN → ignored',
  !isHintFree({ wrongAttempts: 99 }, { hintAutoRevealAttempts: NaN }, NOW));
check('attempts threshold Infinity → ignored',
  !isHintFree({ wrongAttempts: 99 }, { hintAutoRevealAttempts: Infinity }, NOW));
check('minutes threshold 0 → ignored (paid even after hours)',
  !isHintFree({ startedAt: minutesAgo(600) }, { hintAutoRevealMinutes: 0 }, NOW));
check('minutes threshold -5 → ignored',
  !isHintFree({ startedAt: minutesAgo(600) }, { hintAutoRevealMinutes: -5 }, NOW));
check('minutes threshold NaN → ignored',
  !isHintFree({ startedAt: minutesAgo(600) }, { hintAutoRevealMinutes: NaN }, NOW));
check('minutes threshold Infinity → ignored',
  !isHintFree({ startedAt: minutesAgo(600) }, { hintAutoRevealMinutes: Infinity }, NOW));

console.log(`\n${failures === 0 ? 'ALL HINT-ESCALATION TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
