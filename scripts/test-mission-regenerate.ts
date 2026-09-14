// "Give me another one like this" — the mission regenerate algorithm
// (change: mission-regenerate).
//
// The whole decision is pure: a profile derived from the outgoing task, a
// similarity score against the bank's own tag vocabulary, a drift model that
// widens on repeated presses, and a merge that produces the replacement task.
// Nothing here needs a DOM, a clock, storage, or a stubbed Math.random — the
// chooser takes a seed, which is what makes every scenario below assertable.
//
// Fixture banks are hand-built rather than drawn from taskBank.ts on purpose: a
// scoring assertion that reads the real bank turns red when someone edits a
// mission's tags, which is content work, not a behaviour change.
//
//   npx tsx scripts/test-mission-regenerate.ts
import type { Task } from '../packages/shared/src/types';
import { TASK_BANK, type TaskBankEntry } from '../apps/creator-web/src/taskBank';
import { isTaskCompletable, taskCompletabilityError } from '../packages/shared/src/taskCompletability';
import {
  missionTagProfile,
  missionRoleAt,
  regenerateContext,
  similarityScore,
  activityDriftMultiplier,
  chooseRegeneratedMission,
  applyRegeneratedMission,
  seedFor,
  SIMILARITY_WEIGHTS,
  ACTIVITY_DRIFT_STEP,
  NEUTRAL_MATCH,
} from '../apps/creator-web/src/lib/regenerateMission';

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
function eq<T>(label: string, got: T, want: T): void {
  const same = Object.is(got, want);
  ok(label, same, same ? '' : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── fixtures ────────────────────────────────────────────────────────────────
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', title: 'm', type: 'field', coordinates: { lat: 0, lng: 0 },
  locationless: true, triggerMode: 'locationless',
  difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 5,
  ...over,
} as Task);

const placed = (over: Partial<Task> = {}): Task => task({
  coordinates: { lat: 31.77, lng: 35.21 }, locationless: undefined,
  triggerMode: 'radius', geofenceRadiusMeters: 40, ...over,
});

const entry = (key: string, tags: string[], over: Partial<TaskBankEntry> = {}): TaskBankEntry => ({
  key,
  tags: tags as TaskBankEntry['tags'],
  difficulty: 5,
  build: () => task({ id: `built-${key}`, title: key }),
  ...over,
} as TaskBankEntry);

console.log('\nmission regenerate');

// ═══════════════════════════════════════════════════════════════════════════
// 1. The outgoing mission's tag profile
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n 1. profile derived from the task itself');

{
  const p = missionTagProfile(task({ type: 'photo' }));
  ok('a photo mission is a camera mission', p.includes('camera'), p.join(','));
}
for (const type of ['quiz', 'numeric', 'sequence'] as const) {
  const p = missionTagProfile(task({ type }));
  ok(`a ${type} mission is a thinking mission`, p.includes('thinking'), p.join(','));
}
{
  const p = missionTagProfile(task({ locationless: true }));
  ok('locationless ⇒ fromAnywhere', p.includes('fromAnywhere'));
  ok('locationless ⇒ NOT locationBased', !p.includes('locationBased'));
}
{
  const p = missionTagProfile(placed());
  ok('a placed mission ⇒ locationBased', p.includes('locationBased'));
  ok('a placed mission ⇒ NOT fromAnywhere', !p.includes('fromAnywhere'));
}
{
  eq('difficulty 8 ⇒ hard band', missionTagProfile(task({ difficulty: 8 })).includes('hard'), true);
  eq('difficulty 2 ⇒ easy band', missionTagProfile(task({ difficulty: 2 })).includes('easy'), true);
  eq('difficulty 5 ⇒ medium band', missionTagProfile(task({ difficulty: 5 })).includes('medium'), true);
}
{
  // A `Task` cannot express who a mission suits. Absent, never guessed — the
  // scoring rule that follows depends on the difference.
  const p = missionTagProfile(task({}));
  const audience = ['kids', 'youth', 'adults', 'corporate', 'mixed'];
  ok('no audience is invented', !p.some((t) => audience.includes(t)), p.join(','));
}

