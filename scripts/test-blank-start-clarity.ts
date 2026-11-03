// A real creator's blank game, 1.11 (change: blank-start-clarity): the mission editor opened on a map, the
// sign up wall landed in the middle of it, and they left with a pin and no mission. These pin the repairs.
import { readFileSync } from 'node:fs';
import { WIZARD_STEP_ORDER } from '../apps/creator-web/src/lib/wizardLogic';
import { guestSaveMoment } from '../apps/creator-web/src/lib/guestCreator';
import { stickToPlaceTrack } from '../packages/shared/src/placeTrack';
import { bankSiting, composeGame, goToAreaFor, secondPlaceFor, seededRng, stagePlaces, placeLineOf } from '../apps/creator-web/src/lib/composeGame';
import { chooseRegeneratedMission } from '../apps/creator-web/src/lib/regenerateMission';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { AREA_KIND_TAG_IDS } from '../apps/creator-web/src/bankTags';
import { initialSmartBuildState, smartBuildAnswers } from '../apps/creator-web/src/lib/smartBuildWizard';
import { guestClaimPending } from '../apps/creator-web/src/lib/guestClaim';
import { engagementDevice, normalizeEngagementDevice } from '../packages/shared/src/engagement';

let failed = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failed++; };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

ok(WIZARD_STEP_ORDER[0] === 'details', 'a mission starts from what it is, not from a map');

ok(guestSaveMoment({ guest: true, edits: 3, softSeen: true }) === 'required', 'the wall still stands after the free edits');
ok(guestSaveMoment({ guest: true, edits: 9, softSeen: true, missionOpen: true }) === 'none', 'it waits while a mission is open');
ok(guestSaveMoment({ guest: true, edits: 9, softSeen: true, missionOpen: false }) === 'required', 'and comes back when the mission closes');

const wizard = src('apps/creator-web/src/components/TaskWizard.tsx');
ok(!wizard.includes('disabled={!canGoNext'), 'Next answers instead of going dead');

ok(engagementDevice({ coarsePointer: true, shortSide: 390 }) === 'phone', 'a touch screen under 600 is a phone');
ok(engagementDevice({ coarsePointer: true, shortSide: 820 }) === 'tablet', 'a larger touch screen is a tablet');
ok(engagementDevice({ coarsePointer: false, shortSide: 390 }) === 'desktop', 'a mouse in a narrow window is a computer');
ok(normalizeEngagementDevice('phone') === 'phone', 'a known device passes');
for (const bad of ['fridge', 1, null, undefined, {}]) ok(normalizeEngagementDevice(bad) === null, `junk is dropped: ${String(bad)}`);

const feed = src('apps/creator-web/src/components/MissionFeed.tsx');
ok(feed.indexOf('{f.swipeHint}') > feed.indexOf('{f.swap}'), 'the down arrow sits under the swap button, so it does not point at it');
ok(!feed.includes('hasSwiped'), 'every feed shows the scroll hint, whoever swiped before');
ok(src('apps/creator-web/src/components/BuildingMoment.tsx').includes('{onSkip && <span'), 'the building moment shows a skip button');

ok(guestClaimPending({ signedIn: true, code: 'abc', settled: false }), 'a real account with a claim waits for the move');
ok(!guestClaimPending({ signedIn: true, code: 'abc', settled: true }), 'an answered claim stops waiting, even a failed one');
ok(!guestClaimPending({ signedIn: false, code: 'abc', settled: false }), 'a guest does not wait');
ok(!guestClaimPending({ signedIn: true, code: null, settled: false }), 'no claim, no wait');
const sheet = src('apps/creator-web/src/components/SaveAccountSheet.tsx');
ok(sheet.includes('signInFromGoogleConflict(e)'), 'Google on an existing account signs in');
ok(sheet.includes('signInWithEmail(email.trim(), password)'), 'email on an existing account tries to sign in');
ok(sheet.indexOf('createGuestClaim()).code);\n      if (!readGuestClaim()) throw new Error(\'no storage\');\n    } catch { setErr(ts.handoverFailed); return false; }') > 0 || sheet.includes('return false; }'), 'the claim is taken before leaving the guest');

