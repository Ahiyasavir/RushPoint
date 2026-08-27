// Pure-logic tests — the shape a creator WATCHES being built is the shape they GET
// (change: smart-build-delight).
//
// The smart-build questionnaire shows a live panel of the game's shape while the
// creator answers: one card per stage, one empty slot per mission. That panel is
// only worth showing if it is TRUE, and there are two distinct ways for it to lie.
//
// ─── Lie 1: drift ────────────────────────────────────────────────────────────
// If `previewShape` re-implements the budget/blueprint/spread logic, it disagrees
// with `composeGame` the first time either side is tuned — the creator watches a
// four-stage game accumulate and is handed a three-stage one. `planStages` is the
// single function both call, and section 1 is the assertion that the sharing
// actually holds across the answer space rather than at one convenient point.
//
// ─── Lie 2: the unseeded blueprint ───────────────────────────────────────────
// The stage count is NOT a pure function of the answers. `composeGame` draws its
// blueprint at random (`pickBlueprint(eligible, rng)`) unless the occasion supplies
// one, and that draw is its FIRST. A preview can therefore only be honest if it is
// driven by the SAME seed as the composition it is predicting.
//
// ⚠️ THE TRAP THIS FILE MUST NOT FALL INTO: seeding the two sides differently.
// Every comparison below hands `seed` to `previewShape` AND `seededRng(seed)` to
// `composeGame`. A version of this file that seeds them independently passes for
// the wrong reason and asserts nothing at all.
//
// The shape is a PLAN, not a promise: `composeGame` drops a planned slot whose
// candidate pool is exhausted, so the delivered mission count can be lower. Section
// 1 compares the PLANNED per-stage counts, and section 5 pins that the plan is
// never an under-count.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  composeGame,
  previewShape,
  seededRng,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { smartBuildAnswers, initialSmartBuildState } from '../apps/creator-web/src/lib/smartBuildWizard';

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
  audience: 'youth', setting: 'outdoor', people: 24, minutes: 90,
  ageBandId: 'band-14-17', difficultyPreference: 'balanced',
};

const OCC = ['other', 'birthday', 'bar_mitzvah', 'team_building', 'youth_movement'] as const;
const AUD = ['kids', 'youth', 'adults', 'corporate', 'mixed'] as const;
const SET = ['outdoor', 'indoor', 'fromAnywhere'] as const;
const DIFF = ['easy', 'balanced', 'hard'] as const;
const MIN = [30, 60, 90, 120, 180];
const SEEDS = [1, 7, 42, 1337, 99999];

const NO_RECENT = { recentBankKeys: [] as string[] };

console.log('\n── 1. the watched shape IS the composed shape ──────────────');
{
  // The whole point. Same answers, SAME SEED, both sides: stage count, stage
  // order and per-stage planned mission count must agree.
  let mismatch = '';
  let checked = 0;
  let shapesSeen = 0;

  for (const occasion of OCC) {
    for (const audience of AUD) {
      for (const setting of SET) {
        for (const difficultyPreference of DIFF) {
          for (const minutes of MIN) {
            const answers: ComposerAnswers = {
              ...BASE, occasion, audience, setting, difficultyPreference, minutes,
            };
            for (const seed of SEEDS) {
              const cell = `${occasion}/${audience}/${setting}/${difficultyPreference}/${minutes}m/s${seed}`;
              // ⚠️ ONE seed, both sides. See the header.
              const shape = previewShape(TASK_BANK, answers, seed, NO_RECENT);
              const built = composeGame(TASK_BANK, answers, COPY, seededRng(seed), NO_RECENT);
              checked++;

              if (!built) {
                if (shape.possible) mismatch ||= `${cell}: shape said possible, build returned null`;
                continue;
              }
              if (!shape.possible) {
                mismatch ||= `${cell}: shape said impossible, build succeeded`;
                continue;
              }
              shapesSeen++;

              if (shape.stages.length !== built.stages.length) {
                mismatch ||= `${cell}: shape had ${shape.stages.length} stages, built ${built.stages.length}`;
                continue;
              }
              for (let i = 0; i < shape.stages.length; i++) {
                const planned = shape.stages[i].slots;
                const actual = built.stages[i].tasks.length;
                if (planned < actual) {
                  mismatch ||= `${cell}: stage ${i} planned ${planned} but built ${actual} — the plan must never under-count`;
                }
              }
            }
          }
        }
      }
    }
  }

  const expected = OCC.length * AUD.length * SET.length * DIFF.length * MIN.length * SEEDS.length;
  ok(`checked ${checked} compositions against their shape`, checked === expected);
  ok(`at least half the cells produced a real shape (${shapesSeen}/${checked})`, shapesSeen > checked / 2);
  eq('the watched shape agrees with the composed game, every time', mismatch, '');
}

