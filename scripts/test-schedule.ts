// Pure-logic tests for scheduled-release (isReleased / releaseInstantMs).
// Run by scripts/run-unit-tests.mjs via `npm test`. No emulator needed.
import { isReleased, releaseInstantMs } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const T0 = Date.parse('2026-07-05T10:00:00.000Z'); // a fixed "run start"
const now = Date.parse('2026-07-05T10:30:00.000Z'); // 30 min later

// ── No gate ⇒ always released (back-compat) ──
ok(isReleased(undefined, T0, now) === true, 'undefined gate → released');
ok(isReleased(null, T0, now) === true, 'null gate → released');
ok(isReleased({}, T0, now) === true, 'empty gate → released');
ok(isReleased({ releaseAfterMinutes: 0 }, T0, now) === true, 'zero after-minutes → released');

// ── releaseAt (wall-clock) ──
ok(isReleased({ releaseAt: '2026-07-05T10:15:00.000Z' }, T0, now) === true, 'past releaseAt → released');
ok(isReleased({ releaseAt: '2026-07-05T11:00:00.000Z' }, T0, now) === false, 'future releaseAt → locked');
ok(isReleased({ releaseAt: '2026-07-05T10:30:00.000Z' }, T0, now) === true, 'exactly-now releaseAt → released (>=)');
ok(isReleased({ releaseAt: 'not-a-date' }, T0, now) === false, 'unparseable releaseAt → locked (never silently open)');

// ── releaseAfterMinutes (relative to run start) ──
ok(isReleased({ releaseAfterMinutes: 20 }, T0, now) === true, '20min gate, 30min elapsed → released');
ok(isReleased({ releaseAfterMinutes: 30 }, T0, now) === true, '30min gate, 30min elapsed → released (>=)');
ok(isReleased({ releaseAfterMinutes: 45 }, T0, now) === false, '45min gate, 30min elapsed → locked');
ok(isReleased({ releaseAfterMinutes: 10 }, undefined, now) === false, 'after-minutes with no run start → locked');
ok(isReleased({ releaseAfterMinutes: 10 }, T0, T0) === false, 'after-minutes at t=0 → locked');
ok(isReleased({ releaseAfterMinutes: 10 }, T0, now) === true, 'numeric run-start also accepted');

// ── Both gates: the LATER wins (both must be satisfied) ──
ok(isReleased({ releaseAt: '2026-07-05T10:15:00.000Z', releaseAfterMinutes: 45 }, T0, now) === false,
  'both set: after-minutes not yet met → locked');
ok(isReleased({ releaseAt: '2026-07-05T11:00:00.000Z', releaseAfterMinutes: 10 }, T0, now) === false,
  'both set: releaseAt not yet met → locked');
ok(isReleased({ releaseAt: '2026-07-05T10:15:00.000Z', releaseAfterMinutes: 20 }, T0, now) === true,
  'both set: both met → released');

// ── releaseInstantMs (for the countdown UI) ──
ok(releaseInstantMs(undefined, T0) === null, 'no gate → no instant');
ok(releaseInstantMs({}, T0) === null, 'empty gate → no instant');
ok(releaseInstantMs({ releaseAt: '2026-07-05T11:00:00.000Z' }, T0) === Date.parse('2026-07-05T11:00:00.000Z'),
  'releaseAt instant');
ok(releaseInstantMs({ releaseAfterMinutes: 30 }, T0) === T0 + 30 * 60_000, 'after-minutes instant');
ok(releaseInstantMs({ releaseAfterMinutes: 30 }, undefined) === null, 'after-minutes with no start → null');
ok(releaseInstantMs({ releaseAt: '2026-07-05T10:15:00.000Z', releaseAfterMinutes: 45 }, T0) === T0 + 45 * 60_000,
  'both gates → later instant wins');

console.log(failed === 0
  ? `\n✅ ALL SCHEDULE TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
