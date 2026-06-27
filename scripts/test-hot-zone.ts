// Pure-logic tests for hot-zone-bonus (hotZoneMultiplier).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { hotZoneMultiplier, type HotZone } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const center = { lat: 31.79, lng: 35.16 };
const inside = { lat: 31.7902, lng: 35.1602 };  // ~25m away
const outside = { lat: 31.80, lng: 35.18 };     // ~2km away

const t0 = Date.parse('2026-01-01T12:00:00.000Z');
const zone: HotZone = {
  center, radiusMeters: 100, multiplier: 2,
  startedAt: '2026-01-01T12:00:00.000Z',
  expiresAt: '2026-01-01T12:05:00.000Z',
};
const within = t0 + 60_000;   // 1 min in
const before = t0 - 60_000;   // before start
const after = t0 + 600_000;   // after expiry

ok(hotZoneMultiplier(zone, inside, within) === 2, 'in-zone, in-window → multiplier');
ok(hotZoneMultiplier(zone, outside, within) === 1, 'outside radius → 1');
ok(hotZoneMultiplier(zone, inside, before) === 1, 'before start → 1');
ok(hotZoneMultiplier(zone, inside, after) === 1, 'after expiry → 1');
ok(hotZoneMultiplier(null, inside, within) === 1, 'no zone → 1');
ok(hotZoneMultiplier(undefined, inside, within) === 1, 'undefined zone → 1');
ok(hotZoneMultiplier(zone, null, within) === 1, 'no coords → 1');
ok(hotZoneMultiplier(zone, undefined, within) === 1, 'undefined coords → 1');
ok(hotZoneMultiplier({ ...zone, multiplier: 1 }, inside, within) === 1, 'multiplier ≤ 1 → 1');
ok(hotZoneMultiplier({ ...zone, startedAt: 'bad', expiresAt: 'bad' }, inside, within) === 1, 'bad dates → 1');
ok(hotZoneMultiplier(zone, { lat: 999, lng: 999 }, within) === 1, 'invalid coords → 1 (no throw)');
ok(hotZoneMultiplier(zone, inside, t0) === 2, 'exactly at start boundary → multiplier');
ok(hotZoneMultiplier(zone, inside, t0 + 300_000) === 2, 'exactly at expiry boundary → multiplier');

console.log(failed === 0
  ? `\n✅ ALL HOT-ZONE TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
