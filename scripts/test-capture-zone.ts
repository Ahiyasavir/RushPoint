// Pure-logic tests for territory-capture helpers.
import { isWithinZone, canCapture } from '@rushpoint/shared';

let passed = 0, failed = 0;
function ok(cond: boolean, msg: string) { if (cond) passed++; else { failed++; console.error(`  ✗ ${msg}`); } }

const center = { lat: 31.78, lng: 35.21 };
// Inside radius
ok(isWithinZone(center, { lat: 31.7801, lng: 35.2101 }, 100) === true, 'nearby point is inside a 100m zone');
// Outside radius
ok(isWithinZone(center, { lat: 31.80, lng: 35.25 }, 100) === false, 'far point is outside a 100m zone');
// Invalid coords
ok(isWithinZone(center, { lat: NaN, lng: 35.21 }, 100) === false, 'NaN point → not inside');
ok(isWithinZone({ lat: NaN, lng: 0 }, center, 100) === false, 'NaN center → not inside');

// Capture rules
ok(canCapture({ ownerTeamId: null }, 'teamA') === true, 'unowned zone is capturable');
ok(canCapture({ ownerTeamId: 'teamB' }, 'teamA') === true, 'rival-owned zone can be flipped');
ok(canCapture({ ownerTeamId: 'teamA' }, 'teamA') === false, 'own zone cannot be re-captured');

console.log(failed === 0 ? `\n✅ ALL CAPTURE-ZONE TESTS PASSED (${passed})` : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
