// Pure-logic tests for the browser-sim GPS route helper (change: browser-fidelity-simulation).
// RED-first: scripts/lib/gpsRoute.mjs does not exist yet, so this fails on import
// until task 1.2 implements it. Encodes the streamed-GPS contract the driver relies on:
// interpolation endpoints/monotonicity, bounded jitter, and geofence-crossing behavior
// (a team walking toward a target enters its radius; a team headed elsewhere never does).
// @ts-expect-error — implemented in task 1.2 (JS module, no d.ts by design)
import { makeRng, haversineMeters, walkPath, stepToward, jitterFix } from './lib/gpsRoute.mjs';

let passed = 0, failed = 0;
function ok(cond: boolean, msg: string) { if (cond) passed++; else { failed++; console.error(`  ✗ ${msg}`); } }

const A = { lat: 31.7800, lng: 35.2100 };
const B = { lat: 31.7850, lng: 35.2160 };

// ── walkPath: exact endpoints + monotonic interpolation ──────────────────────
{
  const p0 = walkPath(A, B, 0);
  const p1 = walkPath(A, B, 1);
  ok(p0.lat === A.lat && p0.lng === A.lng, 'walkPath(t=0) returns exactly `from`');
  ok(p1.lat === B.lat && p1.lng === B.lng, 'walkPath(t=1) returns exactly `to`');
  const mid = walkPath(A, B, 0.5);
  ok(Math.abs(mid.lat - (A.lat + B.lat) / 2) < 1e-9, 'walkPath(t=0.5) is the lat midpoint');
  ok(Math.abs(mid.lng - (A.lng + B.lng) / 2) < 1e-9, 'walkPath(t=0.5) is the lng midpoint');
  // Monotonic in both axes along the segment (A→B increases both here).
  let mono = true, prevLat = -Infinity, prevLng = -Infinity;
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const p = walkPath(A, B, t);
    if (p.lat < prevLat - 1e-12 || p.lng < prevLng - 1e-12) mono = false;
    prevLat = p.lat; prevLng = p.lng;
  }
  ok(mono, 'walkPath is monotonic along the segment');
  ok(walkPath(A, B, 1.7).lat === B.lat, 'walkPath clamps t>1 to `to`');
  ok(walkPath(A, B, -0.5).lat === A.lat, 'walkPath clamps t<0 to `from`');
}

// ── haversineMeters sanity ───────────────────────────────────────────────────
{
  ok(haversineMeters(A, A) === 0, 'haversine of a point to itself is 0');
  const oneDegLng = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  ok(oneDegLng > 111_000 && oneDegLng < 111_700, '1° lng at equator ≈ 111 km');
}

// ── jitterFix: bounded within the accuracy radius ────────────────────────────
{
  const rng = makeRng(424242);
  const acc = 8;
  let maxOff = 0;
  for (let i = 0; i < 500; i++) {
    const f = jitterFix(B, rng, acc);
    maxOff = Math.max(maxOff, haversineMeters(B, f));
  }
  ok(maxOff <= acc + 1e-6, `jitterFix stays within ${acc} m (saw ${maxOff.toFixed(2)} m)`);
  ok(maxOff > acc * 0.3, 'jitterFix actually moves the point (not a no-op)');
  ok(Number.isFinite(jitterFix(B, rng, acc).accuracy ?? NaN), 'jitterFix reports a finite accuracy');
}

// ── stepToward: bounded step that converges on the target ────────────────────
{
  // A team walking toward B by ≤ 15 m/tick eventually reaches it, and each tick
  // gets strictly closer (never overshoots past the target).
  let here = { ...A };
  const startDist = haversineMeters(A, B);
  let ticks = 0, everFarther = false;
  for (; ticks < 500; ticks++) {
    const prevD = haversineMeters(here, B);
    if (prevD < 0.5) break;
    here = stepToward(here, B, 15);
    const nextD = haversineMeters(here, B);
    if (nextD > prevD + 1e-6) everFarther = true;
  }
  ok(haversineMeters(here, B) < 0.5, 'stepToward converges on the target');
  ok(!everFarther, 'stepToward never moves away from the target');
  ok(ticks > 1 && ticks < 500, `stepToward takes a sane number of ticks (${ticks} for ${Math.round(startDist)} m)`);
  const step = stepToward(A, B, 15);
  // Centimetre tolerance: spherical geometry can't hit an exact metre bound, and
  // a sub-cm excess is physically irrelevant for a GPS sim.
  ok(haversineMeters(A, step) <= 15 + 0.01, 'a single stepToward moves at most maxStepMeters');
}

// ── geofence crossing: approach enters the radius, detour never does ─────────
{
  const center = { lat: 31.7900, lng: 35.2200 };
  const radius = 50;
  // Walking toward the center crosses into the radius.
  let here = { lat: 31.7800, lng: 35.2100 };
  let entered = false;
  for (let i = 0; i < 500 && !entered; i++) {
    here = stepToward(here, center, 15);
    if (haversineMeters(here, center) <= radius) entered = true;
  }
  ok(entered, 'a team walking toward a geofence enters its radius');

  // A team whose target is a far-away DIFFERENT stop never enters this geofence.
  const elsewhere = { lat: 31.7700, lng: 35.2000 };
  let there = { lat: 31.7800, lng: 35.2100 };
  let falseEntry = false;
  for (let i = 0; i < 500; i++) {
    there = stepToward(there, elsewhere, 15);
    if (haversineMeters(there, center) <= radius) falseEntry = true;
  }
  ok(!falseEntry, 'a team heading elsewhere never enters the unrelated geofence');
}

console.log(failed === 0 ? `\n✅ ALL GPS-ROUTE TESTS PASSED (${passed})` : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
