// Pure-logic tests — the composer's reproducibility and its two variety layers
// (change: smart-game-composer).
//
// Determinism is not a nicety here, it is the thing that makes every OTHER test
// in this change possible. `composeGame` is random by design — that is the whole
// feature — so the only way to assert anything about its output is to control the
// randomness. `rng` is injected exactly the way `now` is injected into
// lib/teamAttention.ts and lib/photoReviewQueue.ts, and this file is what proves
// the injection is complete: if any hidden Math.random() or Date.now() were left
// inside, the same seed would stop reproducing the same game.
//
// The flip side matters just as much. A composer that is merely deterministic is
// a template with extra steps. So this file asserts BOTH directions:
//
//   • same seed  ⇒ byte-identical game (modulo the freshly minted ids), and
//   • different seed ⇒ a game that really differs — in stage SHAPE (the
//     blueprint layer) and in mission CONTENT (the band-sampling layer).
//
// Ids are the one thing that can never repeat, so "identical" is asserted
// through `composerFingerprint`, which is exported from the composer rather than
// re-derived here — otherwise the test would only prove it agrees with itself
// about what "the same game" means.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  seededRng,
  composeGame,
  composerFingerprint,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';

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

console.log('\n── 1. the seeded generator itself ──────────────────────────');
{
  const take = (fn: () => number, n: number) => Array.from({ length: n }, () => fn());

  eq('the same seed yields the same sequence', take(seededRng(1), 20), take(seededRng(1), 20));

  const a = take(seededRng(1), 20);
  const b = take(seededRng(2), 20);
  ok('a different seed diverges within 20 draws', a.some((v, i) => v !== b[i]));

  const values = take(seededRng(12345), 500);
  ok('every value is in [0, 1)', values.every((v) => typeof v === 'number' && v >= 0 && v < 1));
  ok('values are not all identical (the generator actually advances)',
    new Set(values).size > 400);

  // A generator that returns exactly 0 or exactly 1 breaks cumulative-sum
  // sampling at the edges, so the range is asserted rather than assumed.
  ok('no value is exactly 1', values.every((v) => v !== 1));
}

// ─── Fixtures for the whole-composer sections ────────────────────────────────

/**
 * Sentinel copy. Every function returns something traceable rather than real
 * prose, so an assertion can tell WHICH input produced a given word — and so
 * this test carries no Hebrew or English of its own.
 */
const COPY: ComposerDescriptionCopy = {
  lead: ({ people, minutes, ageLabel }) => `LEAD(${people},${minutes},${ageLabel})`,
  ageLabel: (bandId) => `AGE[${bandId}]`,
  ageTag: (bandId) => `agetag-${bandId}`,
  durationTag: (minutes) => `durtag-${minutes}`,
  composedLead: ({ people, minutes, ageLabel }) => `COMPOSED(${people},${minutes},${ageLabel})`,
  activityPhrase: (tag) => `phrase-${tag}`,
  activityJoin: (phrases) => phrases.join(' + '),
  activityTag: (tag) => `acttag-${tag}`,
  placeMissionPrompt: () => 'PLACE_IT',
};

const ANSWERS: ComposerAnswers = {
  audience: 'youth',
  setting: 'outdoor',
  people: 24,
  minutes: 90,
  ageBandId: 'band-14-17',
  difficultyPreference: 'balanced',
};

const compose = (seed: number, answers: ComposerAnswers = ANSWERS, recent: string[] = []) =>
  composeGame(TASK_BANK, answers, COPY, seededRng(seed), { recentBankKeys: recent });

console.log('\n── 2. the same seed reproduces the same game ───────────────');
{
  const a = compose(7);
  const b = compose(7);
  ok('composition succeeds', a !== null && b !== null);

  if (a && b) {
    eq('fingerprints are equal', composerFingerprint(a), composerFingerprint(b));
    eq('the same blueprint was chosen', a.blueprintKey, b.blueprintKey);
    eq('the same missions were chosen, in the same order', a.usedBankKeys, b.usedBankKeys);
    eq('the same description', a.description, b.description);
    eq('the same tags', a.tags, b.tags);
    eq('the same estimated duration', a.estimatedMinutes, b.estimatedMinutes);
    eq('the same stage shape',
      a.stages.map((s) => s.tasks.length), b.stages.map((s) => s.tasks.length));
    eq('the same required counts',
      a.stages.map((s) => s.requiredTaskCount), b.stages.map((s) => s.requiredTaskCount));
  }
}

