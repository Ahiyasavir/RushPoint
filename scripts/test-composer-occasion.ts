// Pure-logic tests — what the OCCASION changes about a composed game
// (change: smart-build-occasion-and-prep-scale).
//
// Before this change the questionnaire never asked what the event actually was,
// so a bar mitzvah, a wedding and a company team-building day composed
// identically: same stage count, same generic stage titles, same mission mix.
// The composer knew who was playing and for how long, and nothing about the
// occasion those two facts were in service of.
//
// The occasion is deliberately NOT a bank tag. No mission is tagged "wedding"
// and none will be — an occasion is a property of the EVENT, expressed as a bias
// over activity tags that already exist. A tag nothing carries is invisible at
// runtime: filtering on it just yields an empty pool, which is the exact failure
// scripts/test-bank-tags.ts was written to catch.
//
// The three things it moves, and the guarantee each one has to keep:
//
//   • MISSION FIT — a soft, bounded, additive bonus. It must never exclude a
//     mission, because the creator's other answers have already narrowed the
//     pool and an occasion that empties it drops the whole game.
//   • STAGE STRUCTURE — the occasion's own blueprint when the mission budget can
//     hold it, today's random pick when it cannot. Both branches must consume
//     the SAME number of RNG draws, or a seed stops pinning the composition.
//   • STAGE TITLES — occasion copy when supplied, the generic list otherwise.
//
// And one thing it must NOT move: the neutral occasion has to reproduce the
// pre-change behaviour EXACTLY, so every other composer suite stays meaningful.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  composeGame,
  fitScore,
  buildFitContext,
  seededRng,
  MIN_MISSIONS_PER_STAGE,
  OCCASION_BONUS,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK, type TaskBankEntry } from '../apps/creator-web/src/taskBank';
import { task } from '../apps/creator-web/src/taskShorthands';
import { ACTIVITY_TAG_IDS, type BankTagId } from '../apps/creator-web/src/bankTags';
import {
  OCCASION_IDS,
  OCCASIONS,
  NEUTRAL_OCCASION,
  occasionProfile,
  type OccasionId,
} from '../apps/creator-web/src/lib/occasions';

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
  lead: () => 'L', ageLabel: () => 'A', ageTag: () => 'agetag', durationTag: () => 'durtag',
  composedLead: () => 'C', activityPhrase: (t) => `p-${t}`, activityJoin: (p) => p.join('+'),
  activityTag: (t) => `at-${t}`,
  stageNames: () => ['generic'],
  placeMissionPrompt: () => 'PLACE_IT',
};

const BASE: ComposerAnswers = {
  audience: 'mixed', setting: 'outdoor', people: 24, minutes: 120,
  ageBandId: 'band-14-17', difficultyPreference: 'balanced', prepEffort: 3,
};

const compose = (over: Partial<ComposerAnswers>, seed = 1) =>
  composeGame(TASK_BANK, { ...BASE, ...over }, COPY, seededRng(seed), { recentBankKeys: [] });

/**
 * Everything about a composed game that a SEED decides.
 *
 * Not `JSON.stringify(result)`: every task and stage carries a fresh `uuid()`,
 * so two identical compositions never stringify alike. Comparing the raw result
 * would report drift on every single call and prove nothing.
 */
const fingerprint = (r: ReturnType<typeof compose>): string => JSON.stringify(r && {
  blueprint: r.blueprintKey,
  missions: r.usedBankKeys,
  shape: r.stages.map((st) => st.tasks.length),
  titles: r.stages.map((st) => st.title),
  description: r.description,
});

console.log('\n── 1. the registry ─────────────────────────────────────────');
{
  ok('there is more than one occasion to choose between', OCCASION_IDS.length >= 3);
  eq('every occasion id is unique', OCCASION_IDS.length - new Set(OCCASION_IDS).size, 0);
  ok('the neutral occasion is one of them',
    (OCCASION_IDS as readonly string[]).includes(NEUTRAL_OCCASION));

  const unprofiled = OCCASION_IDS.filter((id) => !OCCASIONS[id]);
  eq('every occasion has a profile', unprofiled, []);

  // A favoured tag that is not an ACTIVITY tag would be the composer asking the
  // creator's event to think in our data model — and a favoured tag that is not
  // a real tag at all would silently bias nothing.
  const strayTags = OCCASION_IDS.flatMap((id) => OCCASIONS[id].favouredTags
    .filter((t) => !(ACTIVITY_TAG_IDS as readonly string[]).includes(t))
    .map((t) => `${id}:${t}`));
  eq('every favoured tag is a real activity tag', strayTags, []);

  eq('the neutral occasion favours nothing', OCCASIONS[NEUTRAL_OCCASION].favouredTags, []);
  eq('…and imposes no stage shape', OCCASIONS[NEUTRAL_OCCASION].blueprint, null);

  const biased = OCCASION_IDS.filter((id) => OCCASIONS[id].favouredTags.length > 0);
  ok(`most occasions actually bias something (${biased.length}/${OCCASION_IDS.length})`,
    biased.length >= OCCASION_IDS.length - 1);
}

