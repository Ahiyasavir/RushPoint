// Pure-logic tests for the "navigate here" hand-off (change: play-navigate-handoff).
//
// The hand-off itself is two <a> tags. The part worth testing is the SUPPRESSION
// rule, because getting it wrong breaks a game mechanic rather than a pixel:
//
//   For a hidden-location (treasure-hunt) task, THE COORDINATES ARE THE ANSWER.
//   The server strips them while the spot is sealed, and re-releases them only
//   after arrival so the map can pin where you already stand. A client that
//   turns those released coordinates into a "navigate here" button hands the
//   player the solution to the puzzle they are playing.
//
// So navigationTarget() refuses on `locationHidden` EXPLICITLY — not by relying
// on where TaskRunner happens to render the badge today — and fails CLOSED:
// anything it does not positively recognise as a released, valid, non-hidden
// coordinate pair returns null.
//
//   npx tsx scripts/test-navigate-handoff.ts
import { navigationTarget, wazeUrl, googleMapsUrl } from '../apps/play-web/src/lib/navigateTo';
import { translations as playT } from '../apps/play-web/src/i18n';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const REAL = { lat: 31.7767, lng: 35.2345 }; // Jerusalem, the original Race to Tzion ground

// ── 1. SUPPRESSION — the security half ────────────────────────────────────────

// THE case. A hidden task that has ALREADY been arrived at really does carry
// coordinates (the server releases them post-arrival, on purpose). Suppression
// must therefore come from the flag, not from the absence of data.
check('a REVEALED hidden-location task with real coordinates is refused',
  navigationTarget({ locationHidden: true, coordinates: REAL }) === null);
check('a hidden-location task cannot be bypassed via smart.stationCoords',
  navigationTarget({ locationHidden: true, smart: { stationCoords: REAL } }) === null);

check('a SEALED task (arrival still pending) is refused',
  navigationTarget({ arrivalPending: true, coordinates: REAL }) === null);
check('arrival-pending wins even without the hidden flag',
  navigationTarget({ arrivalPending: true, smart: { stationCoords: REAL } }) === null);

check('a locationless task is refused',
  navigationTarget({ locationless: true, coordinates: REAL }) === null);

check('a task with no coordinates at all is refused', navigationTarget({}) === null);
check('an explicitly undefined coordinates field is refused',
  navigationTarget({ coordinates: undefined }) === null);

check('NaN latitude is refused',
  navigationTarget({ coordinates: { lat: Number.NaN, lng: 35.2 } }) === null);
check('Infinite longitude is refused',
  navigationTarget({ coordinates: { lat: 31.7, lng: Number.POSITIVE_INFINITY } }) === null);
check('a stringy latitude is refused (wrong type, not just wrong value)',
  navigationTarget({ coordinates: { lat: '31.7' as unknown as number, lng: 35.2 } }) === null);
check('null island (0,0) is refused',
  navigationTarget({ coordinates: { lat: 0, lng: 0 } }) === null);

// Totality: this runs during render.
check('a null task is refused without throwing', navigationTarget(null) === null);
check('an undefined task is refused without throwing', navigationTarget(undefined) === null);

// ── 2. ALLOWED — an ordinary located task ─────────────────────────────────────
const plain = navigationTarget({ coordinates: REAL });
check('an ordinary located task yields its coordinates',
  plain !== null && plain.lat === REAL.lat && plain.lng === REAL.lng);

const station = navigationTarget({
  coordinates: REAL,
  smart: { stationCoords: { lat: 32.0853, lng: 34.7818 } },
});
check('smart.stationCoords wins over the task coordinates',
  station !== null && station.lat === 32.0853 && station.lng === 34.7818);

// Only the (0,0) PAIR is the sentinel; a single zero axis is a real place.
const zeroLat = navigationTarget({ coordinates: { lat: 0, lng: 35.2 } });
check('a zero latitude alone is still a real place', zeroLat !== null && zeroLat.lng === 35.2);
const zeroLng = navigationTarget({ coordinates: { lat: 31.7, lng: 0 } });
check('a zero longitude alone is still a real place', zeroLng !== null && zeroLng.lat === 31.7);

const south = navigationTarget({ coordinates: { lat: -33.8688, lng: 151.2093 } });
check('negative coordinates round-trip unchanged',
  south !== null && south.lat === -33.8688 && south.lng === 151.2093);

check('a non-hidden task that is merely NOT flagged hidden is allowed',
  navigationTarget({ locationHidden: false, arrivalPending: false, locationless: false, coordinates: REAL }) !== null);

// ── 3. URLs ───────────────────────────────────────────────────────────────────
const w = wazeUrl(REAL);
const g = googleMapsUrl(REAL);
check('the Waze link carries both coordinates',
  w.includes('31.7767') && w.includes('35.2345'));
check('the Waze link asks for navigation', w.includes('navigate=yes'));
check('the Waze link is https', w.startsWith('https://'));
check('the Google Maps link carries both coordinates as its destination',
  g.includes('destination=31.7767,35.2345'));
check('the Google Maps link asks for walking directions', g.includes('travelmode=walking'));
check('the Google Maps link is https', g.startsWith('https://'));

// LEAK GUARD: the builders take a NavTarget, never a task, so no title / clue /
// hint / answer can reach a third-party URL. Encoded here so a future signature
// change that starts passing the task in fails loudly instead of silently.
const secretish = {
  title: 'SECRET-TITLE',
  locationClue: 'SECRET-CLUE',
  hint: 'SECRET-HINT',
  answers: ['SECRET-ANSWER'],
  coordinates: REAL,
};
const target = navigationTarget(secretish)!;
const urls = `${wazeUrl(target)} ${googleMapsUrl(target)}`;
for (const secret of ['SECRET-TITLE', 'SECRET-CLUE', 'SECRET-HINT', 'SECRET-ANSWER']) {
  check(`no ${secret} reaches a navigation URL`, !urls.includes(secret));
}
check('the resolved target object carries ONLY lat and lng',
  Object.keys(target).sort().join(',') === 'lat,lng');

// ── 4. Dictionary cross-check ─────────────────────────────────────────────────
const HEBREW = /[֐-׿]/;
for (const key of ['navigateHere', 'navigateMaps', 'navigateAria'] as const) {
  const he = playT.he.task[key];
  const en = playT.en.task[key];
  check(`t.task.${key} exists in HE`, typeof he === 'string' && he.length > 0);
  check(`t.task.${key} exists in EN`, typeof en === 'string' && en.length > 0);
  check(`t.task.${key} HE is really Hebrew`, typeof he === 'string' && HEBREW.test(he));
  check(`t.task.${key} EN carries no Hebrew`, typeof en === 'string' && !HEBREW.test(en));
}

console.log(`\n${failures === 0 ? 'ALL NAVIGATE-HANDOFF TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
