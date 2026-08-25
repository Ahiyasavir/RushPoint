// Pure-logic tests — the composed description and gallery tags
// (change: smart-game-composer).
//
// A composed game has no author to write its blurb, so the composer writes one.
// The failure mode to design against is a description that describes a DIFFERENT
// game — "a game of photo missions and riddles" on a game with neither. That is
// worse than no description: it is a confident lie on the creator's own game
// card. So the rule is narrow — the description may only ever name activity
// kinds that are actually present among the chosen missions — and it is asserted
// by tracing sentinel copy back to the tag that produced it.
//
// The other half is language. composeGame.ts must hold NO Hebrew and NO English
// of its own, exactly like lib/describeNewGame.ts: every human-readable word
// arrives through the injected copy object. That is what lets one composer serve
// a Hebrew creator and an English one, and it is what keeps the i18n gate
// meaningful. §6 asserts it against the source file itself.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  composeGame,
  seededRng,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { MAX_BLENDED_DESCRIPTION_LEN } from '../apps/creator-web/src/lib/describeNewGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { ACTIVITY_TAG_IDS, BANK_TAG_IDS } from '../apps/creator-web/src/bankTags';
import { normalizeTags, MAX_TAGS } from '@rushpoint/shared';

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

/** Sentinels, so every produced word can be traced back to the input that made it. */
const COPY: ComposerDescriptionCopy = {
  lead: ({ people, minutes, ageLabel }) => `BLENDLEAD(${people},${minutes},${ageLabel})`,
  ageLabel: (b) => `AGELABEL[${b}]`,
  ageTag: (b) => `agetag-${b}`,
  durationTag: (m) => `durtag-${m}`,
  composedLead: ({ people, minutes, ageLabel }) => `COMPOSEDLEAD(${people},${minutes},${ageLabel})`,
  activityPhrase: (t) => `PHRASE<${t}>`,
  activityJoin: (p) => p.join(' AND '),
  activityTag: (t) => `acttag-${t}`,
  placeMissionPrompt: () => 'PLACE_IT',
};

const ANSWERS: ComposerAnswers = {
  audience: 'youth', setting: 'outdoor', people: 24, minutes: 90,
  ageBandId: 'band-14-17', difficultyPreference: 'balanced',
};

const compose = (seed: number, answers: ComposerAnswers = ANSWERS, copy = COPY) =>
  composeGame(TASK_BANK, answers, copy, seededRng(seed), { recentBankKeys: [] });

/** The activity tags actually carried by the missions a result chose. */
function presentActivities(usedKeys: string[]): Set<string> {
  const byKey = new Map(TASK_BANK.map((e) => [e.key, e]));
  const out = new Set<string>();
  for (const k of usedKeys) {
    for (const t of byKey.get(k)?.tags ?? []) {
      if ((ACTIVITY_TAG_IDS as readonly string[]).includes(t)) out.add(t);
    }
  }
  return out;
}

console.log('\n── 1. the description is real, single-paragraph text ───────');
{
  let bad = '';
  for (let seed = 1; seed <= 30; seed++) {
    const r = compose(seed);
    if (!r) { bad ||= `seed ${seed}: null`; continue; }
    if (typeof r.description !== 'string' || r.description.trim() === '') bad ||= `seed ${seed}: empty`;
    if (/[\r\n]/.test(r.description)) bad ||= `seed ${seed}: contains a newline`;
    if (/\s{2,}/.test(r.description)) bad ||= `seed ${seed}: contains a double space`;
    if (r.description !== r.description.trim()) bad ||= `seed ${seed}: not trimmed`;
  }
  eq('every description is non-empty, trimmed and one paragraph', bad, '');
}

console.log('\n── 2. the description names the creator\'s own answers ──────');
{
  const r = compose(3, { ...ANSWERS, people: 24, minutes: 90, ageBandId: 'band-14-17' });
  ok('composition succeeded', r !== null);
  if (r) {
    ok('the composed lead is used (not the template-blend lead)',
      r.description.includes('COMPOSEDLEAD(') && !r.description.includes('BLENDLEAD('));
    ok('the group size reaches the lead', r.description.includes('24'));
    ok('the duration reaches the lead', r.description.includes('90'));
    ok('the age label reaches the lead', r.description.includes('AGELABEL[band-14-17]'));
  }
}

console.log('\n── 3. it only ever names activities that are really there ──');
{
  let lied = '';
  let named = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = compose(seed);
    if (!r) continue;
    const present = presentActivities(r.usedBankKeys);

    for (const tag of ACTIVITY_TAG_IDS) {
      const sentinel = `PHRASE<${tag}>`;
      if (r.description.includes(sentinel)) {
        named++;
        if (!present.has(tag)) lied ||= `seed ${seed}: named "${tag}" but no chosen mission carries it`;
      }
    }
  }
  eq('the description never names an activity the game does not contain', lied, '');
  ok(`activities really are named (${named} mentions across 40 games)`, named > 0);
}

console.log('\n── 4. at most two activities, and the cap is honoured ──────');
{
  let tooMany = '';
  for (let seed = 1; seed <= 40; seed++) {
    const r = compose(seed);
    if (!r) continue;
    const count = ACTIVITY_TAG_IDS.filter((t) => r.description.includes(`PHRASE<${t}>`)).length;
    if (count > 2) tooMany ||= `seed ${seed}: named ${count}`;
  }
  eq('no description names more than two activities', tooMany, '');
}