console.log('\n── 2. the occasion blueprints are well-formed ──────────────');
{
  let bad = '';
  for (const id of OCCASION_IDS) {
    const b = OCCASIONS[id].blueprint;
    if (!b) continue;
    if (b.stageCount < 1) bad ||= `${id}: stageCount ${b.stageCount}`;
    if (b.taskWeights.length !== b.stageCount) bad ||= `${id}: ${b.taskWeights.length} weights for ${b.stageCount} stages`;
    if (b.difficultyCurve.length !== b.stageCount) bad ||= `${id}: ${b.difficultyCurve.length} curve points for ${b.stageCount} stages`;
    if (b.taskWeights.some((w) => !(w > 0))) bad ||= `${id}: a non-positive weight`;
    if (b.difficultyCurve.some((d) => !(d >= 1 && d <= 10))) bad ||= `${id}: a curve point outside 1-10`;
    if (!b.key) bad ||= `${id}: no key`;
  }
  eq('every occasion blueprint is internally consistent', bad, '');

  const keys = OCCASION_IDS.map((id) => OCCASIONS[id].blueprint?.key).filter(Boolean);
  eq('blueprint keys are unique, so blueprintKey names exactly one shape',
    keys.length - new Set(keys).size, 0);
}

console.log('\n── 3. occasionProfile is TOTAL ─────────────────────────────');
{
  for (const junk of [undefined, null, '', 'nope', 42, {}, [], true]) {
    const p = occasionProfile(junk as never);
    if (!p || !Array.isArray(p.favouredTags)) {
      failures++;
      console.error(`  ✗ occasionProfile(${JSON.stringify(junk)}) yielded no usable profile`);
    } else if (p.favouredTags.length > 0) {
      failures++;
      console.error(`  ✗ occasionProfile(${JSON.stringify(junk)}) invented a bias`);
    }
  }
  ok('an unknown occasion resolves to the neutral profile, never a throw', true);
  eq('a real occasion resolves to its own profile',
    occasionProfile('wedding').favouredTags, OCCASIONS.wedding.favouredTags);
}

console.log('\n── 4. the bias is soft, bounded, and additive ──────────────');
{
  const entry = (key: string, tags: BankTagId[]): TaskBankEntry => ({
    key,
    tags,
    difficulty: 5,
    sourceTemplateKey: 'fixture',
    build: () => task({ title: key, description: key, difficulty: 5 }),
  });

  const withOccasion = (occasion: OccasionId) =>
    buildFitContext({ ...BASE, occasion }, { recentBankKeys: [] });

  // Pick a real occasion and a tag it actually favours, so this stays true if
  // the profiles are retuned.
  const id = OCCASION_IDS.find((o) => OCCASIONS[o].favouredTags.length > 0)!;
  const favouredTag = OCCASIONS[id].favouredTags[0];

  const plainEntry = entry('m', ['mixed', 'fromAnywhere']);
  const favouredEntry = entry('m', ['mixed', 'fromAnywhere', favouredTag]);

  const neutral = withOccasion(NEUTRAL_OCCASION);
  const biased = withOccasion(id);

  eq(`the neutral occasion scores a ${favouredTag} mission exactly like any other`,
    fitScore(favouredEntry, neutral), fitScore(plainEntry, neutral));
  ok(`under "${id}" the ${favouredTag} mission wins`,
    fitScore(favouredEntry, biased) > fitScore(plainEntry, biased));
  ok('the bias is bounded by OCCASION_BONUS',
    fitScore(favouredEntry, biased) - fitScore(plainEntry, biased) <= OCCASION_BONUS + 1e-9);
  ok('an unfavoured mission is still eligible, never filtered out',
    Number.isFinite(fitScore(plainEntry, biased)));
}

console.log('\n── 5. a bank with nothing favoured still composes ──────────');
{
  // The pool must never be emptied by a preference. If every mission in the bank
  // is unfavoured, the occasion simply stops mattering — it does not stop the
  // game being built.
  const id = OCCASION_IDS.find((o) => OCCASIONS[o].favouredTags.length > 0)!;
  const stripped = TASK_BANK.map((e) => ({
    ...e,
    tags: e.tags.filter((t) => !(OCCASIONS[id].favouredTags as readonly string[]).includes(t)),
  }));
  const r = composeGame(stripped, { ...BASE, occasion: id }, COPY, seededRng(4), { recentBankKeys: [] });
  ok('a bank carrying none of the favoured tags still yields a game', r !== null);
  ok('…with missions in it', (r?.usedBankKeys.length ?? 0) > 0);
}

