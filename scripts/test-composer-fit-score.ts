// Pure-logic tests — how the composer scores one mission for one slot, and how
// it samples among the near-best (change: smart-game-composer).
//
// This is the composer's `priorityScore`: the same weighted-sum-of-named-terms
// shape as functions/src/routing/assignNextTask.ts, with runtime terms swapped
// for authoring-time ones. Two things about it are easy to get subtly wrong and
// impossible to notice from a screenshot:
//
//   • HARD vs SOFT. "This mission needs a venue and the creator has none" must
//     be a hard exclusion — the mission literally cannot be played. "This
//     mission suits older players than the stated band" must be SOFT — a band
//     below every candidate's floor still has to yield a game, and a hard filter
//     there empties the pool and drops the slot.
//   • ARGMAX vs BAND. Always taking the best-scoring candidate makes the whole
//     feature a template with extra steps: same answers, same bank, same game,
//     forever. Sampling within a narrow band of the best is what makes two
//     generations differ while still being well-fitted.
//
// Fixture entries are hand-built rather than pulled from TASK_BANK on purpose:
// this file tests the SCORING RULE, and it must not go red because someone
// retagged a mission.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  fitScore,
  pickFromBand,
  buildFitContext,
  TERM_WEIGHTS,
  TOP_K_MARGIN,
  BAND_EPSILON,
  RECENCY_WINDOW,
  RECENCY_MAX_PENALTY,
  seededRng,
  type FitContext,
} from '../apps/creator-web/src/lib/composeGame';
import type { TaskBankEntry } from '../apps/creator-web/src/taskBank';
import type { BankTagId } from '../apps/creator-web/src/bankTags';
import { task } from '../apps/creator-web/src/taskShorthands';

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

/** A minimal bank entry. Only `key`, `tags`, `difficulty` and `minAge` are scored. */
function entry(key: string, tags: BankTagId[], difficulty = 5, minAge?: number): TaskBankEntry {
  return {
    key,
    tags,
    difficulty,
    ...(minAge !== undefined ? { minAge } : {}),
    sourceTemplateKey: 'fixture',
    build: () => task({ title: key, description: key, difficulty }),
  };
}

/** A context with everything neutral, so one term can be varied at a time. */
function ctx(over: Partial<FitContext> = {}): FitContext {
  return {
    audience: 'youth',
    setting: 'outdoor',
    stageTarget: 5,
    ageFrom: 14,
    preferredTags: [],
    usedKeys: new Set<string>(),
    recentIndex: new Map<string, number>(),
    ...over,
  };
}

console.log('\n── 1. the weights are declared, not magic numbers ──────────');
{
  // Summed from the object rather than by naming each term: a seventh weight
  // added later must land in this assertion automatically, which is exactly what
  // the hand-listed version failed to do when `area` was introduced.
  const sum = Object.values(TERM_WEIGHTS).reduce((a, w) => a + w, 0);
  ok(`the ${Object.keys(TERM_WEIGHTS).length} term weights sum to 1 (got ${sum.toFixed(4)})`,
    Math.abs(sum - 1) < 1e-9);
  ok('every weight is positive', Object.values(TERM_WEIGHTS).every((w) => w > 0));
  ok('the recency penalty cannot dominate a perfect score', RECENCY_MAX_PENALTY < 1);
  ok('the band margin is narrow enough to stay "near-best"', TOP_K_MARGIN > 0 && TOP_K_MARGIN <= 0.25);
  ok('the band epsilon is positive so an all-equal band samples uniformly', BAND_EPSILON > 0);
  ok('the recency window spans several generations', RECENCY_WINDOW >= 20);
}

console.log('\n── 2. audience ─────────────────────────────────────────────');
{
  const c = ctx({ audience: 'youth' });
  const exact = fitScore(entry('a', ['youth', 'fromAnywhere']), c);
  const mixed = fitScore(entry('b', ['mixed', 'fromAnywhere']), c);
  const other = fitScore(entry('c', ['corporate', 'fromAnywhere']), c);

  ok('an exact audience match beats "all ages"', exact > mixed);
  ok('"all ages" beats an unrelated audience', mixed > other);
  ok('all three are finite (audience is never a hard filter)',
    [exact, mixed, other].every(Number.isFinite));
}