console.log('\n 1b. derivation is total');
for (const [label, input] of [
  ['null', null],
  ['undefined', undefined],
  ['empty object', {}],
  ['wrong types', { type: 7, difficulty: 'x', locationless: 'yes', coordinates: 'nope' }],
  ['a string', 'task'],
] as const) {
  let threw = false;
  let out: unknown = null;
  try { out = missionTagProfile(input as never); } catch { threw = true; }
  ok(`${label} ⇒ a profile, no throw`, !threw && Array.isArray(out), threw ? 'threw' : JSON.stringify(out));
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Similarity
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n 2. similarity');

{
  const sum = Object.values(SIMILARITY_WEIGHTS).reduce((a, w) => a + w, 0);
  ok('the weights sum to 1', Math.abs(sum - 1) < 1e-9, String(sum));
}
{
  const profile = missionTagProfile(task({ type: 'photo', difficulty: 5 }));
  const near = entry('near', ['camera', 'fromAnywhere', 'medium', 'noPrep']);
  const far = entry('far', ['thinking', 'locationBased', 'hard', 'noPrep']);
  const a = similarityScore(near, profile, 0);
  const b = similarityScore(far, profile, 0);
  ok('the matching candidate scores strictly higher', a > b, `${a.toFixed(3)} vs ${b.toFixed(3)}`);
}
{
  // The neutral rule: a dimension the profile is silent on must contribute the
  // SAME thing to every candidate, so a mission that merely declared more tags
  // does not win for having declared them.
  const profile = missionTagProfile(task({ type: 'photo' })); // no area, no audience
  const tagged = entry('tagged', ['camera', 'fromAnywhere', 'medium', 'park', 'kids']);
  const bare = entry('bare', ['camera', 'fromAnywhere', 'medium']);
  const a = similarityScore(tagged, profile, 0);
  const b = similarityScore(bare, profile, 0);
  ok('a silent dimension does not reward extra tags', Math.abs(a - b) < 1e-9,
    `${a.toFixed(4)} vs ${b.toFixed(4)}`);
}
{
  ok('NEUTRAL_MATCH sits strictly between a miss and a hit',
    NEUTRAL_MATCH > 0 && NEUTRAL_MATCH < 1, String(NEUTRAL_MATCH));
}

// ── the bookend role (found in the browser, not by a gate) ──────────────────
//
// The first real press of this feature replaced a game's OPENING mission with a
// mid-game action mission. Every other term had scored it correctly; the answer
// was still wrong. A bookend is not "the mission that happens to be first".
console.log('\n 2b. the bookend role');

eq('the first mission of the first stage opens', missionRoleAt(0, 0, 4, 3), 'start');
eq('the last mission of the last stage closes', missionRoleAt(3, 2, 4, 3), 'finish');
eq('a middle mission has no role', missionRoleAt(1, 1, 4, 3), null);
eq('a one-stage one-mission game opens rather than closes', missionRoleAt(0, 0, 1, 1), 'start');
for (const [label, args] of [
  ['null indices', [null, null, null, null]],
  ['NaN', [NaN, 0, 4, 3]],
  ['strings', ['a', 'b', 'c', 'd']],
] as const) {
  eq(`${label} ⇒ a middle mission`, missionRoleAt(...(args as never)), null);
}

{
  const opener = missionTagProfile(task({ type: 'field', difficulty: 2 }), 'start');
  ok('an opening slot carries the start tag', opener.includes('start'), opener.join(','));
  const bankOpener = entry('opener', ['start', 'action', 'locationBased', 'easy', 'needsSetup']);
  const midGame = entry('mid', ['action', 'locationBased', 'easy', 'needsSetup']);
  ok('an opening slot prefers a bank opener',
    similarityScore(bankOpener, opener, 0) > similarityScore(midGame, opener, 0),
    `${similarityScore(bankOpener, opener, 0).toFixed(3)} vs ${similarityScore(midGame, opener, 0).toFixed(3)}`);
}
{
  // The other half, and the reason this dimension does NOT use the neutral rule:
  // a middle slot must not be handed an opener either.
  const middle = missionTagProfile(task({ type: 'field', difficulty: 2 }), null);
  const bankOpener = entry('opener', ['start', 'action', 'locationBased', 'easy', 'needsSetup']);
  const midGame = entry('mid', ['action', 'locationBased', 'easy', 'needsSetup']);
  ok('a middle slot prefers a middle mission',
    similarityScore(midGame, middle, 0) > similarityScore(bankOpener, middle, 0),
    `${similarityScore(midGame, middle, 0).toFixed(3)} vs ${similarityScore(bankOpener, middle, 0).toFixed(3)}`);
}
{
  const finale = missionTagProfile(task({ type: 'photo' }), 'finish');
  const bankFinale = entry('fin', ['finish', 'camera', 'fromAnywhere', 'medium']);
  const opener = entry('op', ['start', 'camera', 'fromAnywhere', 'medium']);
  ok('a closing slot prefers a finale over an opener',
    similarityScore(bankFinale, finale, 0) > similarityScore(opener, finale, 0));
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Drift
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n 3. drift');

eq('level 0 ⇒ full reward', activityDriftMultiplier(0), 1);
eq('level 1 ⇒ half', activityDriftMultiplier(1), 1 - ACTIVITY_DRIFT_STEP);
eq('level 2 ⇒ indifferent', activityDriftMultiplier(2), 0);
eq('level 3 ⇒ a penalty', activityDriftMultiplier(3), -0.5);
eq('level 4 ⇒ fully inverted', activityDriftMultiplier(4), -1);
eq('level 9 ⇒ clamped, not runaway', activityDriftMultiplier(9), -1);
for (const [label, level] of [
  ['negative', -3], ['NaN', NaN], ['a string', 'two'], ['undefined', undefined],
] as const) {
  eq(`${label} ⇒ treated as level 0`, activityDriftMultiplier(level as never), 1);
}

{
  // Drift must change the ORDER, not merely the numbers.
  const profile = missionTagProfile(task({ type: 'photo', difficulty: 5 }));
  const same = entry('same-activity', ['camera', 'fromAnywhere', 'medium']);
  const other = entry('other-activity', ['thinking', 'fromAnywhere', 'medium']);
  ok('at level 0 the same activity wins',
    similarityScore(same, profile, 0) > similarityScore(other, profile, 0));
  ok('at level 4 the different activity wins',
    similarityScore(other, profile, 4) > similarityScore(same, profile, 4),
    `${similarityScore(other, profile, 4).toFixed(3)} vs ${similarityScore(same, profile, 4).toFixed(3)}`);
}
{
  // Level 0 must be pure similarity — a first press is provably the closest match.
  const profile = missionTagProfile(task({ type: 'photo' }));
  const e = entry('x', ['camera', 'fromAnywhere', 'medium']);
  eq('level 0 equals an undrifted score', similarityScore(e, profile, 0), similarityScore(e, profile));
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Playability context and hard filters
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n 4. playability');

const gameOf = (tasks: Task[]) => ({ stages: [{ id: 's1', order: 0, title: 's', tasks }] });

{
  const ctx = regenerateContext(gameOf([task({ id: 'a' }), task({ id: 'b' })]) as never, task({ id: 'a' }));
  eq('an all-locationless game is a fromAnywhere game', ctx.setting, 'fromAnywhere');
}
{
  const ctx = regenerateContext(gameOf([task({ id: 'a' }), placed({ id: 'b' })]) as never, task({ id: 'a' }));
  ok('a game with a placed mission is not venueless', ctx.setting !== 'fromAnywhere', String(ctx.setting));
}
{
  const ctx = regenerateContext(gameOf([task()]) as never, task());
  ok('the default prep tolerance excludes an outside partner', ctx.prepTolerance < 2, String(ctx.prepTolerance));
  eq('the occasion is unknown', ctx.occasion, undefined);
}
for (const [label, game] of [
  ['null', null], ['no stages', {}], ['stages not an array', { stages: 'x' }],
] as const) {
  let threw = false;
  try { regenerateContext(game as never, task()); } catch { threw = true; }
  ok(`a malformed game (${label}) yields a context, no throw`, !threw);
}

console.log('\n 4b. hard filters hold at every drift level');
{
  const profile = missionTagProfile(task({ type: 'photo' }));
  const venueless = regenerateContext(gameOf([task()]) as never, task());
  const cases: [string, TaskBankEntry][] = [
    ['a location-only candidate in a venueless game', entry('placed-only', ['camera', 'locationBased', 'medium', 'noPrep'])],
    ['an occasion-specific candidate with no known occasion', entry('bday', ['camera', 'fromAnywhere', 'medium', 'noPrep'], { occasions: ['birthday'] } as never)],
    ['a needsPartner candidate under the default tolerance', entry('partner', ['camera', 'fromAnywhere', 'medium', 'needsPartner'])],
  ];
  for (const [label, cand] of cases) {
    let excludedEverywhere = true;
    for (let level = 0; level <= 6; level++) {
      const got = chooseRegeneratedMission({
        bank: [cand], profile, context: venueless, drift: level, offeredKeys: [], seed: 1,
      });
      if (got !== null) excludedEverywhere = false;
    }
    ok(`${label} is excluded at levels 0..6`, excludedEverywhere);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Choosing
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n 5. choosing');

const openCtx = regenerateContext(gameOf([placed({ id: 'a' })]) as never, placed({ id: 'a' }));
const profileP = missionTagProfile(task({ type: 'photo' }));
const pool: TaskBankEntry[] = [
  entry('p1', ['camera', 'fromAnywhere', 'medium', 'noPrep']),
  entry('p2', ['camera', 'fromAnywhere', 'medium', 'noPrep'], { family: 'fam' } as never),
  entry('p3', ['camera', 'fromAnywhere', 'medium', 'noPrep'], { family: 'fam' } as never),
  entry('p4', ['thinking', 'fromAnywhere', 'hard', 'noPrep']),
];

{
  const a = chooseRegeneratedMission({ bank: pool, profile: profileP, context: openCtx, drift: 0, offeredKeys: [], seed: 42 });
  const b = chooseRegeneratedMission({ bank: pool, profile: profileP, context: openCtx, drift: 0, offeredKeys: [], seed: 42 });
  eq('identical inputs ⇒ identical key', a?.key, b?.key);
  ok('a candidate is returned', a !== null);
}
{
  const got = chooseRegeneratedMission({ bank: pool, profile: profileP, context: openCtx, drift: 1, offeredKeys: ['p1'], seed: 42 });
  ok('an already-offered key is never returned', got?.key !== 'p1', String(got?.key));
}
{
  const got = chooseRegeneratedMission({ bank: pool, profile: profileP, context: openCtx, drift: 1, offeredKeys: ['p2'], seed: 42 });
  ok('a family sibling of an offered key is never returned', got?.key !== 'p3' && got?.key !== 'p2', String(got?.key));
}
{
  // Exhaustion recycles the history rather than dead-ending.
  const got = chooseRegeneratedMission({
    bank: pool, profile: profileP, context: openCtx, drift: 3,
    offeredKeys: pool.map((e) => e.key), seed: 7,
  });
  ok('an all-offered pool still yields a candidate', got !== null, String(got?.key));
}
{
  const got = chooseRegeneratedMission({ bank: [], profile: profileP, context: openCtx, drift: 0, offeredKeys: [], seed: 1 });
  eq('an empty bank yields null', got, null);
}

console.log('\n 5b. seeding');
{
  eq('the same inputs give the same seed', seedFor('abc', 2), seedFor('abc', 2));
  ok('a different drift gives a different seed', seedFor('abc', 2) !== seedFor('abc', 3));
  // Short ids that differ by one character must not collide — task ids are short,
  // and CLAUDE.md records a real collision bug from a low-bit-folding hash.
  const seen = new Map<number, string>();
  let collisions = 0;
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (const a of alphabet) {
    for (const b of alphabet) {
      const id = a + b;
      const s = seedFor(id, 0);
      const prev = seen.get(s);
      if (prev !== undefined && prev !== id) collisions++;
      seen.set(s, id);
    }
  }
  eq('no collisions across every 2-character id', collisions, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Applying the replacement
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n 6. applying');

{
  const outgoing = placed({ id: 'keep-me', title: 'old', hidden: true, unlockAfterTaskIds: ['other'] } as never);
  const incoming = task({ id: 'fresh', title: 'new', type: 'photo', locationless: true });
  const merged = applyRegeneratedMission(outgoing, incoming);
  eq('the id survives', merged.id, 'keep-me');
  eq('the title comes from the incoming mission', merged.title, 'new');
  eq('the type comes from the incoming mission', merged.type, 'photo');
  eq('the benched flag survives', merged.hidden, true);
  ok('the prerequisites survive',
    JSON.stringify((merged as never as { unlockAfterTaskIds?: string[] }).unlockAfterTaskIds) === JSON.stringify(['other']));
}
{
  // A from-anywhere replacement must not inherit a pin.
  const outgoing = placed({ id: 'x' });
  const incoming = task({ locationless: true });
  const merged = applyRegeneratedMission(outgoing, incoming);
  eq('a locationless replacement is locationless', merged.locationless, true);
  ok('a locationless replacement carries no real pin',
    !merged.coordinates || (merged.coordinates.lat === 0 && merged.coordinates.lng === 0),
    JSON.stringify(merged.coordinates));
}
{
  // A placeable replacement keeps the slot's pin: the stop is the same place.
  const outgoing = placed({ id: 'x', geofenceRadiusMeters: 55 });
  const incoming = task({ locationless: undefined, triggerMode: 'radius', coordinates: { lat: 0, lng: 0 } });
  const merged = applyRegeneratedMission(outgoing, incoming);
  eq('the pin survives (lat)', merged.coordinates.lat, 31.77);
  eq('the pin survives (lng)', merged.coordinates.lng, 35.21);
  eq('the radius survives', merged.geofenceRadiusMeters, 55);
  ok('the replacement is not locationless', merged.locationless !== true);
}
{
  // A sibling's prerequisite must still resolve — the reason the id is preserved.
  const a = placed({ id: 'a' });
  const b = task({ id: 'b', unlockAfterTaskIds: ['a'] } as never);
  const merged = applyRegeneratedMission(a, task({ id: 'brand-new' }));
  const ids = [merged.id, b.id];
  ok('a prerequisite naming the regenerated mission still resolves',
    ((b as never as { unlockAfterTaskIds: string[] }).unlockAfterTaskIds).every((id) => ids.includes(id)));
}
{
  let threw = false;
  try { applyRegeneratedMission(null as never, null as never); } catch { threw = true; }
  ok('merging nothing does not throw', !threw);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. The replacement survives the Builder's own autosave validation
// ════════════════════════════════════════════════════════════════════════════
//
// The Builder autosaves the WHOLE stages array ~1.5 s after any edit, and
// `updateGame` runs the same completability check on the way in. A replacement
// that cannot be completed would be refused, and the creator would watch every
// later save fail for a mission they did not write. This is the one section that
// reads the REAL bank on purpose: it is a content-integrity assertion, not a
// scoring one.
console.log('\n 7. every bank mission survives the merge');
{
  let checked = 0;
  const broken: string[] = [];
  for (const e of TASK_BANK) {
    let built: Task;
    try { built = e.build(); } catch { broken.push(`${e.key} (build threw)`); continue; }
    for (const slot of [task({ id: 'slot' }), placed({ id: 'slot' })]) {
      const merged = applyRegeneratedMission(slot, built);
      checked++;
      if (merged.id !== 'slot') broken.push(`${e.key} (lost the slot id)`);
      if (!isTaskCompletable(merged)) broken.push(`${e.key} (${taskCompletabilityError(merged) ?? 'not completable'})`);
    }
  }
  ok('the merge keeps every bank mission completable', broken.length === 0,
    broken.length ? broken.slice(0, 5).join(' | ') : `${checked} merges checked`);
  ok('the sweep actually read the bank', checked > 0, `${checked} merges`);
}

console.log(failures === 0 ? '\n✅ mission regenerate OK\n' : `\n❌ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
