// A mission asks for a place only when its action really happens at one (Ahiya, 27.10).
//
// "בדיוק מאה" (find written numbers in the street) and "פנטומימה לזר" (mime a film to a stranger)
// were tagged fromAnywhere but carried no `siting`, so `bankSiting` read them as `possible`, and in a
// located game the composer pinned them: Quick Setup asked the creator to drop a pin, the task became
// `triggerMode: 'radius'` with the 40 m default, and the server proximity-checked a mission that can
// be played on any street. His rule: if the action does not happen at a specific spot, the mission is
// playable from anywhere; if a location is really wanted, its radius is very large.
//
// So:
//   • `never`    — the default for a play-anywhere mission. No pin, ever.
//   • `possible` — only when a KIND of spot helps (open grass for a pyramid, a bench for a scene),
//                  which it must declare as `spot`, and then the pin is a loose meeting area of at
//                  least LOOSE_PIN_FLOOR_M, never a 40 m check-in.
//   • `must`     — tied to a place by nature (a station, a hidden code, a navigation puzzle, a
//                  riddle about this place). Each one is declared below; a new one fails until a
//                  person has looked at it.
import { TASK_BANK, AREA_PIN_RADIUS_M } from '../apps/creator-web/src/taskBank';
import { bankSiting } from '../apps/creator-web/src/lib/composeGame';

let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
}

/** The smallest radius a pin on a play-anywhere mission may have, in metres. */
const LOOSE_PIN_FLOOR_M = 300;

/** Missions whose action happens at a specific spot. Reviewed one by one on 27.10. */
const PLACE_BOUND = new Set([
  // start and finish points
  'youth-start-point', 'youth-finish-point',
  // navigation puzzles: finding the place IS the mission
  'youth-find-place-one', 'youth-emoji-riddle', 'photo-vantage-point', 'human-gps',
  'corporate-landmark-navigate', 'hand-drawn-map', 'satellite-x', 'kid-drawing', 'pirate-map',
  // stations, people and objects planted at the spot
  'the-hidden-key', 'vendor-secret-code', 'passphrase-handoff', 'chalk-code', 'color-code-trail',
  'odd-one-planted', 'cache-swap', 'agent-in-crowd', 'five-objects', 'dead-drop', 'rolling-challenge',
  // riddles and counts about THIS place
  'exact-count', 'sign-cipher', 'how-many-steps', 'guess-the-height', 'kims-game',
  'the-combination-lock', 'tiny-detail', 'sign-word-cipher', 'common-thread',
  'street-order', 'then-and-here', 'scytale', 'empty-square',
  // a physical thing that is there: a cairn, a record board, a bar, an elevator, a wall of notes
  'cairn-record', 'record-board', 'team-pull-ups', 'elevator-race', 'highest-note',
]);

const rows = TASK_BANK.map((e) => ({ e, t: e.build(), siting: bankSiting(e) }));
const by = (key: string) => rows.find((r) => r.e.key === key);

console.log('\nthe two missions Ahiya named are playable from anywhere');
for (const key of ['sum-to-hundred', 'stranger-charades']) {
  const r = by(key);
  ok(`${key} is in the bank`, !!r);
  if (!r) continue;
  ok(`${key} is built locationless`, r.t.locationless === true && r.t.triggerMode === 'locationless', { locationless: r.t.locationless, triggerMode: r.t.triggerMode });
  ok(`${key} is never given a pin by the composer`, r.siting === 'never', r.siting);
}

console.log('\na play-anywhere mission is pinned only loosely, and only with a reason');
const possible = rows.filter((r) => r.siting === 'possible');
ok(`counted the pinnable play-anywhere missions (${possible.length} of ${rows.length})`, true);
const noSpot = possible.filter((r) => !(r.e as { spot?: string }).spot).map((r) => r.e.key);
ok('every pinnable one names the kind of spot that helps it', noSpot.length === 0, noSpot);
const tight = possible
  .filter((r) => !(typeof r.t.geofenceRadiusMeters === 'number' && r.t.geofenceRadiusMeters >= LOOSE_PIN_FLOOR_M))
  .map((r) => `${r.e.key}:${r.t.geofenceRadiusMeters ?? 'default 40'}`);
ok(`every pinnable one carries a radius of at least ${LOOSE_PIN_FLOOR_M} m`, tight.length === 0, tight);
const strangers = possible.filter((r) => r.e.tags.includes('strangers')).map((r) => r.e.key);
ok('no mission about strangers asks for a pin (strangers are wherever people are)', strangers.length === 0, strangers);

console.log('\na mission tied to a place is one a person looked at');
const must = rows.filter((r) => r.siting === 'must');
ok(`counted the place-bound missions (${must.length})`, true);
const unreviewed = must.filter((r) => !PLACE_BOUND.has(r.e.key)).map((r) => r.e.key);
ok('every place-bound mission is declared', unreviewed.length === 0, unreviewed);
const stale = [...PLACE_BOUND].filter((k) => by(k)?.siting !== 'must');
ok('no declared place-bound mission is stale', stale.length === 0, stale);
const mustLocationless = must.filter((r) => r.t.locationless === true).map((r) => r.e.key);
ok('a place-bound mission is built with a location', mustLocationless.length === 0, mustLocationless);

// 28.10: a place-bound mission that happens over an AREA (a street of signs, things hidden around a
// spot, a square) marks the area, so its arrival radius is AREA_PIN_RADIUS_M, not the 40 m doorstep.
const AREA_MISSIONS = ['sign-cipher', 'how-many-steps', 'the-combination-lock', 'color-code-trail', 'tiny-detail',
  'exact-count', 'street-order', 'agent-in-crowd', 'odd-one-planted', 'pirate-map'];
const narrowArea = AREA_MISSIONS.filter((k) => !((by(k)?.t.geofenceRadiusMeters ?? 0) >= AREA_PIN_RADIUS_M));
ok(`every area mission arrives within ${AREA_PIN_RADIUS_M} m`, narrowArea.length === 0, narrowArea);

console.log('\na mission that never gets a pin is built locationless');
const neverLocated = rows.filter((r) => r.siting === 'never' && r.t.locationless !== true).map((r) => r.e.key);
ok('every never mission is built locationless', neverLocated.length === 0, neverLocated);

console.log(failures === 0 ? '\n✅ bank location fit: ALL PASS' : `\n❌ bank location fit: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