console.log('\n── 2. seeding both sides is what makes section 1 mean anything ──');
{
  // A guard on the test itself. If the blueprint were NOT seed-dependent, section 1
  // would pass even with mismatched seeds — and would be asserting nothing. This
  // proves the seed genuinely moves the shape, so section 1 has teeth.
  const answers: ComposerAnswers = { ...BASE, occasion: 'other', minutes: 180 };
  const shapes = SEEDS.map((s) => JSON.stringify(previewShape(TASK_BANK, answers, s, NO_RECENT).stages));
  ok('different seeds can yield different shapes (so the seed is load-bearing)',
    new Set(shapes).size > 1);
}

console.log('\n── 3. deterministic for a seed ─────────────────────────────');
{
  let unstable = '';
  for (const minutes of MIN) {
    for (const seed of SEEDS) {
      const answers = { ...BASE, minutes };
      const a = JSON.stringify(previewShape(TASK_BANK, answers, seed, NO_RECENT));
      for (let i = 0; i < 4; i++) {
        if (JSON.stringify(previewShape(TASK_BANK, answers, seed, NO_RECENT)) !== a) {
          unstable ||= `${minutes}m/s${seed}`;
        }
      }
    }
  }
  eq('same answers + same seed yields an identical shape every time', unstable, '');

  // And the composer itself must be reproducible under a seed, or threading the
  // seed through the questionnaire bought nothing.
  let composeUnstable = '';
  for (const seed of SEEDS) {
    const a = composeGame(TASK_BANK, BASE, COPY, seededRng(seed), NO_RECENT);
    const b = composeGame(TASK_BANK, BASE, COPY, seededRng(seed), NO_RECENT);
    if (JSON.stringify(a?.usedBankKeys) !== JSON.stringify(b?.usedBankKeys)) composeUnstable ||= `s${seed}`;
  }
  eq('composing twice under one seed yields identical missions', composeUnstable, '');
}

console.log('\n── 4. the shape selects no missions ────────────────────────');
{
  // The panel shows SHAPE, never content. If a bank key ever reached the shape,
  // the reveal would have nothing left to reveal — and a hidden mission's identity
  // would be sitting in a rendered payload.
  const bankKeys = new Set(TASK_BANK.map((e) => e.key));
  let leaked = '';
  for (const seed of SEEDS) {
    for (const minutes of MIN) {
      const shape = previewShape(TASK_BANK, { ...BASE, minutes }, seed, NO_RECENT);
      const blob = JSON.stringify(shape);
      for (const key of bankKeys) {
        if (blob.includes(key)) { leaked ||= `s${seed}/${minutes}m leaked bank key ${key}`; break; }
      }
    }
  }
  eq('no shape carries a mission identity', leaked, '');
}

