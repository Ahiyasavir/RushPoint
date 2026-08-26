// Pure-logic tests — the smart-build questionnaire's flow
// (change: smart-game-composer).
//
// A SEPARATE state machine from lib/newGameWizard.ts's `wizardReducer`, not a
// sixth case bolted into it. Two flows' rules living in one switch is how a
// change to one silently breaks the other, and it would leave the existing
// wizard's tests guarding behaviour they were never written for.
//
// The rules this file exists to hold:
//
//   • EVERY QUESTION HAS A DEFAULT — inherited from the existing wizard's rule 4.
//     A creator who taps straight through must still get a game, so no unanswered
//     question can dead-end the flow. §3 goes further and feeds every default
//     into the real composer, because "has a default" is worthless if the default
//     is a value the composer then rejects.
//   • NOTHING IS CREATED UNTIL THE END — the existing wizard's rule 5, and the
//     reason both of these are reducers over explicit state rather than a pile of
//     component `useState`s: "have we created anything yet" has to be answerable
//     without rendering.
//   • ANSWERS SURVIVE NAVIGATION. Six questions is enough that going back to
//     check one is normal, and losing the other five for it is not.
//   • TOTAL. An unknown action or a malformed state yields a usable state, never
//     a throw — the same contract `wizardReducer` holds.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import { AGE_BANDS } from '@rushpoint/shared';
import {
  SMART_BUILD_QUESTION_ORDER,
  SMART_BUILD_WHO,
  whoChoice,
  SMART_BUILD_DIFFICULTIES,
  SMART_BUILD_PREFERRED_TAGS,
  initialSmartBuildState,
  smartBuildReducer,
  smartBuildDefaults,
  smartBuildProgress,
  isSmartBuildComplete,
  smartBuildAnswers,
  type SmartBuildState,
} from '../apps/creator-web/src/lib/smartBuildWizard';
import {
  composeGame,
  seededRng,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { BANK_TAGS, AUDIENCE_TAG_IDS, SETTING_TAG_IDS } from '../apps/creator-web/src/bankTags';

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
  placeMissionPrompt: () => 'PLACE_IT',
};

/** Walk the questionnaire to its end without answering anything. */
function runToEnd(state = initialSmartBuildState()): SmartBuildState {
  let s = state;
  for (let i = 0; i < SMART_BUILD_QUESTION_ORDER.length + 2; i++) s = smartBuildReducer(s, { type: 'next' });
  return s;
}

console.log('\n── 1. the question table ───────────────────────────────────');
{
  ok('there is more than one question', SMART_BUILD_QUESTION_ORDER.length >= 2);
  eq('every question id is unique',
    SMART_BUILD_QUESTION_ORDER.length - new Set(SMART_BUILD_QUESTION_ORDER).size, 0);

  // Six questions, not eight. `who` carries audience AND age; the setting is
  // derived from the places named, so neither is asked for on its own.
  const required = ['who', 'areas', 'people', 'duration', 'difficulty'];
  const missing = required.filter((q) => !(SMART_BUILD_QUESTION_ORDER as readonly string[]).includes(q));
  eq('every answer the composer needs is asked for', missing, []);

  // Options must come from the canonical registry, or a chip renders an id.
  // Every audience the registry knows must be reachable through some who-option,
  // or a whole class of missions could never be scored as an exact match.
  const reachable = [...new Set(SMART_BUILD_WHO.map((o) => o.audience))].sort();
  eq('every registry audience is reachable from a who option',
    reachable, [...AUDIENCE_TAG_IDS].sort());
  eq('every who option names a real age band',
    SMART_BUILD_WHO.filter((o) => !AGE_BANDS.some((b) => b.id === o.ageBandId)).map((o) => o.id), []);
  eq('the difficulty options are the three the composer knows',
    [...SMART_BUILD_DIFFICULTIES].sort(), ['balanced', 'easy', 'hard']);

  const unknownPref = SMART_BUILD_PREFERRED_TAGS.filter((t) => !(t in BANK_TAGS));
  eq('every offered preferred tag is a registry tag', unknownPref, []);
  ok('at least two preferred tags are offered, or the question is pointless',
    SMART_BUILD_PREFERRED_TAGS.length >= 2);
}

console.log('\n── 2. the initial state ────────────────────────────────────');
{
  const s = initialSmartBuildState();
  eq('it starts at the first question', s.index, 0);
  eq('it is not complete', isSmartBuildComplete(s), false);

  const d = smartBuildDefaults();
  eq('every answer starts at its default', s.answers, d);
  ok('the default who is a real option', SMART_BUILD_WHO.some((o) => o.id === d.who));
  ok('the default difficulty is a real option', (SMART_BUILD_DIFFICULTIES as readonly string[]).includes(d.difficultyPreference));
  ok('the default group size is positive', typeof d.people === 'number' && d.people > 0);
  ok('the default duration is positive', typeof d.minutes === 'number' && d.minutes > 0);
  ok('the default who resolves to a real age band',
    AGE_BANDS.some((b) => b.id === whoChoice(d.who).ageBandId));
}