console.log('\n── 5. the length bound holds, even against absurd copy ─────');
{
  let over = '';
  for (let seed = 1; seed <= 30; seed++) {
    const r = compose(seed);
    if (r && r.description.length > MAX_BLENDED_DESCRIPTION_LEN) over ||= `seed ${seed}: ${r.description.length}`;
  }
  eq(`no description exceeds ${MAX_BLENDED_DESCRIPTION_LEN} characters`, over, '');

  // A copy provider returning enormous strings must be truncated, not trusted.
  const HUGE: ComposerDescriptionCopy = {
    ...COPY,
    composedLead: () => 'X'.repeat(5000),
    activityPhrase: (t) => `${'Y'.repeat(2000)}<${t}>`,
  };
  const huge = compose(1, ANSWERS, HUGE);
  ok('an enormous lead is still truncated to the bound',
    huge !== null && huge.description.length <= MAX_BLENDED_DESCRIPTION_LEN);

  // …and one returning nothing must not produce an empty description or a crash.
  const EMPTY: ComposerDescriptionCopy = {
    lead: () => '', ageLabel: () => '', ageTag: () => '', durationTag: () => '',
    composedLead: () => '', activityPhrase: () => '', activityJoin: () => '', activityTag: () => '',
  };
  const empty = compose(1, ANSWERS, EMPTY);
  ok('empty copy still yields a string description, not a throw',
    empty !== null && typeof empty.description === 'string');

  const BROKEN = {
    ...COPY,
    composedLead: () => undefined as unknown as string,
    activityPhrase: () => undefined as unknown as string,
    activityJoin: () => undefined as unknown as string,
  } as ComposerDescriptionCopy;
  const broken = compose(1, ANSWERS, BROKEN);
  ok('copy returning undefined still yields a string description',
    broken !== null && typeof broken.description === 'string');
}

console.log('\n── 6. tags describe the game and survive normalisation ─────');
{
  let bad = '';
  for (let seed = 1; seed <= 30; seed++) {
    const r = compose(seed);
    if (!r) continue;

    if (!Array.isArray(r.tags)) { bad ||= `seed ${seed}: not an array`; continue; }
    if (r.tags.length > MAX_TAGS) bad ||= `seed ${seed}: ${r.tags.length} tags`;
    if (r.tags.some((t) => typeof t !== 'string' || t.trim() === '')) bad ||= `seed ${seed}: blank tag`;

    // Idempotence: what the composer emits must be exactly what the server's own
    // normaliser would produce, or `updateGame` silently rewrites it.
    if (JSON.stringify(normalizeTags(r.tags)) !== JSON.stringify(r.tags)) {
      bad ||= `seed ${seed}: normalizeTags changes the emitted tags`;
    }
    if (new Set(r.tags).size !== r.tags.length) bad ||= `seed ${seed}: duplicate tag`;
  }
  eq('every tag list is normalised, bounded and duplicate-free', bad, '');

  const r = compose(5);
  if (r) {
    ok('the age word from the shared deriver is present',
      r.tags.some((t) => t.includes('agetag-')));
    ok('the duration word from the shared deriver is present',
      r.tags.some((t) => t.includes('durtag-')));

    const present = presentActivities(r.usedBankKeys);
    const activityTags = r.tags.filter((t) => t.startsWith('acttag-'));
    ok('activity words are present', activityTags.length > 0);
    ok('every activity word names an activity the game really has',
      activityTags.every((t) => present.has(t.replace('acttag-', ''))));
  }
}

console.log('\n── 7. no raw tag id ever reaches the creator ───────────────');
{
  // A BankTagId is an internal identifier. `needsSetup` on a game card, or
  // `fromAnywhere` in a gallery tag, is a leak of the data model into the UI.
  let leaked = '';
  for (let seed = 1; seed <= 30; seed++) {
    const r = compose(seed);
    if (!r) continue;
    for (const id of BANK_TAG_IDS) {
      // The sentinels deliberately WRAP the id (`PHRASE<camera>`, `acttag-camera`),
      // so a bare occurrence means the composer emitted the id itself.
      const bare = new RegExp(`(^|[^<a-zA-Z-])${id}([^>a-zA-Z-]|$)`);
      if (bare.test(r.description)) leaked ||= `seed ${seed}: "${id}" bare in description`;
      if (r.tags.some((t) => t === id)) leaked ||= `seed ${seed}: "${id}" as a raw tag`;
    }
  }
  eq('no bank tag id appears raw in a description or tag', leaked, '');
}

console.log('\n── 8. the composer holds no copy of its own ────────────────');
{
  // The same rule lib/describeNewGame.ts lives by. If this file ever contains
  // Hebrew, the English creator sees Hebrew; if it contains English prose, the
  // i18n gate stops being able to prove anything about this surface.
  const source = readFileSync(join(process.cwd(), 'apps/creator-web/src/lib/composeGame.ts'), 'utf8');

  // Strip comments — the module header is prose ABOUT the code, never rendered.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  const hebrew = code.match(/[֐-׿]/g) ?? [];
  eq('composeGame.ts contains no Hebrew outside comments', hebrew, []);

  // Any string literal long enough to be a sentence is a copy leak. Matched
  // LINE BY LINE: a literal that spans a newline is not a literal, and letting
  // the match run across lines pairs up unrelated apostrophes and swallows the
  // whole file.
  const literals = code
    .split('\n')
    .flatMap((line) => line.match(/'[^']{25,}'|"[^"]{25,}"|`[^`]{25,}`/g) ?? []);
  const prose = literals.filter((l) => /[A-Za-z]{4,}\s+[A-Za-z]{4,}\s+[A-Za-z]{3,}/.test(l));
  eq('composeGame.ts contains no sentence-length English literal', prose, []);
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/description-tags: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/description-tags: all assertions passed\x1b[0m');
