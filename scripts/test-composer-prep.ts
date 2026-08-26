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
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  composeGame,
  seededRng,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { PREP_LEVELS, PREP_TAG_IDS, prepTierOf, prepToleranceOf } from '../apps/creator-web/src/bankTags';

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

console.log('\n── 1. the tier model itself ────────────────────────────────');
{
  eq('the tiers are ordered cheapest first', [...PREP_TAG_IDS], ['noPrep', 'needsSetup', 'needsPartner']);
  eq('there is one answer level per tier', PREP_LEVELS.length, PREP_TAG_IDS.length);

  eq('"none" tolerates only free missions', prepToleranceOf('none'), 0);
  eq('"light" tolerates self-prep', prepToleranceOf('light'), 1);
  eq('"full" tolerates an outside partner', prepToleranceOf('full'), 2);

  // A malformed answer must never silently buy the most expensive tier.
  for (const junk of [undefined, null, '', 'nope', 42, {}, []]) {
    if (prepToleranceOf(junk) >= 2) {
      failures++;
      console.error(`  ✗ junk tolerance ${JSON.stringify(junk)} allowed an outside partner`);
    }
  }
  ok('no junk answer ever buys the outside-partner tier', true);

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

console.log('\n── 3. "no prep" never yields a mission that needs prep ─────');
{
  let violation = '';
  let composed = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = composeGame(TASK_BANK, { ...BASE, prepEffort: 'none' }, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) continue;
    composed++;
    for (const k of r.usedBankKeys) {
      if (tierOfKey(k) > 0) violation ||= `seed ${seed}: "${k}" is tier ${tierOfKey(k)}`;
    }
  }
  ok(`composed ${composed} zero-prep games`, composed >= 30);
  eq('not one mission asks the creator to prepare anything', violation, '');
}

console.log('\n── 4. "light" allows self-prep but never an outside partner ');
{
  let violation = '';
  let sawSelfPrep = false;
  for (let seed = 1; seed <= 40; seed++) {
    const r = composeGame(TASK_BANK, { ...BASE, prepEffort: 'light' }, COPY, seededRng(seed), { recentBankKeys: [] });
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

console.log('\n── 5. "full" opens the whole bank ──────────────────────────');
{
  const seen = new Set<number>();
  for (let seed = 1; seed <= 60; seed++) {
    const r = composeGame(TASK_BANK, { ...BASE, prepEffort: 'full' }, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) continue;
    for (const k of r.usedBankKeys) seen.add(tierOfKey(k));
  }
  ok(`the highest tier becomes reachable (saw tiers ${[...seen].sort().join(', ')})`, seen.has(2));
}

console.log('\n── 6. the default is safe ──────────────────────────────────');
{
  // An ABSENT answer must behave like "light": a creator who never saw the
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
  for (const prepEffort of PREP_LEVELS) {
    const r = composeGame(TASK_BANK, { ...BASE, prepEffort }, COPY, seededRng(3), { recentBankKeys: [] });
    if (!r) { failures++; console.error(`  ✗ "${prepEffort}" produced no game at all`); continue; }
    if (r.stages.some((s) => s.tasks.length === 0)) {
      failures++; console.error(`  ✗ "${prepEffort}" produced an empty stage`);
    }
  }
  ok('every prep level composes a complete game', true);

  // Tightening the budget must never INCREASE the mission count.
  const counts = PREP_LEVELS.map((prepEffort) => {
    const r = composeGame(TASK_BANK, { ...BASE, prepEffort }, COPY, seededRng(3), { recentBankKeys: [] });
    return r ? r.usedBankKeys.length : 0;
  });
  ok(`a looser budget never yields fewer missions (${counts.join(' <= ')})`,
    counts.every((v, i) => i === 0 || v >= counts[i - 1]));
}

console.log('\n── 8. total — junk prep answers never throw ────────────────');
{
  let threw = '';
  for (const junk of [undefined, null, '', 'nope', 42, {}, [], true]) {
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
