// Pure-logic tests — the pre-commit preview agrees with what actually gets built
// (change: smart-game-composer).
//
// The questionnaire's last screen tells the creator how many missions they are
// about to get, so the final tap is an informed one rather than an act of faith.
// That number is only worth showing if it is TRUE, and the way it stops being
// true is drift: someone tunes the budget in `composeGame` and the preview keeps
// quoting the old rule. A creator is then promised twelve missions and handed
// seventeen — worse than never having shown a number.
//
// `previewComposition` shares `usableBankFor` and `targetTaskCount` with the
// real composer precisely so it cannot drift. This file is the assertion that
// the sharing actually holds, across the whole answer space rather than at one
// convenient point.
//
// It also pins what the preview deliberately does NOT claim. Stage count comes
// from a randomly drawn blueprint and the mission list from band sampling, so
// previewing either would show the creator a game they are not going to get.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  composeGame,
  previewComposition,
  seededRng,
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

const AUD = ['kids', 'youth', 'adults', 'corporate', 'mixed'] as const;
const SET = ['outdoor', 'indoor', 'fromAnywhere'] as const;
const DIFF = ['easy', 'balanced', 'hard'] as const;
const MIN = [30, 60, 90, 120, 180];

console.log('\n── 1. the preview matches the game that gets built ─────────');
{
  // The whole point. Every cell, every seed: what we promised is what we made.
  let mismatch = '';
  let checked = 0;

  for (const audience of AUD) {
    for (const setting of SET) {
      for (const difficultyPreference of DIFF) {
        for (const minutes of MIN) {
          const answers: ComposerAnswers = { ...BASE, audience, setting, difficultyPreference, minutes };
          const preview = previewComposition(TASK_BANK, answers);

          // Across several seeds: the COUNT must not depend on the rng at all.
          for (const seed of [1, 2, 3, 4, 5]) {
            const built = composeGame(TASK_BANK, answers, COPY, seededRng(seed), { recentBankKeys: [] });
            checked++;

            if (!built) {
              if (preview.possible) {
                mismatch ||= `${audience}/${setting}/${difficultyPreference}/${minutes}m/s${seed}: preview said possible, build returned null`;
              }
              continue;
            }
            if (!preview.possible) {
              mismatch ||= `${audience}/${setting}/${difficultyPreference}/${minutes}m/s${seed}: preview said impossible, build succeeded`;
              continue;
            }
            if (built.usedBankKeys.length !== preview.missionCount) {
              mismatch ||= `${audience}/${setting}/${difficultyPreference}/${minutes}m/s${seed}: previewed ${preview.missionCount}, built ${built.usedBankKeys.length}`;
            }
          }
        }
      }
    }
  }

  ok(`checked ${checked} builds against their preview`, checked === AUD.length * SET.length * DIFF.length * MIN.length * 5);
  eq('the previewed mission count is exactly what gets built, every time', mismatch, '');
}

console.log('\n── 2. the preview is deterministic and rng-free ────────────');
{
  // It takes no rng argument at all, so this asserts the weaker but still
  // meaningful property: repeated calls agree, and nothing about it moves.
  let unstable = '';
  for (const minutes of MIN) {
    const answers = { ...BASE, minutes };
    const a = previewComposition(TASK_BANK, answers);
    for (let i = 0; i < 5; i++) {
      const b = previewComposition(TASK_BANK, answers);
      if (JSON.stringify(a) !== JSON.stringify(b)) unstable ||= `${minutes}m`;
    }
  }
  eq('repeated previews of the same answers agree', unstable, '');

  const series = MIN.map((minutes) => previewComposition(TASK_BANK, { ...BASE, minutes }).missionCount);
  ok(`a longer game previews at least as many missions (${series.join(', ')})`,
    series.every((v, i) => i === 0 || v >= series[i - 1]));
  ok('the longest answer previews more than the shortest', series[series.length - 1] > series[0]);
}

console.log('\n── 3. it never promises something unusable ─────────────────');
{
  let bad = '';
  for (const audience of AUD) {
    for (const setting of SET) {
      const p = previewComposition(TASK_BANK, { ...BASE, audience, setting });
      if (!Number.isInteger(p.missionCount) || p.missionCount < 0) bad ||= `${audience}/${setting}: ${p.missionCount}`;
      if (p.possible && p.missionCount === 0) bad ||= `${audience}/${setting}: possible but zero missions`;
      if (!p.possible && p.missionCount !== 0) bad ||= `${audience}/${setting}: impossible but ${p.missionCount} missions`;
    }
  }
  eq('every preview is a sane, self-consistent pair', bad, '');
}

console.log('\n── 4. total — junk answers never throw ─────────────────────');
{
  const junk: unknown[] = [
    undefined, null, {}, 'nope', 42, [],
    { ...BASE, minutes: NaN }, { ...BASE, minutes: -5 }, { ...BASE, minutes: Infinity },
    { ...BASE, minutes: '90' }, { ...BASE, people: NaN },
    { ...BASE, audience: 'martians' }, { ...BASE, setting: 'underwater' },
    { ...BASE, ageBandId: 'band-from-2019' }, { ...BASE, difficultyPreference: 'sideways' },
    { ...BASE, preferredTags: 'camera' }, { ...BASE, areas: 'mall' },
  ];

  let threw = '';
  for (const answers of junk) {
    try {
      const p = previewComposition(TASK_BANK, answers as ComposerAnswers);
      if (typeof p.missionCount !== 'number' || typeof p.possible !== 'boolean') {
        threw ||= `${JSON.stringify(answers)}: malformed preview`;
      }
    } catch (e) {
      threw ||= `${JSON.stringify(answers)}: THREW ${String(e)}`;
    }
  }
  eq('every junk answer yields a usable preview, never a throw', threw, '');

  // A bank that cannot make anything must preview as impossible, not as zero-
  // but-possible — the caller renders a different message for each.
  const empty = previewComposition([], BASE);
  eq('an empty bank previews as impossible', empty, { missionCount: 0, possible: false });

  let bankThrew = false;
  try { previewComposition(undefined as never, BASE); } catch { bankThrew = true; }
  ok('a missing bank does not throw', !bankThrew);
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/preview: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/preview: all assertions passed\x1b[0m');