console.log('\n── 3. every default really composes ────────────────────────');
{
  // "Has a default" is worthless if the default is something the composer then
  // refuses. A creator who taps straight through must get a game.
  const untouched = runToEnd();
  ok('tapping straight through completes the questionnaire', isSmartBuildComplete(untouched));

  const answers = smartBuildAnswers(untouched);
  const r = composeGame(TASK_BANK, answers, COPY, seededRng(1), { recentBankKeys: [] });
  ok('the all-defaults answers compose into a real game', r !== null);
  ok('…with missions in it', r !== null && r.usedBankKeys.length > 0);

  // And so does every single option of every question, one at a time.
  let bad = '';
  for (const who of SMART_BUILD_WHO.map((o) => o.id)) {
    for (const areas of [[], ['mall'], ['park'], ['park', 'mall']] as const) {
      for (const difficultyPreference of SMART_BUILD_DIFFICULTIES) {
        const a = { ...answers, who, areas: [...areas], difficultyPreference };
        if (composeGame(TASK_BANK, a, COPY, seededRng(1), { recentBankKeys: [] }) === null) {
          bad ||= `${who}/${areas.join('+') || 'anywhere'}/${difficultyPreference}`;
        }
      }
    }
  }
  eq('every combination of offered options composes', bad, '');
}

console.log('\n── 4. navigation ───────────────────────────────────────────');
{
  const last = SMART_BUILD_QUESTION_ORDER.length - 1;
  let s = initialSmartBuildState();

  s = smartBuildReducer(s, { type: 'next' });
  eq('next advances', s.index, 1);

  s = smartBuildReducer(s, { type: 'back' });
  eq('back retreats', s.index, 0);

  // Back from the first question is the documented "leave" signal, so the host
  // wizard can return to the path fork rather than trapping the creator.
  const left = smartBuildReducer(initialSmartBuildState(), { type: 'back' });
  eq('back from the first question signals "leave"', left.index, -1);
  eq('…and leaves nothing complete', isSmartBuildComplete(left), false);

  const ended = runToEnd();
  ok('next never runs past the end', ended.index <= SMART_BUILD_QUESTION_ORDER.length);
  eq('the end index is one past the last question', ended.index, last + 1);
}

console.log('\n── 5. answers survive going back and forward ───────────────');
{
  let s = initialSmartBuildState();
  s = smartBuildReducer(s, { type: 'setAnswer', key: 'who', value: 'corporate' });
  s = smartBuildReducer(s, { type: 'next' });
  s = smartBuildReducer(s, { type: 'toggleArea', area: 'mall' });
  s = smartBuildReducer(s, { type: 'back' });

  eq('the earlier answer is still set', s.answers.who, 'corporate');
  s = smartBuildReducer(s, { type: 'next' });
  eq('…and so is the later one', s.answers.areas, ['mall']);

  s = smartBuildReducer(s, { type: 'setAnswer', key: 'minutes', value: 120 });
  s = smartBuildReducer(s, { type: 'setAnswer', key: 'people', value: 40 });
  s = smartBuildReducer(s, { type: 'setAnswer', key: 'difficultyPreference', value: 'hard' });

  const a = smartBuildAnswers(runToEnd(s));
  eq('every answer reaches the composer payload',
    [a.audience, a.setting, a.minutes, a.people, a.ageBandId, a.difficultyPreference],
    ['corporate', 'indoor', 120, 40, 'band-18-plus', 'hard']);
}

console.log('\n── 6. preferred tags toggle cleanly ────────────────────────');
{
  const tag = SMART_BUILD_PREFERRED_TAGS[0];
  const other = SMART_BUILD_PREFERRED_TAGS[1];

  let s = initialSmartBuildState();
  eq('none are selected to begin with', s.answers.preferredTags, []);

  s = smartBuildReducer(s, { type: 'togglePreferred', tag });
  eq('toggling selects it', s.answers.preferredTags, [tag]);

  s = smartBuildReducer(s, { type: 'togglePreferred', tag: other });
  eq('a second selection is added', s.answers.preferredTags, [tag, other]);

  s = smartBuildReducer(s, { type: 'togglePreferred', tag });
  eq('toggling again deselects', s.answers.preferredTags, [other]);

  s = smartBuildReducer(s, { type: 'togglePreferred', tag: other });
  eq('deselecting the last leaves an EMPTY list, not [undefined]', s.answers.preferredTags, []);
  ok('…and it is a real array', Array.isArray(s.answers.preferredTags));

  // An unknown tag must not enter the list — it would score nothing and make the
  // whole preference term dead weight.
  s = smartBuildReducer(s, { type: 'togglePreferred', tag: 'not-a-tag' as never });
  eq('an unknown tag is ignored', s.answers.preferredTags, []);

  s = smartBuildReducer(s, { type: 'togglePreferred', tag });
  s = smartBuildReducer(s, { type: 'togglePreferred', tag });
  s = smartBuildReducer(s, { type: 'togglePreferred', tag });
  eq('an odd number of toggles leaves it selected', s.answers.preferredTags, [tag]);
}