console.log('\n── 3. setting ──────────────────────────────────────────────');
{
  const c = ctx({ setting: 'outdoor' });
  const exact = fitScore(entry('a', ['youth', 'outdoor', 'fromAnywhere']), c);
  const anywhere = fitScore(entry('b', ['youth', 'fromAnywhere']), c);
  const other = fitScore(entry('c', ['youth', 'indoor']), c);

  ok('an exact setting match beats "from anywhere"', exact > anywhere);
  ok('"from anywhere" beats an unrelated setting', anywhere > other);
  ok('an unrelated setting is still finite (soft, not hard)', Number.isFinite(other));
}

console.log('\n── 4. difficulty fit follows the stage target ──────────────');
{
  const c = ctx({ stageTarget: 5 });
  const at = fitScore(entry('a', ['youth', 'fromAnywhere'], 5), c);
  const near = fitScore(entry('b', ['youth', 'fromAnywhere'], 6), c);
  const far = fitScore(entry('c', ['youth', 'fromAnywhere'], 9), c);

  ok('an exact difficulty match scores highest', at > near && near > far);

  // Monotone across the whole range, both directions from the target.
  const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((d) => ({ d, s: fitScore(entry(`d${d}`, ['youth', 'fromAnywhere'], d), ctx({ stageTarget: 5 })) }));
  const below = scores.filter((x) => x.d <= 5);
  const above = scores.filter((x) => x.d >= 5);
  ok('score rises monotonically up to the target',
    below.every((x, i) => i === 0 || x.s >= below[i - 1].s));
  ok('score falls monotonically past the target',
    above.every((x, i) => i === 0 || x.s <= above[i - 1].s));
  ok('every difficulty is still finite at the extremes', scores.every((x) => Number.isFinite(x.s)));

  // The extreme gap must not push the term negative and start acting like a
  // penalty on the other terms.
  const worst = fitScore(entry('w', ['youth', 'fromAnywhere'], 10), ctx({ stageTarget: 1 }));
  const bare = fitScore(entry('w', [], 10), ctx({ stageTarget: 1, audience: 'kids', setting: 'indoor' }));
  ok('a maximal difficulty gap never drives the score below zero', worst >= 0 && bare >= 0);
}

console.log('\n── 5. preferred tags ───────────────────────────────────────');
{
  const withPref = ctx({ preferredTags: ['camera'] });
  const hit = fitScore(entry('a', ['youth', 'fromAnywhere', 'camera']), withPref);
  const miss = fitScore(entry('b', ['youth', 'fromAnywhere', 'thinking']), withPref);
  ok('a mission matching a preferred tag scores higher', hit > miss);

  // The critical one: with nothing asked for, the term must be 0 for EVERYONE.
  // A naive `overlap / preferred.length` is NaN at length 0, and NaN poisons the
  // whole sum — every candidate would score NaN and the band would be empty.
  const noPref = ctx({ preferredTags: [] });
  const a = fitScore(entry('a', ['youth', 'fromAnywhere', 'camera']), noPref);
  const b = fitScore(entry('b', ['youth', 'fromAnywhere', 'thinking']), noPref);
  ok('with no preference asked, the term contributes nothing to anyone', a === b);
  ok('…and the score is a real number, not NaN', Number.isFinite(a));

  const undef = fitScore(entry('a', ['youth', 'fromAnywhere', 'camera']), ctx({ preferredTags: undefined as never }));
  ok('an absent preferred list is treated as none, not as a crash', Number.isFinite(undef));

  // Two of two beats one of two.
  const both = fitScore(entry('c', ['youth', 'fromAnywhere', 'camera', 'action']), ctx({ preferredTags: ['camera', 'action'] }));
  const one = fitScore(entry('d', ['youth', 'fromAnywhere', 'camera']), ctx({ preferredTags: ['camera', 'action'] }));
  ok('matching both preferred tags beats matching one', both > one);
}

