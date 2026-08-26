// Pure-logic tests — the creator's prep-effort budget is respected
// (change: smart-game-composer).
//
// Missions are not equally expensive to run. Most cost the creator nothing: the
// team plays them wherever they are standing. Some cost an afternoon — hide a
// key and lock a box, walk a route and count the steps, prepare an object per
// team. And three cost something categorically different: go to a business, PAY
// them, and get the owner to agree to hand a code to strangers. That last tier
// only works for a creator who signed up for it.
//
// The bank always carried `needsSetup`/`noPrep` tags, and the composer scored on
// NEITHER. A creator who wanted to press a button and run a game an hour later
// could be handed a mission that required striking a deal with a stall owner —
// and would only find out when Quick Setup told them to. This file is the
// guarantee that the answer they give is actually honoured.
//
// The tolerance is a HARD filter, not a preference. "I am not coordinating with
// a business" is a statement about the creator's world, not a scoring nudge:
// there is no amount of good fit that makes such a mission acceptable to them.
//
// ─── The answer is a 1-5 rating; the bank still has three tiers ────────────────
//
// (change: smart-build-occasion-and-prep-scale.) The creator now answers on a
// CUMULATIVE 1-5 scale, because the three chips missed a step creators kept
// naming out loud: "I'll just put the missions on real spots". That costs
// something real, and it is not the same as preparing props. The MISSION bank is
// unchanged — still three tiers — so this file pins the mapping between the two:
// 1,2 -> noPrep only · 3,4 -> self-prep · 5 -> outside partner. Levels 3 and 4
// deliberately admit the SAME missions; 4 differs only by PREFERRING missions
// pinned to real spots, which is a scoring nudge, not a fourth tier the bank has
// no tag for.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  composeGame,
  seededRng,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import {
  PREP_SCALE, PREP_TAG_IDS, prepTierOf, prepToleranceOf, prepWantsPlacedMissions,
} from '../apps/creator-web/src/bankTags';

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
  stageNames: () => ['S'],
  placeMissionPrompt: () => 'PLACE_IT',
};

const BASE: ComposerAnswers = {
  audience: 'mixed', setting: 'outdoor', people: 24, minutes: 120,
  ageBandId: 'band-14-17', difficultyPreference: 'balanced',
};

const byKey = new Map(TASK_BANK.map((e) => [e.key, e]));
const tierOfKey = (k: string) => prepTierOf(byKey.get(k)?.tags);

console.log('\n── 1. the scale, and how it maps onto the tiers ───────────');
{
  eq('the tiers are ordered cheapest first', [...PREP_TAG_IDS], ['noPrep', 'needsSetup', 'needsPartner']);
  eq('the answer scale is 1-5', [...PREP_SCALE], [1, 2, 3, 4, 5]);

  // The whole mapping, in one table. Cumulative: a level never tolerates LESS
  // than the level below it.
  eq('1 - no prep at all', prepToleranceOf(1), 0);
  eq('2 - places missions, but prepares nothing', prepToleranceOf(2), 0);
  eq('3 - prepares things at home', prepToleranceOf(3), 1);
  eq('4 - sets up on site', prepToleranceOf(4), 1);
  eq('5 - coordinates with an outside party', prepToleranceOf(5), 2);
  ok('the mapping is monotone', PREP_SCALE.every((l, i) =>
    i === 0 || prepToleranceOf(l) >= prepToleranceOf(PREP_SCALE[i - 1])));

  // The step the scale exists for: "just put them on the map".
  eq('level 1 pins nothing', prepWantsPlacedMissions(1), false);
  for (const level of [2, 3, 4, 5]) {
    eq(`level ${level} pins missions to real spots`, prepWantsPlacedMissions(level), true);
  }

  // A malformed answer must never silently buy the most expensive tier — and
  // must never silently impose work either.
  for (const junk of [undefined, null, '', 'nope', 'full', 0, 9, -3, 2.5, NaN, {}, []]) {
    if (prepToleranceOf(junk) >= 2) {
      failures++;
      console.error(`  ✗ junk level ${JSON.stringify(junk)} allowed an outside partner`);
    }
    if (prepWantsPlacedMissions(junk) !== false) {
      failures++;
      console.error(`  ✗ junk level ${JSON.stringify(junk)} silently demanded placed missions`);
    }
  }
  ok('no junk answer buys the outside-partner tier or imposes placing', true);

  eq('an untagged mission costs nothing', prepTierOf([]), 0);
  eq('a mission carrying two tiers costs the HIGHER one',
    prepTierOf(['noPrep', 'needsPartner']), 2);
  eq('prepTierOf is total on junk', prepTierOf(undefined as never), 0);
}

console.log('\n── 2. the bank really has all three tiers ──────────────────');
{
  const counts = [0, 0, 0];
  for (const e of TASK_BANK) counts[prepTierOf(e.tags)]++;
  ok(`tier 0 is the bulk of the bank (${counts[0]})`, counts[0] >= 20);
  ok(`tier 1 exists (${counts[1]})`, counts[1] >= 3);
  ok(`tier 2 exists (${counts[2]})`, counts[2] >= 1);

  const untagged = TASK_BANK
    .filter((e) => !e.tags.some((t) => (PREP_TAG_IDS as readonly string[]).includes(t)))
    .map((e) => e.key);
  eq('every mission declares what it costs the creator', untagged, []);
}

