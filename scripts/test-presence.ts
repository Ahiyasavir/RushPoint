// Pure-logic tests for the opt-in answer-task presence gate
// (change: quiz-location-verification). Validates the LENIENT 150m default,
// missing/invalid-GPS refusal, no-coordinates no-op, a custom finite radius
// override, and that the refusal reason leaks NO distance figure. No emulator.
//   npx tsx scripts/test-presence.ts
import {
  evaluatePresence,
  PRESENCE_DEFAULT_RADIUS_M,
  type GeoPoint,
} from '../packages/shared/src/index';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Jerusalem-ish anchor point for the answer task.
const coords: GeoPoint = { lat: 31.78, lng: 35.21 };

// A point ~90m north (1° lat ≈ 111.32km ⇒ 90m ≈ 0.00081°) — inside the 150m default.
const near = { lat: 31.78 + 0.0008, lng: 35.21 };
// A point ~1km away — well beyond the default.
const far = { lat: 32.10, lng: 34.85 };
// A point ~300m north — beyond the 150m default but inside a 500m override.
const mid = { lat: 31.78 + 0.0027, lng: 35.21 };

// ── default 150m radius ──────────────────────────────────────────────────────
check('default radius constant is 150', PRESENCE_DEFAULT_RADIUS_M === 150);
check('within 150m of coords → ok', evaluatePresence(coords, near).ok === true);

const farVerdict = evaluatePresence(coords, far);
check('~1km away → not ok', farVerdict.ok === false);
check('far reject reason contains NO distance digits',
  !!farVerdict.reason && !/\d/.test(farVerdict.reason), farVerdict.reason);

// ── missing / invalid submitted GPS is refused (no bypass by disabling GPS) ───
check('missing GPS → not ok', evaluatePresence(coords, {}).ok === false);
check('missing-GPS reason contains no distance digits',
  (() => { const v = evaluatePresence(coords, {}); return !!v.reason && !/\d/.test(v.reason); })());
check('NaN GPS → not ok', evaluatePresence(coords, { lat: NaN, lng: NaN }).ok === false);
check('out-of-range GPS → not ok', evaluatePresence(coords, { lat: 999, lng: 999 }).ok === false);

// ── task without valid coordinates is a no-op (never a lockout) ──────────────
check('undefined task coords → ok', evaluatePresence(undefined, far).ok === true);
check('invalid task coords → ok',
  evaluatePresence({ lat: 999, lng: 999 } as GeoPoint, far).ok === true);

// ── custom finite radius override ────────────────────────────────────────────
check('~300m rejected by the 150m default', evaluatePresence(coords, mid).ok === false);
check('~300m accepted by a 500m override', evaluatePresence(coords, mid, 500).ok === true);

// ── radiusM 0 / NaN falls back to the 150m default ───────────────────────────
check('radiusM=0 falls back to default (near passes)', evaluatePresence(coords, near, 0).ok === true);
check('radiusM=0 falls back to default (mid rejected)', evaluatePresence(coords, mid, 0).ok === false);
check('radiusM=NaN falls back to default (mid rejected)', evaluatePresence(coords, mid, NaN).ok === false);

console.log(`\n${failures === 0 ? 'ALL PRESENCE TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