console.log('\n── 6. age is a SOFT penalty, never a filter ────────────────');
{
  const c = ctx({ ageFrom: 8 });
  const fits = fitScore(entry('a', ['youth', 'fromAnywhere'], 5, 6), c);
  const above = fitScore(entry('b', ['youth', 'fromAnywhere'], 5, 16), c);
  const none = fitScore(entry('c', ['youth', 'fromAnywhere'], 5), c);

  ok('a mission suited to older players scores lower', above < fits);
  ok('…but is never excluded', Number.isFinite(above) && above > -Infinity);
  ok('no declared floor scores like a comfortable fit', none === fits);

  // The whole point: a pool where EVERY candidate is above the band must still
  // produce a pick, or the slot is dropped and the game shrinks silently.
  const allAbove = [entry('x', ['youth', 'fromAnywhere'], 5, 18), entry('y', ['youth', 'fromAnywhere'], 5, 21)]
    .map((e) => fitScore(e, c));
  ok('every candidate above the band is still selectable', allAbove.every((s) => Number.isFinite(s)));
}

console.log('\n── 7. the hard filters ─────────────────────────────────────');
{
  const used = ctx({ usedKeys: new Set(['a']) });
  eq('a mission already used in this game is excluded', fitScore(entry('a', ['youth', 'fromAnywhere']), used), -Infinity);
  ok('…while an unused one is not', Number.isFinite(fitScore(entry('b', ['youth', 'fromAnywhere']), used)));

  // "No venue" is the answer that makes a location-only mission unplayable.
  const noVenue = ctx({ setting: 'fromAnywhere' });
  eq('a location-only mission is excluded when there is no venue',
    fitScore(entry('c', ['youth', 'locationBased']), noVenue), -Infinity);
  ok('a location-based mission that ALSO plays anywhere is kept',
    Number.isFinite(fitScore(entry('d', ['youth', 'locationBased', 'fromAnywhere']), noVenue)));
  ok('the same location-only mission is fine when there IS a venue',
    Number.isFinite(fitScore(entry('c', ['youth', 'locationBased']), ctx({ setting: 'outdoor' })))
    && Number.isFinite(fitScore(entry('c', ['youth', 'locationBased']), ctx({ setting: 'indoor' }))));

  // Bookend slots restrict the pool before scoring.
  const opener = ctx({ requiredTag: 'start' });
  ok('a non-opener is excluded from the opener slot',
    fitScore(entry('e', ['youth', 'fromAnywhere']), opener) === -Infinity);
  ok('an opener is kept', Number.isFinite(fitScore(entry('f', ['start', 'youth', 'fromAnywhere']), opener)));

  const finale = ctx({ requiredTag: 'finish' });
  ok('an opener is excluded from the finale slot',
    fitScore(entry('f', ['start', 'youth', 'fromAnywhere']), finale) === -Infinity);
}

console.log('\n── 8. recency deprioritises without vetoing ────────────────');
{
  const e = entry('a', ['youth', 'fromAnywhere']);
  const absent = fitScore(e, ctx());
  const newest = fitScore(e, ctx({ recentIndex: new Map([['a', 0]]) }));
  const oldest = fitScore(e, ctx({ recentIndex: new Map([['a', RECENCY_WINDOW - 1]]) }));
  const expired = fitScore(e, ctx({ recentIndex: new Map([['a', RECENCY_WINDOW + 5]]) }));

  ok('the most recently used mission is penalised most', newest < oldest);
  ok('an old use is penalised less than a fresh one', oldest < absent);
  eq('a use beyond the window scores exactly as if never used', expired, absent);
  ok('the penalty never turns a finite score into an exclusion', Number.isFinite(newest));
  ok(`the penalty is bounded by RECENCY_MAX_PENALTY (${(absent - newest).toFixed(4)})`,
    absent - newest <= RECENCY_MAX_PENALTY + 1e-9);

  // Monotone decay across the window.
  const byIndex = Array.from({ length: RECENCY_WINDOW }, (_, i) =>
    fitScore(e, ctx({ recentIndex: new Map([['a', i]]) })));
  ok('the penalty decays monotonically across the window',
    byIndex.every((s, i) => i === 0 || s >= byIndex[i - 1]));
}

