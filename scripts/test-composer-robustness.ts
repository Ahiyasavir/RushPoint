// Pure-logic tests — the composer is TOTAL
// (change: smart-game-composer).
//
// `composeGame` sits between a questionnaire and two network calls. Everything
// upstream of it is a UI that can be wrong: a default that never got applied, a
// number input that produced NaN, an age band id from an older build still in a
// creator's open tab. If any of those makes the composer throw, the creator's
// "create my game" click dies with an unhandled error and nothing is created —
// no message, no fallback, no game.
//
// So the contract is narrow and absolute: **`composeGame` returns either a game
// that passes the full server battery, or exactly `null`. It never throws, and
// it never returns something half-built.**
//
// `null` is a real, designed outcome rather than an error code — it means "this
// bank cannot make a game", the caller falls back to the blank path and TELLS the
// creator. The alternative (returning a one-blank-mission starter) silently
// degrades a smart build into an empty game with nobody able to say so.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  gameStructureProblems,
  requiredTaskCountProblem,
  validateUnlockGraph,
  validateAvailabilityWindow,
  maxCompletableTasks,
} from '@rushpoint/shared';
import {
  composeGame,
  seededRng,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
  type ComposerResult,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK, type TaskBankEntry } from '../apps/creator-web/src/taskBank';
import type { BankTagId } from '../apps/creator-web/src/bankTags';
import { task } from '../apps/creator-web/src/taskShorthands';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const COPY: ComposerDescriptionCopy = {
  lead: () => 'LEAD',
  ageLabel: (b) => `AGE[${b}]`,
  ageTag: (b) => `agetag-${b}`,
  durationTag: (m) => `durtag-${m}`,
  composedLead: () => 'COMPOSED',
  activityPhrase: (t) => `phrase-${t}`,
  activityJoin: (p) => p.join(' + '),
  activityTag: (t) => `acttag-${t}`,
  placeMissionPrompt: () => 'PLACE_IT',
};

const BASE: ComposerAnswers = {
  audience: 'youth', setting: 'outdoor', people: 24, minutes: 90,
  ageBandId: 'band-14-17', difficultyPreference: 'balanced',
};

/** The full server battery, as one boolean, so every case can assert it. */
function isLaunchValid(r: ComposerResult): string {
  if (r.stages.length === 0) return 'no stages';
  const structure = gameStructureProblems(r.stages);
  if (structure.length > 0) return `structure: ${structure[0]}`;

  for (const s of r.stages) {
    const p = requiredTaskCountProblem(s as never);
    if (p !== null) return `requiredTaskCount: ${p}`;
    if (!(s.requiredTaskCount == null || s.requiredTaskCount <= maxCompletableTasks(s as never))) {
      return 'requiredTaskCount > maxCompletableTasks';
    }
    if (validateUnlockGraph(s).errors.length > 0) return 'unlock graph';
    for (const t of s.tasks) if (validateAvailabilityWindow(t) !== null) return 'availability window';
    if (s.tasks.length === 0) return 'empty stage';
  }

  const finals = r.stages.filter((s) => s.isFinal === true);
  if (finals.length !== 1) return `${finals.length} final stages`;
  if (r.stages[r.stages.length - 1].isFinal !== true) return 'final stage is not last';
  if (typeof r.description !== 'string') return 'description is not a string';
  if (!Array.isArray(r.tags)) return 'tags is not an array';
  if (!Array.isArray(r.wizardSteps)) return 'wizardSteps is not an array';
  if (!(Number.isFinite(r.estimatedMinutes) && r.estimatedMinutes > 0)) return 'bad estimatedMinutes';
  return '';
}

/** Run one case; returns a failure reason or ''. Never lets a throw escape. */
function attempt(label: string, run: () => ComposerResult | null, allowNull = true): string {
  let r: ComposerResult | null;
  try {
    r = run();
  } catch (err) {
    return `${label}: THREW ${String(err)}`;
  }
  if (r === null) return allowNull ? '' : `${label}: returned null`;
  const problem = isLaunchValid(r);
  return problem ? `${label}: ${problem}` : '';
}

console.log('\n── 1. junk durations ───────────────────────────────────────');
{
  const cases: [string, unknown][] = [
    ['0', 0], ['negative', -5], ['huge negative', -1e9], ['NaN', NaN],
    ['Infinity', Infinity], ['-Infinity', -Infinity], ['1e9', 1e9],
    ['undefined', undefined], ['null', null], ['string', '90'],
    ['object', {}], ['array', []], ['true', true],
  ];
  const bad = cases
    .map(([label, minutes]) => attempt(label, () =>
      composeGame(TASK_BANK, { ...BASE, minutes: minutes as number }, COPY, seededRng(1), { recentBankKeys: [] }), false))
    .filter(Boolean);
  eq('every junk duration yields a valid game, never a throw and never null', bad, []);
}