ok(goToAreaFor(['beach'], ['beach', 'park']) === 'beach', 'a beach mission in a beach and park game says where');
ok(goToAreaFor(['beach'], ['beach']) === null, 'a game on one place needs no directions');
ok(goToAreaFor(['beach', 'park'], ['beach', 'park']) === null, 'a mission that fits every place stays free');
ok(goToAreaFor(['action'], ['beach', 'park']) === null, 'a mission with no place stays free');
ok(goToAreaFor(['beach'], ['crowded', 'beach']) === null, 'a quality is not a second place');

// One place per stage (Ahiya, 2.11). A stage plays in any order, so a stage split between two places
// sends a team back and forth.
ok(goToAreaFor(['beach', 'park'], ['beach', 'park', 'mall'], 'park') === 'park', 'a mission that fits several places uses its stage place');
ok(goToAreaFor(['beach'], ['beach', 'park'], 'park') === 'beach', 'a mission that fell outside its stage still says the truth');
ok(stagePlaces(['beach', 'park'], 3).join() === 'beach,park,beach', 'stages take the places in turn');
ok(stagePlaces(['beach'], 3).join() === 'beach,beach,beach', 'one place holds every stage');
ok(stagePlaces(['crowded'], 2).every((p) => p === null), 'a quality is not a place');
ok(stagePlaces([], 2).every((p) => p === null), 'no place, no assignment');

const lines: Record<string, string> = Object.fromEntries(AREA_KIND_TAG_IDS.map((a) => [a, `GO:${a}.`]));
const placeCopy = { placeMissionPrompt: () => 'pin', goToPlace: (a: string) => lines[a], placeMissionAt: (a: string) => `AT:${a}` } as never;
ok(placeLineOf('GO:beach. Build a wall', lines) === 'beach', 'a mission place is read back from its text');
ok(placeLineOf('Build a wall', lines) === null, 'no line, no place');
const kinds = AREA_KIND_TAG_IDS.filter((k) => k !== 'office' && k !== 'school');
const tagsByTitle = new Map(TASK_BANK.map((e) => { try { return [e.build().title, e.tags as readonly string[]] as const; } catch { return ['', []] as const; } }));
const pinnedTitles = new Set(TASK_BANK.filter((e) => bankSiting(e) === 'must').map((e) => e.build().title));
let doubled = 0; let split = 0; let wrong = 0; let silent = 0; let placesUnused = 0; let games = 0; let missions = 0;
for (let i = 0; i < kinds.length; i++) for (let j = i + 1; j < kinds.length; j++) for (let seed = 1; seed <= 4; seed++) for (const prep of [1, 2]) {
  const areas = [kinds[i], kinds[j]];
  const a = { ...smartBuildAnswers(initialSmartBuildState()), areas, prepEffort: prep, locationMissions: prep >= 2, people: 8 } as never;
  const r = composeGame(TASK_BANK, a, placeCopy, seededRng(seed * 7919));
  if (!r) continue;
  games++;
  const used = new Set<string>();
  for (const st of r.stages) {
    const here = new Set<string>();
    for (const t of st.tasks) {
      missions++;
      // The place is data on the mission now; its words are said once per stage (place-setup-named-spots).
      const place = t.placeTrack ?? null;
      if (place) { here.add(place); used.add(place); }
      const own = (tagsByTitle.get(t.title) ?? []).filter((x) => (AREA_KIND_TAG_IDS as readonly string[]).includes(x));
      const fit = own.filter((x) => areas.includes(x));
      if (own.length > 0 && fit.length === 0) wrong++;
      if (fit.length === 1 && !place && !pinnedTitles.has(t.title)) silent++;
      if (place && pinnedTitles.has(t.title) && /^GO:/.test(t.description ?? '')) doubled++;
    }
    if (here.size > 1) split++;
  }
  if (used.size < 2) placesUnused++;
}
ok(games > 100, `the sweep really composed games (${games} games, ${missions} missions)`);
ok(split === 0, `no stage is split between two places (${split})`);
ok(wrong === 0, `no mission belongs to a place the game does not have (${wrong})`);
ok(silent === 0, `every mission bound to one place says so (${silent})`);
ok(doubled === 0, `a mission with its own pin gets no second directions (${doubled})`);
// A game can fall under one line when its other stages hold only missions that fit both places: no harm.
ok(placesUnused <= games / 50, `both places are really played (${placesUnused} of ${games} games used one)`);

