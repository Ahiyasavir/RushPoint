// Pure-logic tests for movement-heatmap density binning. Run by run-unit-tests.mjs.
import { buildMovementDensity } from '@rushpoint/shared';

let passed = 0, failed = 0;
function ok(cond: boolean, msg: string) { if (cond) passed++; else { failed++; console.error(`  ✗ ${msg}`); } }

// Empty / prune-safe
ok(buildMovementDensity([]).length === 0, 'empty track → no cells');
ok(buildMovementDensity(undefined as never).length === 0, 'undefined track → no cells');

// Points in the same bin merge with summed weight
const near = [
  { lat: 31.7801, lng: 35.2101 },
  { lat: 31.7802, lng: 35.2102 },
  { lat: 31.78015, lng: 35.21015 },
];
const c1 = buildMovementDensity(near, { gridDeg: 0.01 });
ok(c1.length === 1, 'three nearby points collapse to one cell');
ok(c1[0].weight === 3, 'weight equals point count');

// Distant points land in separate bins
const far = [{ lat: 0, lng: 0 }, { lat: 10, lng: 10 }];
ok(buildMovementDensity(far, { gridDeg: 0.01 }).length === 2, 'distant points → separate cells');

// Weight sum equals valid point count
const mixed = [
  { lat: 1, lng: 1 }, { lat: 1.0001, lng: 1.0001 }, { lat: 5, lng: 5 },
  { lat: NaN, lng: 2 }, { lat: 200, lng: 2 }, // invalid → skipped
];
const cells = buildMovementDensity(mixed, { gridDeg: 0.01 });
ok(cells.reduce((s, c) => s + c.weight, 0) === 3, 'invalid/out-of-range coords are skipped');

// Deterministic order: heaviest cell first
const det = buildMovementDensity([
  { lat: 5, lng: 5 }, { lat: 1, lng: 1 }, { lat: 1.0001, lng: 1.0001 },
], { gridDeg: 0.01 });
ok(det[0].weight === 2 && det[1].weight === 1, 'cells sorted by weight desc');
// Same input → same output (determinism)
const a = JSON.stringify(buildMovementDensity(mixed));
const b = JSON.stringify(buildMovementDensity(mixed));
ok(a === b, 'deterministic across runs');

console.log(failed === 0 ? `\n✅ ALL MOVEMENT-HEATMAP TESTS PASSED (${passed})` : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