console.log('\n── 2. junk group sizes ─────────────────────────────────────');
{
  const cases: [string, unknown][] = [
    ['0', 0], ['negative', -1], ['NaN', NaN], ['Infinity', Infinity],
    ['undefined', undefined], ['null', null], ['string', '24'], ['huge', 1e9],
  ];
  const bad = cases
    .map(([label, people]) => attempt(label, () =>
      composeGame(TASK_BANK, { ...BASE, people: people as number }, COPY, seededRng(1), { recentBankKeys: [] }), false))
    .filter(Boolean);
  eq('every junk group size yields a valid game', bad, []);
}

console.log('\n── 3. unknown enum answers ─────────────────────────────────');
{
  const bad = [
    attempt('unknown audience', () => composeGame(TASK_BANK, { ...BASE, audience: 'martians' as never }, COPY, seededRng(1), { recentBankKeys: [] }), false),
    attempt('unknown setting', () => composeGame(TASK_BANK, { ...BASE, setting: 'underwater' as never }, COPY, seededRng(1), { recentBankKeys: [] }), false),
    attempt('unknown difficulty', () => composeGame(TASK_BANK, { ...BASE, difficultyPreference: 'sideways' as never }, COPY, seededRng(1), { recentBankKeys: [] }), false),
    attempt('unknown age band', () => composeGame(TASK_BANK, { ...BASE, ageBandId: 'band-from-2019' }, COPY, seededRng(1), { recentBankKeys: [] }), false),
    attempt('empty age band', () => composeGame(TASK_BANK, { ...BASE, ageBandId: '' }, COPY, seededRng(1), { recentBankKeys: [] }), false),
    attempt('undefined age band', () => composeGame(TASK_BANK, { ...BASE, ageBandId: undefined as never }, COPY, seededRng(1), { recentBankKeys: [] }), false),
    attempt('numeric audience', () => composeGame(TASK_BANK, { ...BASE, audience: 7 as never }, COPY, seededRng(1), { recentBankKeys: [] }), false),
    attempt('whole answers object missing', () => composeGame(TASK_BANK, undefined as never, COPY, seededRng(1), { recentBankKeys: [] })),
    attempt('answers is null', () => composeGame(TASK_BANK, null as never, COPY, seededRng(1), { recentBankKeys: [] })),
    attempt('answers is empty', () => composeGame(TASK_BANK, {} as never, COPY, seededRng(1), { recentBankKeys: [] }), false),
  ].filter(Boolean);
  eq('every unknown or missing answer still yields a valid game', bad, []);
}

console.log('\n── 4. junk preferred tags ──────────────────────────────────');
{
  const cases: [string, unknown][] = [
    ['unknown ids', ['not-a-tag', 'also-not']],
    ['duplicates', ['camera', 'camera', 'camera']],
    ['non-strings', [1, null, undefined, {}]],
    ['empty', []],
    ['not an array', 'camera'],
    ['null', null],
    ['mixed valid and junk', ['camera', 42, 'nope']],
  ];
  const bad = cases
    .map(([label, preferredTags]) => attempt(label, () =>
      composeGame(TASK_BANK, { ...BASE, preferredTags: preferredTags as never }, COPY, seededRng(1), { recentBankKeys: [] }), false))
    .filter(Boolean);
  eq('every junk preference list is ignored rather than fatal', bad, []);
}

console.log('\n── 5. junk recency ─────────────────────────────────────────');
{
  const cases: [string, unknown][] = [
    ['undefined', undefined], ['null', null], ['empty object', {}],
    ['keys not an array', { recentBankKeys: 'a,b' }],
    ['non-string keys', { recentBankKeys: [1, null, {}, 'ok'] }],
    ['enormous list', { recentBankKeys: Array.from({ length: 5000 }, (_, i) => `k${i}`) }],
    ['every real key', { recentBankKeys: TASK_BANK.map((e) => e.key) }],
  ];
  const bad = cases
    .map(([label, recent]) => attempt(label, () =>
      composeGame(TASK_BANK, BASE, COPY, seededRng(1), recent as never), false))
    .filter(Boolean);
  eq('every junk recency value still yields a valid game', bad, []);
}