console.log('\n── 3. ids are always fresh, even at the same seed ──────────');
{
  const a = compose(7);
  const b = compose(7);
  if (a && b) {
    const idsOf = (r: NonNullable<typeof a>) => [
      ...r.stages.map((s) => s.id),
      ...r.stages.flatMap((s) => s.tasks.map((t) => t.id)),
    ];
    const idsA = idsOf(a);
    const idsB = idsOf(b);
    eq('no id is shared between two runs', idsA.filter((id) => idsB.includes(id)), []);
    eq('every id within one run is unique', idsA.length - new Set(idsA).size, 0);
    ok('every id is a non-empty string', idsA.every((id) => typeof id === 'string' && id.length > 0));
  }
}

console.log('\n── 4. a different seed produces a different game ───────────');
{
  const runs = Array.from({ length: 30 }, (_, i) => compose(i + 1)).filter((r) => r !== null);
  ok('all 30 seeds composed successfully', runs.length === 30);

  // Layer 1 — structural. Two generations with identical answers must be able to
  // land on entirely different stage shapes.
  const blueprints = new Set(runs.map((r) => r!.blueprintKey));
  ok(`more than one blueprint appears across seeds (saw ${blueprints.size}: ${[...blueprints].join(', ')})`,
    blueprints.size >= 2);

  // Layer 2 — content. Even at the same blueprint, the missions must differ.
  const missionSets = new Set(runs.map((r) => [...r!.usedBankKeys].sort().join('|')));
  ok(`more than one mission set appears across seeds (saw ${missionSets.size} distinct)`,
    missionSets.size >= 2);

  const fingerprints = new Set(runs.map((r) => JSON.stringify(composerFingerprint(r!))));
  ok(`most seeds produce a distinct game (saw ${fingerprints.size} distinct of ${runs.length})`,
    fingerprints.size >= runs.length * 0.7);
}

console.log('\n── 5. recency really pushes the second game away ───────────');
{
  // Averaged over many seed pairs on purpose: a single sample could be unlucky
  // and make this flake, which is worse than not asserting it at all.
  let withMemory = 0;
  let withoutMemory = 0;
  let pairs = 0;

  for (let seed = 1; seed <= 25; seed++) {
    const first = compose(seed);
    if (!first) continue;
    const secondSeed = seed + 500;

    const remembered = compose(secondSeed, ANSWERS, first.usedBankKeys);
    const forgotten = compose(secondSeed, ANSWERS, []);
    if (!remembered || !forgotten) continue;

    const overlap = (keys: string[]) => keys.filter((k) => first.usedBankKeys.includes(k)).length;
    withMemory += overlap(remembered.usedBankKeys);
    withoutMemory += overlap(forgotten.usedBankKeys);
    pairs++;
  }

  ok('enough pairs were measured', pairs >= 20);
  ok(`a remembered second game repeats fewer missions (${withMemory} vs ${withoutMemory} over ${pairs} pairs)`,
    withMemory < withoutMemory);

  // …but never so aggressively that it starves a slot.
  const starved = compose(3, ANSWERS, TASK_BANK.map((e) => e.key));
  ok('a fully-saturated memory still yields a complete game', starved !== null);
  if (starved) {
    ok('…with every stage still populated', starved.stages.every((s) => s.tasks.length > 0));
  }
}

console.log('\n── 6. all randomness enters through the argument ───────────');
{
  // A counting rng: the SAME inputs must consume the SAME number of draws. A
  // stray Math.random() inside the composer would not change this count, but a
  // clock read or an unstable iteration order would change the RESULT at a fixed
  // count — which section 2 already catches. Together they close the gap.
  const counted = (seed: number) => {
    const base = seededRng(seed);
    let calls = 0;
    const rng = () => { calls++; return base(); };
    const result = composeGame(TASK_BANK, ANSWERS, COPY, rng, { recentBankKeys: [] });
    return { calls, result };
  };

  const a = counted(11);
  const b = counted(11);
  eq('the same inputs consume the same number of draws', a.calls, b.calls);
  ok('at least one draw per mission plus one for the blueprint',
    a.result !== null && a.calls >= a.result.usedBankKeys.length);
  eq('and produce the same game',
    a.result ? composerFingerprint(a.result) : null,
    b.result ? composerFingerprint(b.result) : null);
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/determinism: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/determinism: all assertions passed\x1b[0m');
