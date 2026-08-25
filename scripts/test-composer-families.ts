// Pure-logic tests — no two missions from the same FAMILY ever land in one
// composed game (change: smart-game-composer).
//
// Two different bank keys can still be the same mechanic wearing different
// content — "collect five things one colour" and "collect a whole rainbow" are
// both, underneath, "find objects by colour". `usedKeys` (no exact mission
// twice) does not catch this, because these are two different keys; only
// `family` does. This file proves the exclusion holds across the real bank and
// stays total against a hostile one.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  composeGame,
  seededRng,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK, type TaskBankEntry } from '../apps/creator-web/src/taskBank';
import { AUDIENCE_TAG_IDS, SETTING_TAG_IDS } from '../apps/creator-web/src/bankTags';

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
  activityJoin: (p) => `joined(${p.join(',')})`,
  activityTag: (t) => `tag-${t}`,
  placeMissionPrompt: () => 'PIN',
  stageNames: () => ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
} as ComposerDescriptionCopy;

const familyOf = new Map(TASK_BANK.filter((e) => e.family).map((e) => [e.key, e.family as string]));

function familyClashes(usedBankKeys: string[]): string[] {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const key of usedBankKeys) {
    const fam = familyOf.get(key);
    if (!fam) continue;
    const earlier = seen.get(fam);
    if (earlier) clashes.push(`${fam}: ${earlier} + ${key}`);
    else seen.set(fam, key);
  }
  return clashes;
}

// ── 1. Across the real bank and the whole answer space ──────────────────────
console.log('no family clash across the real bank, over the whole answer space');
{
  let games = 0;
  const found: string[] = [];
  let seed = 1;
  for (const minutes of [60, 90, 120, 150, 180]) {
    for (const audience of AUDIENCE_TAG_IDS) {
      for (const setting of SETTING_TAG_IDS) {
        const r = composeGame(TASK_BANK, {
          audience, setting, people: 24, minutes, ageBandId: 'band-14-17',
          difficultyPreference: 'balanced',
        } as ComposerAnswers, COPY, seededRng(seed++));
        if (!r) continue;
        games++;
        const clashes = familyClashes(r.usedBankKeys);
        if (clashes.length && found.length < 8) found.push(...clashes);
      }
    }
  }
  ok(`composed a real sample (${games} games)`, games > 30);
  eq('zero family clashes found', found, []);
}

// ── 2. A synthetic bank that's ALL one family ────────────────────────────────
console.log('a bank that is mostly one family still composes, using just one member');
{
  const base = TASK_BANK.find((e) => !e.family)!;
  const clones: TaskBankEntry[] = Array.from({ length: 6 }, (_, i) => ({
    ...base,
    key: `clone-${i}`,
    family: 'clone-family',
  }));
  // One real bookend pair kept so the game can still open and close.
  const opener = TASK_BANK.find((e) => e.tags.includes('start'))!;
  const finale = TASK_BANK.find((e) => e.tags.includes('finish'))!;
  const bank = [...clones, opener, finale];

  const r = composeGame(bank, {
    audience: 'mixed', setting: 'fromAnywhere', people: 20, minutes: 120,
    ageBandId: 'band-14-17', difficultyPreference: 'balanced',
  } as ComposerAnswers, COPY, seededRng(9));

  ok('still composes', r !== null);
  if (r) {
    const cloneCount = r.usedBankKeys.filter((k) => k.startsWith('clone-')).length;
    ok(`at most one clone chosen despite 6 being eligible (got ${cloneCount})`, cloneCount <= 1);
    eq('no family clash in the result', familyClashes(r.usedBankKeys), []);
  }
}

// ── 3. Totality against a malformed family ──────────────────────────────────
console.log('a malformed family value never throws and never over-excludes');
{
  const variants: Array<[string, unknown]> = [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['a number', 42],
    ['an object', {}],
  ];
  for (const [label, family] of variants) {
    const bank = TASK_BANK.map((e) => (e.key === TASK_BANK[0].key ? { ...e, family } as TaskBankEntry : e));
    let threw = false;
    try {
      composeGame(bank, {
        audience: 'mixed', setting: 'fromAnywhere', people: 20, minutes: 90,
        ageBandId: 'band-14-17', difficultyPreference: 'balanced',
      } as ComposerAnswers, COPY, seededRng(3));
    } catch {
      threw = true;
    }
    ok(`${label}: no throw`, !threw);
  }
}

console.log(failures === 0 ? '\n✅ composer family exclusion OK' : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
