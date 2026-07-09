// Pure-logic tests for scheduled-release (isReleased / releaseInstantMs) and
// task expiry (isExpired / expiryInstantMs / validateAvailabilityWindow —
// change: task-expiry). Run by scripts/run-unit-tests.mjs via `npm test`.
// No emulator needed.
import {
  isReleased, releaseInstantMs, isExpired, expiryInstantMs, validateAvailabilityWindow,
} from '@rushpoint/shared';

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

// ── isExpired (task-expiry) — never-expired gates ──
ok(isExpired(undefined, T0, now) === false, 'undefined gate → never expired');
ok(isExpired(null, T0, now) === false, 'null gate → never expired');
ok(isExpired({}, T0, now) === false, 'empty gate → never expired');
ok(isExpired({ expiresAfterMinutes: 0 }, T0, now) === false, 'zero expiry → never expired');
ok(isExpired({ expiresAfterMinutes: -5 }, T0, now) === false, 'negative expiry → never expired');
ok(isExpired({ expiresAfterMinutes: NaN }, T0, now) === false, 'NaN expiry → never expired');
ok(isExpired({ expiresAfterMinutes: Infinity }, T0, now) === false, 'Infinity expiry → never expired');

// ── isExpired — around the instant (T0 + 30min == now) ──
ok(isExpired({ expiresAfterMinutes: 45 }, T0, now) === false, '45min expiry, 30min elapsed → not expired');
ok(isExpired({ expiresAfterMinutes: 30 }, T0, now) === true, '30min expiry, 30min elapsed → expired (>=)');
ok(isExpired({ expiresAfterMinutes: 20 }, T0, now) === true, '20min expiry, 30min elapsed → expired');
ok(isExpired({ expiresAfterMinutes: 0.5 }, T0, T0 + 29_000) === false, 'fractional: 0.5min, 29s elapsed → not expired');
ok(isExpired({ expiresAfterMinutes: 0.5 }, T0, T0 + 31_000) === true, 'fractional: 0.5min, 31s elapsed → expired');
ok(isExpired({ expiresAfterMinutes: 30 }, undefined, now) === false, 'no run start → NOT expired (fail safe)');
ok(isExpired({ expiresAfterMinutes: 30 }, 'not-a-date', now) === false, 'unparseable run start → NOT expired');
ok(isExpired({ expiresAfterMinutes: 30 }, new Date(T0).toISOString(), now) === true, 'ISO-string run start accepted');

// ── expiryInstantMs (for the countdown UI) ──
ok(expiryInstantMs(undefined, T0) === null, 'no gate → no expiry instant');
ok(expiryInstantMs({}, T0) === null, 'empty gate → no expiry instant');
ok(expiryInstantMs({ expiresAfterMinutes: 0 }, T0) === null, 'zero expiry → no instant');
ok(expiryInstantMs({ expiresAfterMinutes: 45 }, T0) === T0 + 45 * 60_000, 'expiry instant = start + minutes');
ok(expiryInstantMs({ expiresAfterMinutes: 45 }, undefined) === null, 'expiry with no run start → null');

// ── validateAvailabilityWindow (release + expiry interaction) ──
ok(validateAvailabilityWindow({ releaseAfterMinutes: 10, expiresAfterMinutes: 30 }) === null,
  'expiry > release → valid window');
ok(validateAvailabilityWindow({ releaseAfterMinutes: 30, expiresAfterMinutes: 30 }) !== null,
  'expiry == release → empty window error');
ok(validateAvailabilityWindow({ releaseAfterMinutes: 30, expiresAfterMinutes: 10 }) !== null,
  'expiry < release → empty window error');
ok(validateAvailabilityWindow({ expiresAfterMinutes: 30 }) === null, 'expiry alone → valid');
ok(validateAvailabilityWindow({ releaseAfterMinutes: 30 }) === null, 'release alone → valid');
ok(validateAvailabilityWindow({}) === null, 'no gates → valid');
ok(validateAvailabilityWindow({ releaseAt: '2026-07-05T10:00:00.000Z', expiresAfterMinutes: 10 }) === null,
  'wall-clock releaseAt + relative expiry → NOT a static error (Builder warns instead)');

// ── Combined window: available only in [release, expiry) ──
{
  const gate = { releaseAfterMinutes: 10, expiresAfterMinutes: 20 };
  const at = (min: number) => T0 + min * 60_000;
  const available = (nowMs: number) => isReleased(gate, T0, nowMs) && !isExpired(gate, T0, nowMs);
  ok(available(at(5)) === false, 'combined: before release → unavailable');
  ok(available(at(15)) === true, 'combined: inside window → available');
  ok(available(at(25)) === false, 'combined: released-but-expired → unavailable');
}

console.log(failed === 0
  ? `\n✅ ALL SCHEDULE TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