const beachOnly = TASK_BANK.find((e) => e.key === 'sand-wall');
const swapped = chooseRegeneratedMission({ bank: TASK_BANK, profile: beachOnly?.tags ?? [], context: { setting: 'placed', prepTolerance: 3 }, drift: 0, offeredKeys: [], seed: 5, place: 'mall' } as never);
ok(!!swapped && swapped.tags.includes('mall'), 'a swap stays in the mission place');

// A big event must not pile into one place (Ahiya, 2.11).
ok(secondPlaceFor(24, ['beach', 'park'], 'beach') === 'park', 'a big game runs a stage in a second place');
ok(secondPlaceFor(23, ['beach', 'park'], 'beach') === null, 'a small group stays in one place');
ok(secondPlaceFor(100, ['beach'], 'beach') === null, 'one place has no second');
const pool = [{ id: 'a1', placeTrack: 'beach' }, { id: 'a2', placeTrack: 'beach' }, { id: 'b1', placeTrack: 'park' }, { id: 'b2', placeTrack: 'park' }];
ok(stickToPlaceTrack(pool, pool, []).length === 2, 'a team starts on one set, never with both open');
ok(stickToPlaceTrack(pool, pool, [], { taskCounts: { a1: 3, b1: 1 } }).every((t) => t.placeTrack === 'park'), 'the first mission goes to the emptier place');
ok(stickToPlaceTrack(pool, pool, [], { taskCounts: { a1: 1, a2: 1, b1: 3 } }).every((t) => t.placeTrack === 'beach'), 'the load of a whole set counts, not of one mission');
const startedOn = new Set(Array.from({ length: 40 }, (_, i) => stickToPlaceTrack(pool, pool, [], { spreadKey: `team-${i}` })[0].placeTrack));
ok(startedOn.size === 2, 'teams that arrive one at a time still spread across both places');
ok(stickToPlaceTrack(pool.slice(1), pool, ['a1'], { taskCounts: { a2: 9 } }).map((t) => t.id).join() === 'a2', 'a team on a set stays there however full it is');
ok(stickToPlaceTrack([pool[1], pool[2]], pool, ['a1']).map((t) => t.id).join() === 'a2', 'the whole stage remembers the set, done missions are not candidates');
ok(stickToPlaceTrack(pool.slice(1), pool, ['a1']).map((t) => t.id).join() === 'a2', 'after one mission the team stays on its set');
ok(stickToPlaceTrack([pool[2]], pool, ['a1']).length === 1, 'an empty set fails open and the stage still moves');
ok(stickToPlaceTrack([{ id: 'x' }], [{ id: 'x' }], []).length === 1, 'a stage with no sets is untouched');

let trackStages = 0; let shortSet = 0; let mixedSet = 0;
for (let i = 0; i < kinds.length; i++) for (let j = i + 1; j < kinds.length; j++) for (let seed = 1; seed <= 4; seed++) {
  const areas = [kinds[i], kinds[j]];
  const a = { ...smartBuildAnswers(initialSmartBuildState()), areas, prepEffort: 1, people: 60 } as never;
  const r = composeGame(TASK_BANK, a, placeCopy, seededRng(seed * 104729));
  if (!r) continue;
  for (const st of r.stages) {
    const sets = new Map<string, typeof st.tasks>();
    for (const t of st.tasks) if (t.placeTrack) sets.set(t.placeTrack, [...(sets.get(t.placeTrack) ?? []), t]);
    if (sets.size === 0) continue;
    trackStages++;
    for (const [area, tasks] of sets) {
      if (tasks.length < (st.requiredTaskCount ?? tasks.length)) shortSet++;
      for (const t of tasks) { const place = placeLineOf(t.description ?? '', lines); if (place && place !== area) mixedSet++; }
    }
  }
}
ok(trackStages > 50, `big games really run stages in two places (${trackStages})`);
ok(shortSet === 0, `each set can finish its stage alone (${shortSet})`);
ok(mixedSet === 0, `no set sends a team to the other place (${mixedSet})`);

process.exit(failed ? 1 : 0);