console.log('\n── 5. the plan is a plan, never an under-count ─────────────');
{
  // A slot whose candidate pool is exhausted is dropped by the composer, so the
  // delivered game may hold FEWER missions than planned. That is legal and the
  // reveal reconciles it. The plan holding fewer than the delivery is NOT legal —
  // it would mean a slot appearing at the reveal that was never watched.
  let under = '';
  for (const occasion of OCC) {
    for (const seed of SEEDS) {
      const answers: ComposerAnswers = { ...BASE, occasion, minutes: 120 };
      const shape = previewShape(TASK_BANK, answers, seed, NO_RECENT);
      const built = composeGame(TASK_BANK, answers, COPY, seededRng(seed), NO_RECENT);
      if (!built || !shape.possible) continue;
      const planned = shape.stages.reduce((n, s) => n + s.slots, 0);
      if (planned < built.usedBankKeys.length) {
        under ||= `${occasion}/s${seed}: planned ${planned}, built ${built.usedBankKeys.length}`;
      }
    }
  }
  eq('the planned mission total is never below what gets built', under, '');
}

console.log('\n── 6. total — junk never throws ────────────────────────────');
{
  const junkAnswers: unknown[] = [
    undefined, null, {}, 'nope', 42, [],
    { ...BASE, minutes: NaN }, { ...BASE, minutes: -5 }, { ...BASE, minutes: Infinity },
    { ...BASE, minutes: '90' }, { ...BASE, people: NaN },
    { ...BASE, audience: 'martians' }, { ...BASE, setting: 'underwater' },
    { ...BASE, ageBandId: 'band-from-2019' }, { ...BASE, difficultyPreference: 'sideways' },
    { ...BASE, preferredTags: 'camera' }, { ...BASE, areas: 'mall' },
    { ...BASE, occasion: 'coronation' },
  ];
  const junkSeeds: unknown[] = [undefined, null, NaN, Infinity, -1, 'seven', {}, 0];

  let bad = '';
  for (const answers of junkAnswers) {
    for (const seed of junkSeeds) {
      try {
        const s = previewShape(TASK_BANK, answers as ComposerAnswers, seed as number, NO_RECENT);
        if (typeof s.possible !== 'boolean' || !Array.isArray(s.stages)) {
          bad ||= `${JSON.stringify(answers)}/${String(seed)}: malformed shape`;
        }
        if (s.stages.some((st) => !Number.isInteger(st.slots) || st.slots < 0)) {
          bad ||= `${JSON.stringify(answers)}/${String(seed)}: non-integer or negative slot count`;
        }
        if (!s.possible && s.stages.length !== 0) {
          bad ||= `${JSON.stringify(answers)}/${String(seed)}: impossible but ${s.stages.length} stages`;
        }
      } catch (e) {
        bad ||= `${JSON.stringify(answers)}/${String(seed)}: THREW ${String(e)}`;
      }
    }
  }
  eq('every junk answer/seed pair yields a usable shape, never a throw', bad, '');

  const empty = previewShape([], BASE, 1, NO_RECENT);
  ok('an empty bank shapes as impossible with no stages',
    empty.possible === false && empty.stages.length === 0);

  let bankThrew = false;
  try { previewShape(undefined as never, BASE, 1, NO_RECENT); } catch { bankThrew = true; }
  ok('a missing bank does not throw', !bankThrew);

  let recentThrew = false;
  try { previewShape(TASK_BANK, BASE, 1, undefined as never); } catch { recentThrew = true; }
  ok('a missing recent-picks argument does not throw', !recentThrew);
}

console.log('\n── 7. the questionnaire defaults produce a shape ───────────');
{
  // A creator who taps straight through must watch a real game accumulate, not an
  // empty panel. This is the same rule the questionnaire's own defaults live by.
  const defaults = smartBuildAnswers(initialSmartBuildState());
  let missing = '';
  for (const seed of SEEDS) {
    const shape = previewShape(TASK_BANK, defaults, seed, NO_RECENT);
    if (!shape.possible || shape.stages.length === 0) missing ||= `s${seed}`;
  }
  eq('every seed shapes a game from the questionnaire defaults', missing, '');
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-build-delight/preview-shape: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-build-delight/preview-shape: all assertions passed\x1b[0m');
