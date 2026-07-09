// Pure-logic tests for the live-launch welcome bug fix
// (change: fix-live-launch-demo-text). The welcome screen must derive an accurate
// GPS-requirement indicator from task trigger modes and never emit demo
// placeholder text. No emulator.
//   npx tsx scripts/test-promo-copy.ts
import {
  describeGameRequirements,
  selectGameDescription,
} from '../packages/shared/src/index';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const DEMO = 'דמו קצר שאפשר לשחק מכל מקום בלי GPS ובלי מפעיל. רק תלחצו ותתחילו!';

const gpsGame = {
  stages: [{ tasks: [{ triggerMode: 'radius', coordinates: { lat: 31.7, lng: 35.2 } }] }],
};
const exactGame = {
  stages: [{ tasks: [{ triggerMode: 'exact', coordinates: { lat: 31.7, lng: 35.2 } }] }],
};
const anywhereGame = {
  stages: [{ tasks: [{ triggerMode: 'instant' }, { triggerMode: 'locationless' }] }],
};
const legacyLocationless = {
  stages: [{ tasks: [{ locationless: true, coordinates: { lat: 0, lng: 0 } }] }],
};

// ── requirement derivation ───────────────────────────────────────────────────
check('radius task → gps', describeGameRequirements(gpsGame) === 'gps');
check('exact task → gps', describeGameRequirements(exactGame) === 'gps');
check('all instant/locationless → anywhere', describeGameRequirements(anywhereGame) === 'anywhere');
check('legacy locationless → anywhere', describeGameRequirements(legacyLocationless) === 'anywhere');

// ── never emits demo placeholder text ────────────────────────────────────────
check('result is only an enum key, never demo copy',
  ['gps', 'anywhere'].includes(describeGameRequirements(gpsGame)) &&
  describeGameRequirements(gpsGame) !== DEMO);

// ── blank-description handling (no demo fallback) ────────────────────────────
check('blank description → empty string', selectGameDescription({ description: '   ' }) === '');
check('missing description → empty string', selectGameDescription({}) === '');
check('real description is passed through', selectGameDescription({ description: 'מסע מגניב' }) === 'מסע מגניב');

console.log(`\n${failures === 0 ? 'ALL PROMO-COPY TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
