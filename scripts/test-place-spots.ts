// Places asked once, named, and pinned for the creator (change: place-setup-named-spots). Ahiya, 3.11:
// "not every time again לכו ל...", "if you already wrote it in the first part of the stage, why again in
// every mission", "ask a location for every place, several forests, several parks, and you put the
// missions in", "a name for every place, and לכו ל... with the name", "an option for סניף", and
// "remember these locations".
import type { Game, Stage, Task, TemplateWizardStep } from '../packages/shared/src/types';
import { normalizePlaceSpots, memorablePlaceSpots } from '../packages/shared/src/placeSpots';
import {
  placeTo, goLine, applyPlaceLines, applySpots, placedKinds, ringPoint, type PlaceWords,
} from '../apps/creator-web/src/lib/placeSpots';
import { AREA_KIND_TAG_IDS, AREA_SETTING } from '../apps/creator-web/src/bankTags';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { placeWordsOf } from '../apps/creator-web/src/i18n';
import { buildSetupBeats, buildSetupScreens } from '../apps/creator-web/src/lib/setupFlow';
import { composeGame, seededRng } from '../apps/creator-web/src/lib/composeGame';
import { initialSmartBuildState, smartBuildAnswers } from '../apps/creator-web/src/lib/smartBuildWizard';

let failed = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failed++; };

const he: PlaceWords = placeWordsOf('he');
const en: PlaceWords = placeWordsOf('en');
const both = [he, en];

// ── Forms ────────────────────────────────────────────────────────────────────
ok(placeTo(he, 'forest') === 'ליער', 'a kind reads as Hebrew writes it');
ok(placeTo(he, 'park', 'פארק הירקון') === 'לפארק הירקון', 'a name takes the prefix');
ok(placeTo(he, 'branch', 'הסניף שלנו') === 'לסניף שלנו', 'a name starting with ה drops it after the prefix');
ok(placeTo(he, 'park', 'Yarkon') === 'אל Yarkon', 'a name in other letters gets a separate word');
ok(placeTo(en, 'park', 'Yarkon Park') === 'to Yarkon Park', 'English names');
ok(placeTo(he, 'home') === 'הביתה', 'home is irregular');
const four = new Set([0, 1, 2, 3].map((v) => goLine(he, 'park', undefined, v)));
ok(four.size === 4 && [...four][0] === 'לכו לפארק.', `the line rotates through four forms (${[...four].join(' | ')})`);
ok(goLine(he, 'park', 'פארק הירקון', 1) === 'תגיעו לפארק הירקון.', 'the line uses the name');

// ── Branch ───────────────────────────────────────────────────────────────────
ok((AREA_KIND_TAG_IDS as readonly string[]).includes('branch'), 'סניף is a place');
ok(AREA_SETTING.branch === 'outdoor', 'a branch has a setting');
ok(placeTo(he, 'branch') === 'לסניף', 'סניף reads in Hebrew');
const school = TASK_BANK.filter((e) => e.tags.includes('school'));
ok(school.length > 0 && school.every((e) => (e.tags as readonly string[]).includes('branch')), `every school mission fits a branch (${school.length})`);

// ── Lines on stages ──────────────────────────────────────────────────────────
let n = 0;
const task = (placeTrack?: string, extra: Partial<Task> = {}): Task => ({ id: `t${++n}`, title: `m${n}`, description: 'עשו משהו.', type: 'self_report', placeTrack, coordinates: { lat: 0, lng: 0 }, ...extra } as Task);
const stage = (tasks: Task[], extra: Partial<Stage> = {}): Stage => ({ id: `s${++n}`, order: 0, title: '', tasks, ...extra });
const gameOf = (stages: Stage[]): Game => ({ id: 'g', title: 'x', stages: stages.map((s, i) => ({ ...s, order: i })) } as unknown as Game);
const intro = (s: Stage) => s.narrative?.intro?.body ?? '';

