// Lightweight unit test for GPS coordinate validation + hardened haversine. No
// test runner is configured, so this is a plain tsx assertion script (matches the
// repo's test-tiebreaker.ts / e2e-verify.mjs style).
// Run: npx tsx scripts/test-geo-validation.ts
import {
  isValidCoord,
  haversineKm,
  LocationError,
  INVALID_LOCATION,
} from '../packages/shared/src/geo';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── 1. Valid coordinates pass ─────────────────────────────────────────────────
check('valid Jerusalem coords are accepted', isValidCoord(31.793, 35.166));
check('boundary coords (±90 / ±180) are accepted', isValidCoord(-90, 180) && isValidCoord(90, -180));

// ── 2. Out-of-range / NaN / Infinity are rejected ─────────────────────────────
check('lat > 90 rejected', !isValidCoord(91, 35));
check('lat < -90 rejected', !isValidCoord(-91, 35));
check('lng > 180 rejected', !isValidCoord(31, 181));
check('lng < -180 rejected', !isValidCoord(31, -181));
check('NaN rejected', !isValidCoord(NaN, 35));
check('Infinity rejected', !isValidCoord(31, Infinity));
check('undefined rejected', !isValidCoord(undefined, undefined));
check('strings rejected', !isValidCoord('31' as unknown, '35' as unknown));

// ── 3. haversineKm returns a finite distance for valid input ──────────────────
{
  const d = haversineKm({ lat: 31.79326, lng: 35.165684 }, { lat: 31.808885, lng: 35.193833 });
  check('haversine returns a finite, positive distance', Number.isFinite(d) && d > 0, `d=${d.toFixed(3)}km`);
}

// ── 4. haversineKm throws typed LocationError for bad input (no NaN/Infinity) ──
{
  let err: unknown;
  try {
    haversineKm({ lat: NaN, lng: 35 }, { lat: 31.8, lng: 35.19 });
  } catch (e) {
    err = e;
  }
  check('haversine throws on NaN input', err instanceof LocationError);
  check('  error carries INVALID_LOCATION code', (err as LocationError)?.code === INVALID_LOCATION);
}
{
  let threw = false;
  try {
    haversineKm({ lat: 200, lng: 999 }, { lat: 31.8, lng: 35.19 });
  } catch {
    threw = true;
  }
  check('haversine throws on out-of-range input', threw);
}

console.log(`\n${failures === 0 ? 'ALL GEO-VALIDATION TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