console.log('\n── 6. junk copy ────────────────────────────────────────────');
{
  const EMPTY = {
    lead: () => '', ageLabel: () => '', ageTag: () => '', durationTag: () => '',
    composedLead: () => '', activityPhrase: () => '', activityJoin: () => '', activityTag: () => '',
  } as ComposerDescriptionCopy;

  const UNDEF = {
    lead: () => undefined, ageLabel: () => undefined, ageTag: () => undefined, durationTag: () => undefined,
    composedLead: () => undefined, activityPhrase: () => undefined, activityJoin: () => undefined,
    activityTag: () => undefined,
    placeMissionPrompt: () => 'PLACE_IT',
  } as unknown as ComposerDescriptionCopy;

  const bad = [
    attempt('empty strings', () => composeGame(TASK_BANK, BASE, EMPTY, seededRng(1), { recentBankKeys: [] }), false),
    attempt('undefined returns', () => composeGame(TASK_BANK, BASE, UNDEF, seededRng(1), { recentBankKeys: [] }), false),
    attempt('copy object missing', () => composeGame(TASK_BANK, BASE, undefined as never, seededRng(1), { recentBankKeys: [] }), false),
    attempt('copy is an empty object', () => composeGame(TASK_BANK, BASE, {} as never, seededRng(1), { recentBankKeys: [] }), false),
  ].filter(Boolean);
  eq('broken copy degrades to a plain description, never a throw', bad, []);

  const r = composeGame(TASK_BANK, BASE, UNDEF, seededRng(1), { recentBankKeys: [] });
  ok('a description is still a string when every copy function returns undefined',
    r !== null && typeof r.description === 'string');
  ok('…and tags are still an array of strings',
    r !== null && Array.isArray(r.tags) && r.tags.every((t) => typeof t === 'string'));
}

console.log('\n── 7. junk rng ─────────────────────────────────────────────');
{
  const bad = [
    attempt('always 0', () => composeGame(TASK_BANK, BASE, COPY, () => 0, { recentBankKeys: [] }), false),
    // 1 is out of contract for Math.random, but a cumulative-sum picker that
    // assumes < 1 walks off the end of its array and returns undefined.
    attempt('always 1', () => composeGame(TASK_BANK, BASE, COPY, () => 1, { recentBankKeys: [] }), false),
    attempt('always 0.999999', () => composeGame(TASK_BANK, BASE, COPY, () => 0.999999, { recentBankKeys: [] }), false),
    attempt('NaN', () => composeGame(TASK_BANK, BASE, COPY, () => NaN, { recentBankKeys: [] }), false),
    attempt('negative', () => composeGame(TASK_BANK, BASE, COPY, () => -1, { recentBankKeys: [] }), false),
    attempt('out of range high', () => composeGame(TASK_BANK, BASE, COPY, () => 42, { recentBankKeys: [] }), false),
    attempt('rng missing', () => composeGame(TASK_BANK, BASE, COPY, undefined as never, { recentBankKeys: [] }), false),
  ].filter(Boolean);
  eq('every degenerate rng still yields a valid game', bad, []);
}

console.log('\n── 8. degenerate banks ─────────────────────────────────────');
{
  const entry = (key: string, tags: BankTagId[]): TaskBankEntry => ({
    key, tags, difficulty: 5, sourceTemplateKey: 'fixture',
    build: () => task({ title: key, description: key, difficulty: 5 }),
  });

  // An empty bank cannot make a game. `null` is the ONLY acceptable answer.
  eq('an empty bank returns exactly null',
    composeGame([], BASE, COPY, seededRng(1), { recentBankKeys: [] }), null);
  eq('a missing bank returns exactly null',
    composeGame(undefined as never, BASE, COPY, seededRng(1), { recentBankKeys: [] }), null);
  eq('a non-array bank returns exactly null',
    composeGame('nope' as never, BASE, COPY, seededRng(1), { recentBankKeys: [] }), null);

  // Every entry hard-filtered out — the creator has no venue and everything
  // needs one.
  const ALL_LOCATION: TaskBankEntry[] = Array.from({ length: 12 }, (_, i) =>
    entry(`loc-${i}`, ['youth', 'locationBased']));
  eq('a bank where every mission is filtered out returns exactly null',
    composeGame(ALL_LOCATION, { ...BASE, setting: 'fromAnywhere' }, COPY, seededRng(1), { recentBankKeys: [] }), null);
  ok('…while the same bank WITH a venue composes fine',
    composeGame(ALL_LOCATION, { ...BASE, setting: 'outdoor' }, COPY, seededRng(1), { recentBankKeys: [] }) !== null);

  // Tiny banks: either null or a fully valid game. Never something in between.
  for (let size = 1; size <= 6; size++) {
    const bank = Array.from({ length: size }, (_, i) => entry(`t-${i}`, ['youth', 'fromAnywhere']));
    const problem = attempt(`bank of ${size}`, () =>
      composeGame(bank, BASE, COPY, seededRng(1), { recentBankKeys: [] }));
    if (problem) { failures++; console.error(`  ✗ ${problem}`); }
  }
  ok('a bank of 1-6 missions yields either null or a fully valid game', true);

  // A bank with missions but no bookends at all.
  const NO_BOOKENDS = Array.from({ length: 10 }, (_, i) => entry(`plain-${i}`, ['youth', 'fromAnywhere']));
  eq('a bank with no openers or finales yields either null or a valid game',
    attempt('no bookends', () => composeGame(NO_BOOKENDS, BASE, COPY, seededRng(1), { recentBankKeys: [] })), '');
}