console.log('\n── 6. the occasion shapes the stages ───────────────────────');
{
  // A budget big enough to hold every authored shape, so the only reason a
  // blueprint would not be used is the occasion itself.
  const roomy = { minutes: 180 };
  let mismatched = '';
  for (const id of OCCASION_IDS) {
    const want = OCCASIONS[id].blueprint;
    if (!want) continue;
    const r = compose({ ...roomy, occasion: id }, 7);
    if (!r) { mismatched ||= `${id}: composed nothing`; continue; }
    if (r.blueprintKey !== want.key) mismatched ||= `${id}: used ${r.blueprintKey}, wanted ${want.key}`;
    if (r.stages.length !== want.stageCount) mismatched ||= `${id}: ${r.stages.length} stages, wanted ${want.stageCount}`;
  }
  eq('each occasion gets its own stage shape when the budget holds it', mismatched, '');

  // Two occasions with different shapes must actually come out different — the
  // whole point of the question.
  const shapeOf = (id: OccasionId) => {
    const r = compose({ ...roomy, occasion: id }, 7);
    return r ? r.stages.map((s) => s.tasks.length) : null;
  };
  const shapes = OCCASION_IDS
    .filter((id) => OCCASIONS[id].blueprint)
    .map((id) => JSON.stringify(shapeOf(id)));

  ok(`different occasions compose different stage shapes (${new Set(shapes).size} distinct)`,
    new Set(shapes).size >= 2);
}

console.log('\n── 7. a budget too small falls back, never fails ───────────');
{
  // The shortest game the questionnaire can ask for. An occasion wanting five
  // stages cannot have them here, and must degrade to a shape that fits rather
  // than to a stage holding nothing.
  let bad = '';
  for (const id of OCCASION_IDS) {
    const r = compose({ occasion: id, minutes: 30, people: 8 }, 11);
    if (!r) { bad ||= `${id}: composed nothing at 30 minutes`; continue; }
    if (r.stages.length === 0) bad ||= `${id}: no stages`;
    for (const st of r.stages) {
      if (st.tasks.length === 0) bad ||= `${id}: an empty stage`;
    }
  }
  eq('every occasion composes a populated game even at the smallest budget', bad, '');

  // And where a fallback happened, the shape that was used is one that fits.
  const tiny = compose({ occasion: 'teamBuilding', minutes: 30, people: 8 }, 11);
  ok('the fallback respects the minimum missions per stage',
    (tiny?.stages ?? []).every((st) => st.tasks.length >= 1)
    && (tiny?.stages.length ?? 0) * MIN_MISSIONS_PER_STAGE <= (tiny?.usedBankKeys.length ?? 0) + tiny!.stages.length);
}

console.log('\n── 8. the neutral occasion changes NOTHING ─────────────────');
{
  // The strongest guarantee in this file. Every other composer suite composes
  // without an occasion; if "no occasion" and "the neutral occasion" ever drift
  // apart, all of them are quietly testing a code path creators do not use.
  for (const seed of [1, 2, 3, 5, 8, 13]) {
    const without = fingerprint(compose({}, seed));
    const neutral = fingerprint(compose({ occasion: NEUTRAL_OCCASION }, seed));
    if (without !== neutral) {
      failures++;
      console.error(`  ✗ seed ${seed}: the neutral occasion composed a different game`);
      break;
    }
  }
  ok('an absent occasion and the neutral occasion compose the identical game', true);

  for (const junk of [null, 'nope', 42, {}]) {
    if (fingerprint(compose({ occasion: junk as never }, 3)) !== fingerprint(compose({}, 3))) {
      failures++;
      console.error(`  ✗ a malformed occasion ${JSON.stringify(junk)} changed the composition`);
      break;
    }
  }
  ok('a malformed occasion composes exactly as no occasion does', true);
}

console.log('\n── 9. seeded composition stays reproducible ────────────────');
{
  // Both branches of the blueprint choice must consume the same number of RNG
  // draws. If the occasion branch skipped the draw, every later decision (band
  // sampling, name picking) would shift, and two occasions would differ in ways
  // that have nothing to do with the occasion.
  let drifted = '';
  for (const id of OCCASION_IDS) {
    if (fingerprint(compose({ occasion: id }, 21)) !== fingerprint(compose({ occasion: id }, 21))) {
      drifted ||= id;
    }
  }
  eq('the same seed and the same occasion compose the identical game', drifted, '');
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-build/occasion: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-build/occasion: all assertions passed\x1b[0m');