const g1 = applyPlaceLines(gameOf([
  stage([task('park'), task('park')]),
  stage([task('park'), task('park')]),
  stage([task('forest'), task('forest')]),
  stage([task('park')]),
]), both, []);
ok(intro(g1.stages[0]) === 'לכו לפארק.', 'the first stage opens with the line');
ok(intro(g1.stages[1]) === '', 'a stage in the same place says nothing');
ok(intro(g1.stages[2]) === 'תגיעו ליער.', 'a new place gets the next form');
ok(intro(g1.stages[3]) === 'ממשיכים לפארק.', 'and back again, a third form');
ok(g1.stages.every((s) => s.tasks.every((t) => t.description === 'עשו משהו.')), 'no mission repeats the place');

const one = applyPlaceLines(gameOf([stage([task('park')]), stage([task('park')])]), both, []);
ok(one.stages.every((s) => intro(s) === ''), 'a game in one place needs no line');

const own = applyPlaceLines(gameOf([stage([task('park')], { narrative: { intro: { body: 'סיפור שלי' } } }), stage([task('forest')])]), both, []);
ok(intro(own.stages[0]) === 'סיפור שלי', 'the creator\'s own opening is never touched');

const tracks = applyPlaceLines(gameOf([stage([task('park'), task('park'), task('forest'), task('forest')])]), both, []);
const tt = tracks.stages[0].tasks;
ok(tt[0].description.startsWith('לכו לפארק.') && tt[1].description.startsWith('תגיעו לפארק.'), 'a two-set stage keeps a line per mission, rotating');
ok(tt[2].description.startsWith('לכו ליער.'), 'each set names its own place');
ok(intro(tracks.stages[0]) === '', 'a two-set stage has no single place to open with');
const again = applyPlaceLines(tracks, both, []);
ok(again.stages[0].tasks[0].description === tt[0].description, 'running it twice changes nothing');

// ── Spots, names, pins ───────────────────────────────────────────────────────
const placed = (id: string): TemplateWizardStep => ({ id: `qs-${id}-placed-coordinates`, stageId: '', taskId: id, targetFieldPath: 'coordinates', instructionPrompt: '', isRequired: true });
const base = gameOf([
  stage([task('park'), task('park')]),
  stage([task('forest')]),
  stage([task('park'), task('park', { coordinates: { lat: 5, lng: 5 } })]),
]);
const steps: TemplateWizardStep[] = [];
base.stages.forEach((s) => s.tasks.forEach((t, i) => { if (!(s.order === 2 && i === 1)) steps.push({ ...placed(t.id), stageId: s.id }); }));
ok(placedKinds(base, steps).join() === 'park,forest', 'one question per place, in the order they come');

const spots = [
  { id: 'a', kind: 'park', name: 'פארק הירקון', lat: 32.1, lng: 34.8 },
  { id: 'b', kind: 'park', name: 'גן מאיר', lat: 32.07, lng: 34.77 },
  { id: 'c', kind: 'forest', name: '', lat: 31.8, lng: 35.1 },
];
const done = applySpots(base, steps, spots, both);
const near = (t: Task, s: { lat: number; lng: number }) => Math.abs(t.coordinates!.lat - s.lat) < 0.001 && Math.abs(t.coordinates!.lng - s.lng) < 0.001;
ok(done.stages[0].tasks.every((t) => near(t, spots[0])), 'the first park stage is pinned at the first park');
ok(done.stages[2].tasks[0] && near(done.stages[2].tasks[0], spots[1]), 'the next park stage takes the next park');
ok(done.stages[2].tasks[1].coordinates!.lat === 5, 'a pin the walk does not own is left alone');
ok(done.stages[0].tasks[0].coordinates!.lat !== done.stages[0].tasks[1].coordinates!.lat
  || done.stages[0].tasks[0].coordinates!.lng !== done.stages[0].tasks[1].coordinates!.lng, 'two missions at one spot do not stack');
