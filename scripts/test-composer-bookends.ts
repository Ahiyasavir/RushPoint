// Pure-logic tests — a composed game opens with an opener and closes with a
// finale (change: smart-game-composer).
//
// A game assembled by picking "whatever fits best" from a pool has no shape: it
// can open on a hard riddle and end on a warm-up. Bookends are what make a
// composed game feel authored rather than shuffled.
//
// The subtle part is not the rule, it is the ORDER it is applied in. Filling
// slots left to right and hoping a finale is still available at the end does not
// work: an ordinary mid-game slot will happily consume the last `finish` mission,
// because from that slot's point of view it was simply the best fit. By the time
// the finale slot is reached the pool is empty and the game ends on a filler
// mission — or, worse, on nothing. So both bookends are RESERVED FIRST, before
// any ordinary slot is filled. §5 below is the regression test for exactly that,
// built from a bank where the only finale is also the best candidate everywhere.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  composeGame,
  seededRng,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import type { TaskBankEntry } from '../apps/creator-web/src/taskBank';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
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

const ANSWERS: ComposerAnswers = {
  audience: 'youth', setting: 'outdoor', people: 24, minutes: 90,
  ageBandId: 'band-14-17', difficultyPreference: 'balanced',
};

function entry(key: string, tags: BankTagId[], difficulty = 5): TaskBankEntry {
  return {
    key, tags, difficulty, sourceTemplateKey: 'fixture',
    build: () => task({ title: key, description: key, difficulty }),
  };
}

/** Which bank key produced a given task — matched on the title the fixture sets. */
const keyOf = (t: { title?: string }) => t.title ?? '';

/** A bank with plenty of everything, so nothing is a forced pick. */
const RICH_BANK: TaskBankEntry[] = [
  ...Array.from({ length: 6 }, (_, i) => entry(`open-${i}`, ['start', 'youth', 'outdoor', 'fromAnywhere', 'camera'], 2 + (i % 3))),
  ...Array.from({ length: 6 }, (_, i) => entry(`end-${i}`, ['finish', 'youth', 'outdoor', 'fromAnywhere', 'teamwork'], 6 + (i % 3))),
  ...Array.from({ length: 24 }, (_, i) => entry(`mid-${i}`, ['youth', 'outdoor', 'fromAnywhere', i % 2 ? 'thinking' : 'action'], 1 + (i % 10))),
];

console.log('\n── 1. every composed game is bookended (fixture bank) ──────');
{
  let noOpener = ''; let noFinale = ''; let same = ''; let failed = '';

  for (let seed = 1; seed <= 60; seed++) {
    const r = composeGame(RICH_BANK, ANSWERS, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) { failed ||= `seed ${seed}`; continue; }

    const first = r.stages[0]?.tasks[0];
    const lastStage = r.stages[r.stages.length - 1];
    const last = lastStage?.tasks[lastStage.tasks.length - 1];

    const openerKey = keyOf(first ?? {});
    const finaleKey = keyOf(last ?? {});

    if (!openerKey.startsWith('open-')) noOpener ||= `seed ${seed}: ${openerKey}`;
    if (!finaleKey.startsWith('end-')) noFinale ||= `seed ${seed}: ${finaleKey}`;
    if (openerKey === finaleKey && r.usedBankKeys.length > 1) same ||= `seed ${seed}: ${openerKey}`;
  }

  eq('every seed composed successfully', failed, '');
  eq('the first mission of stage 0 is always an opener', noOpener, '');
  eq('the last mission of the final stage is always a finale', noFinale, '');
  eq('opener and finale are never the same mission', same, '');
}

console.log('\n── 2. bookends are SAMPLED, not fixed ──────────────────────');
{
  const openers = new Set<string>();
  const finales = new Set<string>();
  for (let seed = 1; seed <= 60; seed++) {
    const r = composeGame(RICH_BANK, ANSWERS, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) continue;
    const lastStage = r.stages[r.stages.length - 1];
    openers.add(keyOf(r.stages[0].tasks[0]));
    finales.add(keyOf(lastStage.tasks[lastStage.tasks.length - 1]));
  }
  ok(`more than one opener appears across seeds (saw ${openers.size})`, openers.size >= 2);
  ok(`more than one finale appears across seeds (saw ${finales.size})`, finales.size >= 2);
}

console.log('\n── 3. no mission is ever used twice ────────────────────────');
{
  let dupe = '';
  for (let seed = 1; seed <= 60; seed++) {
    const r = composeGame(RICH_BANK, ANSWERS, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) continue;
    if (new Set(r.usedBankKeys).size !== r.usedBankKeys.length) dupe ||= `seed ${seed}`;

    const titles = r.stages.flatMap((s) => s.tasks.map(keyOf));
    if (new Set(titles).size !== titles.length) dupe ||= `seed ${seed} (titles)`;
  }
  eq('no bank entry appears twice in one game', dupe, '');
}

