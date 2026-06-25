// Pure-logic tests for the 4 task trigger modes (change: task-trigger-modes).
// Validates radius conditions, exact-arrival tightness, instant/locationless
// no-GPS behavior, default radii, and legacy normalization. No emulator.
//   npx tsx scripts/test-trigger-modes.ts
import {
  evaluateTrigger,
  defaultRadiusFor,
  normalizeTriggerMode,
  type Task,
} from '../packages/shared/src/index';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── default radii ────────────────────────────────────────────────────────────
check('defaultRadiusFor(radius) === 40', defaultRadiusFor('radius') === 40);
check('defaultRadiusFor(exact) === 4', defaultRadiusFor('exact') === 4);
check('defaultRadiusFor(instant) === 0', defaultRadiusFor('instant') === 0);
check('defaultRadiusFor(locationless) === 0', defaultRadiusFor('locationless') === 0);

// ── radius mode: within passes, beyond fails ─────────────────────────────────
check('radius@40 accepts 30m', evaluateTrigger('radius', 30, 40).ok === true);
check('radius@40 rejects 60m', evaluateTrigger('radius', 60, 40).ok === false);
check('radius accepts exactly at the boundary', evaluateTrigger('radius', 40, 40).ok === true);

// ── exact mode: tight ────────────────────────────────────────────────────────
check('exact@4 accepts 3m', evaluateTrigger('exact', 3, 4).ok === true);
check('exact@4 rejects 10m', evaluateTrigger('exact', 10, 4).ok === false);

// ── default radius applied when omitted ──────────────────────────────────────
check('exact default(4) accepts 3m', evaluateTrigger('exact', 3).ok === true);
check('exact default(4) rejects 6m', evaluateTrigger('exact', 6).ok === false);
check('radius default(40) accepts 35m', evaluateTrigger('radius', 35).ok === true);

// ── instant / locationless: always pass, no GPS needed ───────────────────────
check('instant passes with no distance', evaluateTrigger('instant', undefined).ok === true);
check('locationless passes with no distance', evaluateTrigger('locationless', undefined).ok === true);
check('instant passes even with a huge distance', evaluateTrigger('instant', 99999, 40).ok === true);

// ── radius/exact require a finite distance ───────────────────────────────────
check('radius without distance is not ok', evaluateTrigger('radius', undefined, 40).ok === false);

// ── normalizeTriggerMode: legacy mapping ─────────────────────────────────────
const located = { coordinates: { lat: 31.7, lng: 35.2 } } as Task;
const geofence = { type: 'geofence', coordinates: { lat: 31.7, lng: 35.2 } } as Task;
const locationless = { locationless: true, coordinates: { lat: 0, lng: 0 } } as Task;
const explicit = { triggerMode: 'exact', coordinates: { lat: 31.7, lng: 35.2 } } as Task;

check('legacy located task → radius', normalizeTriggerMode(located) === 'radius');
check('legacy geofence type → radius', normalizeTriggerMode(geofence) === 'radius');
check('locationless flag → locationless', normalizeTriggerMode(locationless) === 'locationless');
check('explicit triggerMode is respected', normalizeTriggerMode(explicit) === 'exact');

// invariant: locationless ⇔ 'locationless'
check('invariant: locationless task normalizes to locationless',
  normalizeTriggerMode(locationless) === 'locationless');

console.log(`\n${failures === 0 ? 'ALL TRIGGER-MODE TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