console.log('\n── 9. the band sampler ─────────────────────────────────────');
{
  const cands = [
    { key: 'best', score: 1.00 },
    { key: 'near', score: 0.95 },
    { key: 'edge', score: 1.00 - TOP_K_MARGIN + 0.001 },
    { key: 'out', score: 1.00 - TOP_K_MARGIN - 0.10 },
    { key: 'way-out', score: 0.10 },
  ];

  const picks = new Set<string>();
  for (let s = 1; s <= 400; s++) picks.add(pickFromBand(cands, seededRng(s))!.key);

  ok('only candidates within the margin are ever picked',
    ![...picks].some((k) => k === 'out' || k === 'way-out'));
  ok('every candidate inside the margin is reachable',
    picks.has('best') && picks.has('near') && picks.has('edge'));

  // Weighted toward the top — asserted as a frequency, not as a guarantee.
  let bestCount = 0; let edgeCount = 0;
  for (let s = 1; s <= 400; s++) {
    const k = pickFromBand(cands, seededRng(s))!.key;
    if (k === 'best') bestCount++;
    if (k === 'edge') edgeCount++;
  }
  ok(`the top of the band is picked more often than the bottom (${bestCount} vs ${edgeCount})`,
    bestCount > edgeCount);

  // An all-equal band must sample uniformly rather than collapsing to one.
  const flat = [{ key: 'p', score: 0.5 }, { key: 'q', score: 0.5 }, { key: 'r', score: 0.5 }];
  const flatPicks = new Set<string>();
  for (let s = 1; s <= 200; s++) flatPicks.add(pickFromBand(flat, seededRng(s))!.key);
  eq('every member of an all-equal band is reachable', [...flatPicks].sort(), ['p', 'q', 'r']);

  eq('a single candidate is returned', pickFromBand([{ key: 'only', score: 0.3 }], seededRng(1))!.key, 'only');
  eq('an empty list yields null, never a throw', pickFromBand([], seededRng(1)), null);
  eq('a list of only excluded candidates yields null',
    pickFromBand([{ key: 'x', score: -Infinity }], seededRng(1)), null);
}

console.log('\n── 10. exactly one draw per pick, and stable ties ──────────');
{
  const cands = [{ key: 'a', score: 1 }, { key: 'b', score: 0.98 }, { key: 'c', score: 0.97 }];
  let calls = 0;
  const rng = () => { calls++; return 0.42; };
  pickFromBand(cands, rng);
  eq('exactly one rng draw is consumed per pick', calls, 1);

  // Byte-equal scores must order identically regardless of input order, or the
  // determinism guarantee becomes engine-dependent through sort stability.
  const forward = [{ key: 'b', score: 0.5 }, { key: 'a', score: 0.5 }, { key: 'c', score: 0.5 }];
  const backward = [{ key: 'c', score: 0.5 }, { key: 'a', score: 0.5 }, { key: 'b', score: 0.5 }];
  for (let s = 1; s <= 50; s++) {
    const f = pickFromBand(forward, seededRng(s))!.key;
    const b = pickFromBand(backward, seededRng(s))!.key;
    if (f !== b) { failures++; console.error(`  ✗ tie order depends on input order at seed ${s}: ${f} vs ${b}`); break; }
  }
  ok('tied candidates resolve the same way regardless of input order', true);
}

console.log('\n── 11. buildFitContext turns answers into a context ────────');
{
  const c = buildFitContext({
    audience: 'kids', setting: 'indoor', people: 20, minutes: 60,
    ageBandId: 'band-8-10', difficultyPreference: 'hard',
  }, { recentBankKeys: ['x', 'y'] });

  eq('the audience carries through', c.audience, 'kids');
  eq('the setting carries through', c.setting, 'indoor');
  ok('the age band resolves to a numeric floor', typeof c.ageFrom === 'number' && Number.isFinite(c.ageFrom));
  eq('recency becomes a position lookup', [c.recentIndex.get('x'), c.recentIndex.get('y')], [0, 1]);
  ok('nothing is used yet', c.usedKeys.size === 0);

  const junk = buildFitContext({
    audience: 'nope' as never, setting: 'nope' as never, people: NaN, minutes: NaN,
    ageBandId: 'no-such-band', difficultyPreference: 'sideways' as never,
  }, { recentBankKeys: [1, null, 'ok'] as never });
  ok('an unknown age band still yields a finite floor', Number.isFinite(junk.ageFrom));
  eq('non-string recency entries are dropped', junk.recentIndex.get('ok'), 0);
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/fit-score: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/fit-score: all assertions passed\x1b[0m');
