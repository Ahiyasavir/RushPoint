// Pure-logic tests — a composed game NAMES every stage
// (change: smart-game-composer).
//
// Why this file exists: the composer shipped every stage titled '' and nothing
// caught it. Not the validator battery (a title is not structural), not the i18n
// gate (an empty string is neither Hebrew nor English), not the browser pass (the
// Builder renders an "untitled stage" fallback, which looks deliberate). It took
// composing 5,040 games and counting the blanks — 5,040 of them — to see it.
//
// The creator-visible effect was that the one artefact they were told is a
// finished game arrived with every stage nameless, while every hand-authored
// template in templates.ts names its stages. Quick Setup made it worse: each step
// announced itself as being in a stage with no name.
//
// So the guarantee under test is: over the REAL bank, across the answer space,
// every stage of every composed game carries a non-empty name, drawn from the
// list for its position, without repeating inside one game while fresh names are
// still available — and the naming step is total, so copy that is missing,
// malformed or throwing degrades to the Builder's fallback instead of taking the
// whole game down.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  composeGame,
  seededRng,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
  type StageRole,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { AUDIENCE_TAG_IDS, SETTING_TAG_IDS } from '../apps/creator-web/src/bankTags';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}

// Distinct, recognisable-by-role names so a test can tell which list a title came
// from without depending on the real Hebrew or English copy.
const OPENERS = ['O1', 'O2', 'O3', 'O4'];
const MIDDLES = ['M1', 'M2', 'M3', 'M4', 'M5'];
const FINALES = ['F1', 'F2', 'F3', 'F4'];

const COPY: ComposerDescriptionCopy = {
  lead: () => 'LEAD',
  ageLabel: (b) => `AGE[${b}]`,
  ageTag: (b) => `agetag-${b}`,
  durationTag: (m) => `durtag-${m}`,
  composedLead: () => 'COMPOSED',
  activityPhrase: (t) => `phrase-${t}`,
  activityJoin: (p) => `with ${p.join(' and ')}`,
  activityTag: (t) => `tag-${t}`,
  placeMissionPrompt: () => 'PLACE_IT',
  stageNames: (role: StageRole) =>
    (role === 'opener' ? OPENERS : role === 'finale' ? FINALES : MIDDLES),
} as ComposerDescriptionCopy;

const base: ComposerAnswers = {
  audience: 'adults',
  setting: 'outdoor',
  people: 20,
  minutes: 120,
  ageBandId: 'adults',
  difficultyPreference: 'balanced',
};

// ── 1. Every stage of every composed game is named ──────────────────────────
console.log('every stage carries a name, across the answer space');
{
  let games = 0;
  let blankTitles = 0;
  let wrongList = 0;
  let seed = 1;

  for (const minutes of [30, 45, 60, 90, 120, 150, 180]) {
    for (const audience of AUDIENCE_TAG_IDS) {
      for (const setting of SETTING_TAG_IDS) {
        const r = composeGame(
          TASK_BANK,
          { ...base, minutes, audience, setting },
          COPY,
          seededRng(seed++),
        );
        if (!r) continue;
        games++;

        const last = r.stages.length - 1;
        r.stages.forEach((s, i) => {
          const title = (s.title ?? '').trim();
          if (title === '') { blankTitles++; return; }
          const expected = i === 0 ? OPENERS : i === last ? FINALES : MIDDLES;
          if (!expected.includes(title)) wrongList++;
        });
      }
    }
  }

  ok(`composed a real sample (${games} games)`, games > 100);
  ok(`zero untitled stages (found ${blankTitles})`, blankTitles === 0);
  ok(`every title came from its position's list (${wrongList} strays)`, wrongList === 0);
}

// ── 2. No repeat inside one game while fresh names remain ───────────────────
console.log('a name is not spent twice while the list still has fresh ones');
{
  let checked = 0;
  let repeats = 0;

  for (let seed = 500; seed < 560; seed++) {
    const r = composeGame(TASK_BANK, { ...base, minutes: 180 }, COPY, seededRng(seed));
    if (!r) continue;
    checked++;

    const titles = r.stages.map((s) => (s.title ?? '').trim());
    const middles = titles.slice(1, -1);
    // Only meaningful while the middle list is not exhausted.
    if (middles.length <= MIDDLES.length && new Set(middles).size !== middles.length) repeats++;
  }

  ok(`checked long games (${checked})`, checked > 30);
  ok(`no avoidable repeat among middle stages (${repeats})`, repeats === 0);
}

// ── 3. Names vary across seeds — the point of a list ────────────────────────
console.log('two seeds do not always produce the same names');
{
  const seen = new Set<string>();
  for (let seed = 900; seed < 940; seed++) {
    const r = composeGame(TASK_BANK, base, COPY, seededRng(seed));
    if (r) seen.add(r.stages.map((s) => s.title).join('|'));
  }
  ok(`distinct name sets across 40 seeds (${seen.size})`, seen.size > 3);
}

// ── 4. Same seed, same names — naming must not break determinism ────────────
console.log('naming is deterministic');
{
  const a = composeGame(TASK_BANK, base, COPY, seededRng(4242));
  const b = composeGame(TASK_BANK, base, COPY, seededRng(4242));
  ok('same seed yields the same titles',
    JSON.stringify(a?.stages.map((s) => s.title)) === JSON.stringify(b?.stages.map((s) => s.title)));
}

// ── 5. Totality — bad copy degrades, never throws ───────────────────────────
console.log('naming is total against hostile copy');
{
  const variants: Array<[string, unknown]> = [
    ['missing stageNames', undefined],
    ['not a function', 'nope'],
    ['throws', () => { throw new Error('boom'); }],
    ['returns a non-array', () => 'not-an-array'],
    ['returns an empty list', () => []],
    ['returns blanks', () => ['', '   ']],
    ['returns non-strings', () => [null, 42, {}]],
  ];

  for (const [label, stageNames] of variants) {
    let threw = false;
    let titles: (string | undefined)[] = [];
    try {
      const r = composeGame(
        TASK_BANK,
        base,
        { ...COPY, stageNames } as ComposerDescriptionCopy,
        seededRng(77),
      );
      titles = r ? r.stages.map((s) => s.title) : [];
    } catch {
      threw = true;
    }
    ok(`${label}: no throw`, !threw);
    ok(`${label}: degrades to empty titles, game still produced`,
      titles.length > 0 && titles.every((t) => (t ?? '') === ''));
  }
}

// ── 6. A duplicate-laden list is de-duplicated before picking ──────────────
console.log('a copy list full of duplicates still names distinct stages');
{
  const dupes = { ...COPY, stageNames: () => ['SAME', 'SAME', 'OTHER'] } as ComposerDescriptionCopy;
  const r = composeGame(TASK_BANK, { ...base, minutes: 180 }, dupes, seededRng(31));
  const titles = (r?.stages ?? []).map((s) => (s.title ?? '').trim());

  // The list offers two DISTINCT names, and a game with more stages than that
  // must reuse — repeating beats going blank. What dedup buys is that 'SAME'
  // does not get two entries' worth of weight, so both distinct names are spent
  // before any is reused: the distinct count is the whole vocabulary, not one.
  const distinct = new Set(titles).size;
  ok(`duplicates collapsed, so every distinct name was used (${distinct} of 2)`,
    distinct === Math.min(2, titles.length));
}

console.log(failures === 0 ? '\n✅ composer stage names OK' : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