console.log('\n── 4. a bank with exactly one of each still works ──────────');
{
  const THIN: TaskBankEntry[] = [
    entry('the-opener', ['start', 'youth', 'outdoor', 'fromAnywhere', 'camera'], 3),
    entry('the-finale', ['finish', 'youth', 'outdoor', 'fromAnywhere', 'teamwork'], 7),
    ...Array.from({ length: 10 }, (_, i) => entry(`mid-${i}`, ['youth', 'outdoor', 'fromAnywhere', 'thinking'], 5)),
  ];

  let bad = '';
  for (let seed = 1; seed <= 30; seed++) {
    const r = composeGame(THIN, ANSWERS, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) { bad ||= `seed ${seed}: null`; continue; }
    const lastStage = r.stages[r.stages.length - 1];
    if (keyOf(r.stages[0].tasks[0]) !== 'the-opener') bad ||= `seed ${seed}: opener`;
    if (keyOf(lastStage.tasks[lastStage.tasks.length - 1]) !== 'the-finale') bad ||= `seed ${seed}: finale`;
  }
  eq('the only opener and the only finale are used, every time', bad, '');
}

console.log('\n── 5. bookends are RESERVED before ordinary slots ──────────');
{
  // The regression test for filling left to right. `must-end` is the ONLY finale
  // AND is deliberately the strongest candidate for every ordinary slot too
  // (perfect audience, perfect setting, mid difficulty, matches the preferred
  // tag). A left-to-right filler consumes it in stage 0 and the game ends on
  // something else — or ends on nothing.
  const TRAP: TaskBankEntry[] = [
    entry('must-open', ['start', 'youth', 'outdoor', 'fromAnywhere', 'camera'], 5),
    entry('must-end', ['finish', 'youth', 'outdoor', 'fromAnywhere', 'camera'], 5),
    ...Array.from({ length: 20 }, (_, i) => entry(`weak-${i}`, ['corporate', 'indoor'], 10)),
  ];

  const answers: ComposerAnswers = { ...ANSWERS, preferredTags: ['camera'] };

  let bad = '';
  for (let seed = 1; seed <= 40; seed++) {
    const r = composeGame(TRAP, answers, COPY, seededRng(seed), { recentBankKeys: [] });
    if (!r) { bad ||= `seed ${seed}: null`; continue; }
    const lastStage = r.stages[r.stages.length - 1];
    const finale = keyOf(lastStage.tasks[lastStage.tasks.length - 1]);
    const opener = keyOf(r.stages[0].tasks[0]);
    if (finale !== 'must-end') bad ||= `seed ${seed}: finale was ${finale}`;
    if (opener !== 'must-open') bad ||= `seed ${seed}: opener was ${opener}`;
  }
  eq('the only finale survives to the finale slot even when it fits everywhere', bad, '');
}

console.log('\n── 6. the real bank behaves the same ───────────────────────');
{
  const AUDIENCES = ['kids', 'youth', 'adults', 'corporate', 'mixed'] as const;
  const SETTINGS = ['outdoor', 'indoor', 'fromAnywhere'] as const;
  const openerKeys = new Set(TASK_BANK.filter((e) => e.tags.includes('start')).map((e) => e.key));
  const finaleKeys = new Set(TASK_BANK.filter((e) => e.tags.includes('finish')).map((e) => e.key));

  let bad = '';
  let checked = 0;
  for (const audience of AUDIENCES) {
    for (const setting of SETTINGS) {
      for (let seed = 1; seed <= 4; seed++) {
        const r = composeGame(TASK_BANK, { ...ANSWERS, audience, setting }, COPY, seededRng(seed), { recentBankKeys: [] });
        if (!r) { bad ||= `${audience}/${setting}/${seed}: null`; continue; }
        checked++;

        const firstKey = r.usedBankKeys[0];
        const lastKey = r.usedBankKeys[r.usedBankKeys.length - 1];
        if (!openerKeys.has(firstKey)) bad ||= `${audience}/${setting}/${seed}: opened with ${firstKey}`;
        if (!finaleKeys.has(lastKey)) bad ||= `${audience}/${setting}/${seed}: ended with ${lastKey}`;
        if (new Set(r.usedBankKeys).size !== r.usedBankKeys.length) bad ||= `${audience}/${setting}/${seed}: dupe`;
      }
    }
  }
  ok(`checked ${checked} real-bank compositions`, checked === AUDIENCES.length * SETTINGS.length * 4);
  eq('the real bank always opens with an opener and ends with a finale', bad, '');
}

console.log('\n── 7. usedBankKeys really is the slot order ────────────────');
{
  // `usedBankKeys` is what the recency memory records and what §6 reads as
  // "first" and "last", so it must be the game's reading order — not the order
  // slots happened to be FILLED in (which puts the finale second).
  const r = composeGame(RICH_BANK, ANSWERS, COPY, seededRng(5), { recentBankKeys: [] });
  ok('composition succeeded', r !== null);
  if (r) {
    const readingOrder = r.stages.flatMap((s) => s.tasks.map(keyOf));
    eq('usedBankKeys matches the stage-by-stage reading order', r.usedBankKeys, readingOrder);
    ok('the first key is the opener', r.usedBankKeys[0].startsWith('open-'));
    ok('the last key is the finale', r.usedBankKeys[r.usedBankKeys.length - 1].startsWith('end-'));
  }
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/bookends: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/bookends: all assertions passed\x1b[0m');
