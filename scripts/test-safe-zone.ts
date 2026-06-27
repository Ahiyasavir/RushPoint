// Pure-logic test for the safe-zone breach predicate (change: safe-zone-boundary).
//   npx tsx scripts/test-safe-zone.ts
import { isOutsideSafeZone } from '../packages/shared/src/safeZone';

let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}

const zone = { center: { lat: 31.78, lng: 35.21 }, radiusMeters: 150 };

check('at the center → inside', !isOutsideSafeZone({ lat: 31.78, lng: 35.21 }, zone));
check('~80m away (inside 150m) → inside', !isOutsideSafeZone({ lat: 31.7807, lng: 35.21 }, zone));
check('far away → outside', isOutsideSafeZone({ lat: 32.5, lng: 35.9 }, zone));
check('no zone → never outside', !isOutsideSafeZone({ lat: 32.5, lng: 35.9 }, undefined));
check('zero radius → never outside', !isOutsideSafeZone({ lat: 32.5, lng: 35.9 }, { center: zone.center, radiusMeters: 0 }));

let threw = false;
try { isOutsideSafeZone({ lat: NaN, lng: 35 }, zone); } catch { threw = true; }
check('invalid coords → throws', threw);

console.log(`\n${failures === 0 ? 'ALL SAFE-ZONE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