console.log('\n── 9. a mission whose build() throws is skipped, not fatal ──');
{
  const good = (key: string, tags: BankTagId[]): TaskBankEntry => ({
    key, tags, difficulty: 5, sourceTemplateKey: 'fixture',
    build: () => task({ title: key, description: key, difficulty: 5 }),
  });
  const poison = (key: string, tags: BankTagId[]): TaskBankEntry => ({
    key, tags, difficulty: 5, sourceTemplateKey: 'fixture',
    build: () => { throw new Error(`boom: ${key}`); },
  });

  const BANK: TaskBankEntry[] = [
    good('open', ['start', 'youth', 'fromAnywhere']),
    good('end', ['finish', 'youth', 'fromAnywhere']),
    poison('bad-1', ['youth', 'fromAnywhere']),
    poison('bad-2', ['youth', 'fromAnywhere']),
    ...Array.from({ length: 10 }, (_, i) => good(`mid-${i}`, ['youth', 'fromAnywhere'])),
  ];

  const problem = attempt('poisoned bank', () =>
    composeGame(BANK, BASE, COPY, seededRng(1), { recentBankKeys: [] }), false);
  eq('a throwing mission does not take the composition down', problem, '');

  let leaked = '';
  for (let seed = 1; seed <= 20; seed++) {
    const r = composeGame(BANK, BASE, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) { leaked ||= `seed ${seed}: null`; continue; }
    if (r.usedBankKeys.some((k) => k.startsWith('bad-'))) leaked ||= `seed ${seed}: a broken mission was used`;
    const problem2 = isLaunchValid(r);
    if (problem2) leaked ||= `seed ${seed}: ${problem2}`;
  }
  eq('the broken missions are skipped and the rest of the game is valid', leaked, '');
}

console.log('\n── 10. everything at once ──────────────────────────────────');
{
  // The realistic disaster: an old tab, a NaN, a stale band id and a broken copy
  // provider all arriving together.
  const problem = attempt('total junk', () => composeGame(
    TASK_BANK,
    {
      audience: undefined, setting: null, people: NaN, minutes: 'soon',
      ageBandId: 12345, difficultyPreference: {}, preferredTags: 'camera',
    } as never,
    {} as never,
    (() => NaN) as never,
    'not-a-state' as never,
  ), false);
  eq('a completely malformed call still yields a valid game', problem, '');
}

console.log('\n── 11. the pure core never reaches for storage ─────────────');
{
  // Design D10: the composer must only ever receive a recency VALUE. If it ever
  // imported the storage wrapper, "same seed ⇒ same game" would depend on the
  // machine it ran on.
  const source = readFileSync(join(process.cwd(), 'apps/creator-web/src/lib/composeGame.ts'), 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  ok('composeGame.ts does not import recentBankPicks', !/from\s+'\.\/recentBankPicks'/.test(code));
  ok('composeGame.ts never touches localStorage', !/localStorage/.test(code));
  ok('composeGame.ts never reads the clock', !/Date\.now|new Date\(/.test(code));
  ok('composeGame.ts never calls Math.random directly outside the default argument',
    (code.match(/Math\.random/g) ?? []).length <= 1);
  ok('composeGame.ts imports no React', !/from\s+'react'/.test(code));
  ok('composeGame.ts imports no Firebase', !/firebase/i.test(code));
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/robustness: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/robustness: all assertions passed\x1b[0m');