console.log('\n── 7. nothing is complete before the end ───────────────────');
{
  let s = initialSmartBuildState();
  for (let i = 0; i < SMART_BUILD_QUESTION_ORDER.length; i++) {
    if (isSmartBuildComplete(s)) {
      failures++;
      console.error(`  ✗ reported complete at question ${i}`);
      break;
    }
    s = smartBuildReducer(s, { type: 'next' });
  }
  ok('the questionnaire is never complete while a question remains', true);
  ok('it IS complete once the last question is confirmed', isSmartBuildComplete(s));

  eq('a "left" state is not complete', isSmartBuildComplete(smartBuildReducer(initialSmartBuildState(), { type: 'back' })), false);
}

console.log('\n── 8. progress is reportable ───────────────────────────────');
{
  const s = smartBuildReducer(initialSmartBuildState(), { type: 'next' });
  const p = smartBuildProgress(s);
  eq('the total is the number of questions', p.total, SMART_BUILD_QUESTION_ORDER.length);
  eq('the step is 1-based for display', p.step, 2);
  ok('the step never exceeds the total', smartBuildProgress(runToEnd()).step <= p.total + 1);

  const first = smartBuildProgress(initialSmartBuildState());
  eq('the first question reads as step 1', first.step, 1);
}

console.log('\n── 9. the reducer is TOTAL ─────────────────────────────────');
{
  const good = initialSmartBuildState();
  const junkActions: unknown[] = [
    undefined, null, {}, { type: 'nope' }, { type: 'setAnswer' },
    { type: 'setAnswer', key: 'nonsense', value: 1 },
    { type: 'setAnswer', key: 'people', value: 'lots' },
    { type: 'setAnswer', key: 'minutes', value: NaN },
    { type: 'togglePreferred' }, { type: 'togglePreferred', tag: null },
    'next', 42, [],
  ];
  for (const action of junkActions) {
    let out: SmartBuildState | undefined;
    let threw = false;
    try { out = smartBuildReducer(good, action as never); } catch { threw = true; }
    if (threw || !out || typeof out.index !== 'number' || !out.answers) {
      failures++;
      console.error(`  ✗ action ${JSON.stringify(action)} did not yield a usable state`);
    }
  }
  ok('every junk action yields a usable state', true);

  const junkStates: unknown[] = [undefined, null, {}, 'state', 42, [], { index: 'x' }, { answers: null }];
  for (const state of junkStates) {
    let out: SmartBuildState | undefined;
    let threw = false;
    try { out = smartBuildReducer(state as never, { type: 'next' }); } catch { threw = true; }
    if (threw || !out || typeof out.index !== 'number' || !out.answers) {
      failures++;
      console.error(`  ✗ state ${JSON.stringify(state)} did not yield a usable state`);
    }
  }
  ok('every junk state yields a usable state', true);

  // The payload must be composable no matter how the state got mangled.
  let bad = '';
  for (const state of junkStates) {
    const a = smartBuildAnswers(state as never);
    if (composeGame(TASK_BANK, a, COPY, seededRng(1), { recentBankKeys: [] }) === null) {
      bad ||= JSON.stringify(state);
    }
  }
  eq('answers derived from a junk state still compose', bad, '');
}

console.log('\n── 10. a junk numeric answer never reaches the composer ────');
{
  let s = initialSmartBuildState();
  s = smartBuildReducer(s, { type: 'setAnswer', key: 'people', value: NaN as never });
  s = smartBuildReducer(s, { type: 'setAnswer', key: 'minutes', value: -5 as never });
  const a = smartBuildAnswers(runToEnd(s));

  ok('a NaN group size falls back to a positive default', Number.isFinite(a.people) && a.people > 0);
  ok('a negative duration falls back to a positive default', Number.isFinite(a.minutes) && a.minutes > 0);
  ok('…and the result still composes',
    composeGame(TASK_BANK, a, COPY, seededRng(1), { recentBankKeys: [] }) !== null);
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/smart-build-wizard: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/smart-build-wizard: all assertions passed\x1b[0m');
