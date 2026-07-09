// Pure-logic tests for circlePolygonGeoJSON (hot-zone-routing-bias): the geo
// circle the participant map draws for an active hot zone. Run by
// scripts/run-unit-tests.mjs via `npm test`.
import { circlePolygonGeoJSON, haversineKm, type GeoPoint } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const center: GeoPoint = { lat: 31.79, lng: 35.16 };
const radiusMeters = 200;
const feature = circlePolygonGeoJSON(center, radiusMeters, 64);

// Shape: a GeoJSON Polygon Feature with one linear ring.
ok(feature.type === 'Feature', 'returns a Feature');
ok(feature.geometry.type === 'Polygon', 'geometry is a Polygon');
const ring = feature.geometry.coordinates[0];
ok(Array.isArray(ring), 'has a coordinate ring');

// A closed ring of `points + 1` vertices (first === last).
ok(ring.length === 65, `ring has points+1 vertices (got ${ring.length})`);
ok(ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1],
  'ring is closed (first === last)');

// Every vertex sits ~radiusMeters from the centre (within ~1% tolerance).
let maxErr = 0;
for (const [lng, lat] of ring) {
  const distM = haversineKm(center, { lat, lng }) * 1000;
  maxErr = Math.max(maxErr, Math.abs(distM - radiusMeters));
}
ok(maxErr <= radiusMeters * 0.01, `all vertices within 1% of radius (max err ${maxErr.toFixed(2)}m)`);

// Vertices are [lng, lat] order (GeoJSON), so lng ≈ 35.16, lat ≈ 31.79.
ok(Math.abs(ring[0][0] - center.lng) < 0.01, 'vertex x is longitude');
ok(Math.abs(ring[0][1] - center.lat) < 0.01, 'vertex y is latitude');

// Default point count still yields a valid closed ring.
const dflt = circlePolygonGeoJSON(center, radiusMeters);
ok(dflt.geometry.coordinates[0].length >= 5, 'default point count yields a ring');

console.log(failed === 0
  ? `\n✅ ALL GEO-CIRCLE TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
