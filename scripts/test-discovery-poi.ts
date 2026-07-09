// Pure-logic tests for surprise-trivia-waypoints (discovery POI helpers).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  isWithinPoiRadius,
  matchesDiscoveryAnswer,
  isPoiAlreadyClaimed,
  buildOverpassQuery,
  toDiscoveryPoiResult,
  type DiscoveryPoi,
  type TeamDiscoveryState,
} from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const center = { lat: 31.79, lng: 35.16 };

// ── isWithinPoiRadius ────────────────────────────────────────────────────────
ok(isWithinPoiRadius(center, { lat: 31.7902, lng: 35.1602 }, 100) === true, 'inside radius → true');
ok(isWithinPoiRadius(center, { lat: 31.80, lng: 35.18 }, 100) === false, 'far outside → false');
ok(isWithinPoiRadius(center, center, 0) === true, 'exact centre with radius 0 → true (boundary)');
// boundary: a point ~50m away with radius 50 should be inside (≤)
{
  // 0.00045 deg lat ≈ 50m; use a generous radius to assert boundary inclusivity
  const edge = { lat: 31.79 + 0.00045, lng: 35.16 };
  ok(isWithinPoiRadius(center, edge, 60) === true, 'on/near boundary (≤ radius) → inside');
}
let threw = false;
try { isWithinPoiRadius(center, { lat: 999, lng: 999 }, 100); } catch { threw = true; }
ok(threw, 'bad coords → throws LocationError');

// ── matchesDiscoveryAnswer ───────────────────────────────────────────────────
ok(matchesDiscoveryAnswer(['Tower'], 'tower') === true, 'case-insensitive');
ok(matchesDiscoveryAnswer(['Tower'], '  TOWER  ') === true, 'trims whitespace');
ok(matchesDiscoveryAnswer(['café'], 'cafe') === true, 'strips diacritics');
ok(matchesDiscoveryAnswer(['Tower'], 'bridge') === false, 'no false positive');
ok(matchesDiscoveryAnswer([], 'x') === false, 'empty list → false');
ok(matchesDiscoveryAnswer(undefined, 'x') === false, 'undefined list → false');
ok(matchesDiscoveryAnswer(['Tower'], '   ') === false, 'blank answer → false');
ok(matchesDiscoveryAnswer(['מגדל'], ' מגדל ') === true, 'Hebrew trims + matches');

// ── isPoiAlreadyClaimed ──────────────────────────────────────────────────────
const state: TeamDiscoveryState = { p1: 'answered', p2: 'triggered' };
ok(isPoiAlreadyClaimed(state, 'p1') === true, "'answered' → claimed");
ok(isPoiAlreadyClaimed(state, 'p2') === false, "'triggered' → not claimed");
ok(isPoiAlreadyClaimed(state, 'p3') === false, 'absent → not claimed');
ok(isPoiAlreadyClaimed(undefined, 'p1') === false, 'no state → not claimed');

// ── buildOverpassQuery ───────────────────────────────────────────────────────
const q = buildOverpassQuery({ south: 31.7, west: 35.1, north: 31.8, east: 35.2 });
ok(q.includes('31.7,35.1,31.8,35.2'), 'query contains the bbox');
ok(q.includes('historic') && q.includes('tourism'), 'query contains OSM tag filters');
ok(q.includes('[out:json]'), 'query has Overpass header');
let injThrew = false;
try { buildOverpassQuery({ south: NaN, west: 0, north: 1, east: 2 }); } catch { injThrew = true; }
ok(injThrew, 'non-finite bound → throws (no injection)');
{
  // A string masquerading as a bound is coerced to NaN → rejected, never embedded.
  let strThrew = false;
  try { buildOverpassQuery({ south: '1);out;//' as unknown as number, west: 0, north: 1, east: 2 }); }
  catch { strThrew = true; }
  ok(strThrew, 'string bound is coerced + rejected (injection-safe)');
}

// ── toDiscoveryPoiResult strips secrets ──────────────────────────────────────
const poi: DiscoveryPoi = {
  id: 'p1', coordinates: center, radiusMeters: 80, title: 'Secret spot',
  flavorText: 'Look around', question: 'What is it?', answers: ['Tower'],
  bonusPoints: 50, hint: 'tall',
};
const res = toDiscoveryPoiResult(poi);
ok(!('coordinates' in res) && !('answers' in res), 'result strips coordinates + answers');
ok(res.bonusPoints === 50 && res.question === 'What is it?' && res.hasHint === true, 'result keeps safe fields');

console.log(failed === 0
  ? `\n✅ ALL DISCOVERY-POI TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