console.log('\n── 3. level 1 never yields a mission that needs prep ───────');
{
  let violation = '';
  let composed = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = composeGame(TASK_BANK, { ...BASE, prepEffort: 1 }, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) continue;
    composed++;
    for (const k of r.usedBankKeys) {
      if (tierOfKey(k) > 0) violation ||= `seed ${seed}: "${k}" is tier ${tierOfKey(k)}`;
    }
  }
  ok(`composed ${composed} zero-prep games`, composed >= 30);
  eq('not one mission asks the creator to prepare anything', violation, '');
}

console.log('\n── 4. level 3 allows self-prep, never an outside partner ───');
{
  let violation = '';
  let sawSelfPrep = false;
  for (let seed = 1; seed <= 40; seed++) {
    const r = composeGame(TASK_BANK, { ...BASE, prepEffort: 3 }, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) continue;
    for (const k of r.usedBankKeys) {
      const t = tierOfKey(k);
      if (t === 1) sawSelfPrep = true;
      if (t > 1) violation ||= `seed ${seed}: "${k}" needs an outside partner`;
    }
  }
  eq('no mission requires coordinating with a business', violation, '');
  ok('self-prep missions ARE offered at this level', sawSelfPrep);
}

console.log('\n── 5. level 5 opens the whole bank ──────────────────────────');
{
  const seen = new Set<number>();
  for (let seed = 1; seed <= 60; seed++) {
    const r = composeGame(TASK_BANK, { ...BASE, prepEffort: 5 }, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) continue;
    for (const k of r.usedBankKeys) seen.add(tierOfKey(k));
  }
  ok(`the highest tier becomes reachable (saw tiers ${[...seen].sort().join(', ')})`, seen.has(2));
}

console.log('\n── 6. the default is safe ──────────────────────────────────');
{
  // An ABSENT answer must behave like level 3: a creator who never saw the
  // question is never handed a mission that requires paying a third party.
  let violation = '';
  for (let seed = 1; seed <= 40; seed++) {
    const r = composeGame(TASK_BANK, BASE, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) continue;
    for (const k of r.usedBankKeys) {
      if (tierOfKey(k) > 1) violation ||= `seed ${seed}: "${k}" needs an outside partner`;
    }
  }
  eq('an absent prep answer never buys an outside partner', violation, '');
}

console.log('\n── 7. a tighter budget still yields a real game ────────────');
{
  // The filter must not starve the composer. Zero-prep is the tightest setting
  // and it still has to produce a complete, populated game.
  for (const prepEffort of PREP_SCALE) {
    const r = composeGame(TASK_BANK, { ...BASE, prepEffort }, COPY, seededRng(3), { recentBankKeys: [] });
    if (!r) { failures++; console.error(`  ✗ "${prepEffort}" produced no game at all`); continue; }
    if (r.stages.some((s) => s.tasks.length === 0)) {
      failures++; console.error(`  ✗ "${prepEffort}" produced an empty stage`);
    }
  }
  ok('every prep level composes a complete game', true);

  // Tightening the budget must never INCREASE the mission count.
  const counts = PREP_SCALE.map((prepEffort) => {
    const r = composeGame(TASK_BANK, { ...BASE, prepEffort }, COPY, seededRng(3), { recentBankKeys: [] });
    return r ? r.usedBankKeys.length : 0;
  });
  ok(`a looser budget never yields fewer missions (${counts.join(' <= ')})`,
    counts.every((v, i) => i === 0 || v >= counts[i - 1]));
}

console.log('\n── 7b. levels 3 and 4 admit the SAME missions ──────────');
{
  // Level 4 ("I'll go there beforehand and set it up") is a PREFERENCE for
  // missions pinned to real spots, not a new tier. If it ever unlocked a mission
  // level 3 could not receive, the scale would have grown a fourth tier the bank
  // has no tag for — and a creator at level 3 would be silently denied something
  // they had already agreed to.
  const seenAt = (level: number): Set<string> => {
    const keys = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const r = composeGame(TASK_BANK, { ...BASE, prepEffort: level as never }, COPY,
        seededRng(seed), { recentBankKeys: [] });
      for (const k of r?.usedBankKeys ?? []) keys.add(k);
    }
    return keys;
  };
  const three = seenAt(3);
  const four = seenAt(4);
  const beyondThree = [...four].filter((k) => tierOfKey(k) > prepToleranceOf(3));
  eq('level 4 unlocks no tier level 3 was denied', beyondThree, []);
  ok(`both levels draw on a real pool (${three.size} / ${four.size} missions)`,
    three.size >= 10 && four.size >= 10);
}

console.log('\n── 8. total — junk prep answers never throw ────────────────');
{
  let threw = '';
  for (const junk of [undefined, null, '', 'nope', 'full', 0, 9, NaN, {}, [], true]) {
    try {
      const r = composeGame(TASK_BANK, { ...BASE, prepEffort: junk as never }, COPY, seededRng(1), { recentBankKeys: [] });
      if (r) {
        for (const k of r.usedBankKeys) {
          if (tierOfKey(k) > 1) threw ||= `${JSON.stringify(junk)} bought an outside partner`;
        }
      }
    } catch (e) {
      threw ||= `${JSON.stringify(junk)}: THREW ${String(e)}`;
    }
  }
  eq('every junk prep answer is safe and non-fatal', threw, '');
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/prep: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/prep: all assertions passed\x1b[0m');