ok(intro(done.stages[0]) === 'לכו לפארק הירקון.', 'the line says the name');
ok(intro(done.stages[1]) === 'תגיעו ליער.', 'an unnamed spot keeps the kind');
ok(intro(done.stages[2]) === 'ממשיכים לגן מאיר.', 'two parks are two places');
ok(Array.isArray(done.placeSpots) && done.placeSpots.length === 3, 'the spots are kept on the game');
const renamed = applySpots(done, steps, [{ ...spots[0], name: 'הירקון' }, spots[1], spots[2]], both);
ok(intro(renamed.stages[0]) === 'לכו לירקון.', 'renaming rewrites the line');
const d = ringPoint({ lat: 32, lng: 35 }, 1, 3);
const meters = Math.hypot((d.lat - 32) * 111320, (d.lng - 35) * 111320 * Math.cos(32 * Math.PI / 180));
ok(meters > 8 && meters < 16, `a ring pin sits about 12 m from the spot (${meters.toFixed(1)})`);
ok(ringPoint({ lat: 32, lng: 35 }, 0, 1).lat === 32, 'a lone mission sits on the spot');

// ── The walk ─────────────────────────────────────────────────────────────────
const screens = buildSetupScreens(base, steps, 'he');
const beatsBefore = buildSetupBeats(screens, base);
ok(beatsBefore.filter((b) => b.kind === 'places').length === 2, 'the walk asks once per place');
ok(beatsBefore[1]?.kind === 'places', 'right after the plan');
const beatsAfter = buildSetupBeats(buildSetupScreens(done, steps, 'he'), done);
const mapItems = (bs: typeof beatsAfter, sc: ReturnType<typeof buildSetupScreens>) => bs.filter((b) => b.kind === 'item' && sc[b.screen].items[b.item].fieldPath === 'coordinates').length;
ok(mapItems(beatsBefore, screens) === 4 && mapItems(beatsAfter, buildSetupScreens(done, steps, 'he')) === 0, 'once a place has spots, its missions need no map screen of their own');

// ── Stored on the game ───────────────────────────────────────────────────────
ok(normalizePlaceSpots(spots)?.length === 3, 'valid spots pass');
ok(normalizePlaceSpots([]) !== null && normalizePlaceSpots([])!.length === 0, 'an empty list clears');
ok(normalizePlaceSpots([{ id: 'a', kind: 'park', name: 'x', lat: 200, lng: 0 }]) === null, 'a point off the globe is refused');
ok(normalizePlaceSpots([{ id: 'a', kind: '<b>', name: 'x', lat: 1, lng: 1 }]) === null, 'a kind is a plain word');
ok(normalizePlaceSpots([{ id: 'a', kind: 'park', name: 'x'.repeat(61), lat: 1, lng: 1 }]) === null, 'a name is short');
ok(normalizePlaceSpots(Array.from({ length: 41 }, (_, i) => ({ id: `${i}`, kind: 'park', name: '', lat: 1, lng: 1 }))) === null, 'at most 40 spots');
ok(normalizePlaceSpots([{ id: 'a', kind: 'park', name: '  גן  ', lat: 1, lng: 1 }])![0].name === 'גן', 'names are trimmed');
ok(normalizePlaceSpots('x') === null, 'not a list');
ok(memorablePlaceSpots([...spots, { id: 'h', kind: 'home', name: 'אצלנו', lat: 1, lng: 1 }]).every((s) => s.kind !== 'home'), 'a home is never remembered');

// ── The composer ─────────────────────────────────────────────────────────────
const copy = { placeMissionPrompt: () => 'pin', goToPlace: () => '', placeMissionAt: (a: string) => `AT:${a}`, placeWords: () => both } as never;
let games = 0; let unplaced = 0; let repeated = 0;
for (let seed = 1; seed <= 20; seed++) {
  const a = { ...smartBuildAnswers(initialSmartBuildState()), areas: ['park', 'forest'], prepEffort: 2, locationMissions: true, people: 10 } as never;
  const r = composeGame(TASK_BANK, a, copy, seededRng(seed * 31));
  if (!r) continue;
  games++;
  for (const s of r.stages) {
    for (const t of s.tasks) if (!t.placeTrack) unplaced++;
    if (s.tasks.some((t) => /^(לכו|תגיעו|ממשיכים)/.test(t.description ?? '')) && !s.tasks.some((t, i, all) => all.some((o) => o.placeTrack !== t.placeTrack))) repeated++;
  }
}
ok(games > 10, `composed games (${games})`);
ok(unplaced === 0, `every mission of a placed game knows its place (${unplaced})`);
ok(repeated === 0, `no one-place stage repeats the line per mission (${repeated})`);

process.exit(failed ? 1 : 0);
