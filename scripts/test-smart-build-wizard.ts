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
//   • ANSWERS SURVIVE NAVIGATION. Eight questions is enough that going back to
//     check one is normal, and losing the other seven for it is not.
//
// (change: smart-build-occasion-and-prep-scale.) Two questions changed shape:
// `prep` is now a cumulative 1-5 rating that ALSO decides whether missions get
// pinned to real spots — §10 — and a new FIRST question asks what the occasion
// is, §11. The rules above are unchanged; there are simply two more of them to
// hold.
//   • TOTAL. An unknown action or a malformed state yields a usable state, never
//     a throw — the same contract `wizardReducer` holds.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import { AGE_BANDS } from '@rushpoint/shared';
import {
  SMART_BUILD_QUESTION_ORDER,
  SMART_BUILD_OCCASIONS,
  SMART_BUILD_PREP_LEVELS,
  SMART_BUILD_WHO,
  whoChoice,
  SMART_BUILD_DIFFICULTIES,
  SMART_BUILD_PREFERRED_TAGS,
  initialSmartBuildState,
  drawSmartBuildSeed,
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
import { OCCASION_IDS } from '../apps/creator-web/src/lib/occasions';
import { translations } from '../apps/creator-web/src/i18n';

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

  // `who` carries audience AND age; the setting is derived from the places
  // named; whether missions are pinned is derived from the prep rating. None of
  // those three is asked for on its own.
  const required = ['occasion', 'who', 'areas', 'people', 'duration', 'difficulty', 'prep'];
  const missing = required.filter((q) => !(SMART_BUILD_QUESTION_ORDER as readonly string[]).includes(q));
  eq('every answer the composer needs is asked for', missing, []);

  // The occasion is asked FIRST — before who is playing. It is the question that
  // frames every answer after it, and a creator who has to describe their event
  // after already sizing it is answering in the wrong order.
  eq('the occasion is the first question', SMART_BUILD_QUESTION_ORDER[0], 'occasion');
  eq('the occasion options are exactly the registry occasions',
    [...SMART_BUILD_OCCASIONS].sort(), [...OCCASION_IDS].sort());

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
    for (const areas of [[], ['mall'], ['park'], ['home'], ['park', 'mall']] as const) {
      for (const difficultyPreference of SMART_BUILD_DIFFICULTIES) {
        const a = { ...answers, who, areas: [...areas], difficultyPreference };
        if (composeGame(TASK_BANK, a, COPY, seededRng(1), { recentBankKeys: [] }) === null) {
          bad ||= `${who}/${areas.join('+') || 'anywhere'}/${difficultyPreference}`;
        }
      }
    }
  }
  eq('every combination of offered options composes', bad, '');

  // The two questions this change touched, across every offered value. A prep
  // level that composes nothing would be a chip the creator can pick to break
  // their own game.
  let badNew = '';
  for (const occasion of SMART_BUILD_OCCASIONS) {
    for (const prepEffort of SMART_BUILD_PREP_LEVELS) {
      const a = { ...answers, occasion, prepEffort };
      const r = composeGame(TASK_BANK, a, COPY, seededRng(1), { recentBankKeys: [] });
      if (r === null || r.usedBankKeys.length === 0) badNew ||= `${occasion}/level ${prepEffort}`;
    }
  }
  eq('every occasion at every prep level composes a populated game', badNew, '');
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

console.log('\n── 10. prep is ONE cumulative rating ───────────────────────');
{
  const d = smartBuildDefaults();
  eq('the offered levels are 1-5', [...SMART_BUILD_PREP_LEVELS], [1, 2, 3, 4, 5]);
  eq('the default asks nothing of the creator', d.prepEffort, 1);

  // Pinning missions to real spots is no longer its own answer. It was asked in
  // the "where" question, on a different scale, about the same thing — and it was
  // exactly the middle step the three prep chips had no room for.
  ok('there is no separate locationMissions answer', !('locationMissions' in d));

  const payloadAt = (prepEffort: number) => {
    let st = initialSmartBuildState();
    st = smartBuildReducer(st, { type: 'setAnswer', key: 'prepEffort', value: prepEffort });
    return smartBuildAnswers(runToEnd(st));
  };
  eq('level 1 leaves missions playable from anywhere', payloadAt(1).locationMissions, false);
  for (const level of [2, 3, 4, 5]) {
    eq(`level ${level} pins missions to real spots`, payloadAt(level).locationMissions, true);
  }
  eq('the level itself reaches the composer', payloadAt(4).prepEffort, 4);

  // A malformed level must land back inside the scale rather than reaching the
  // composer as junk or throwing on the way.
  for (const junk of [0, 9, -1, 2.5, NaN, 'full', null, undefined, {}]) {
    let st = initialSmartBuildState();
    st = smartBuildReducer(st, { type: 'setAnswer', key: 'prepEffort', value: junk as never });
    const level = st.answers.prepEffort;
    if (!(SMART_BUILD_PREP_LEVELS as readonly number[]).includes(level)) {
      failures++;
      console.error(`  ✗ prep level ${JSON.stringify(junk)} survived as ${JSON.stringify(level)}`);
    }
  }
  ok('every malformed level is coerced back into 1-5', true);

  // The action that drove the old chip is gone. Dispatching it must be inert,
  // not a way to reach a state the rating cannot express.
  const stale = smartBuildReducer(initialSmartBuildState(),
    { type: 'setLocationMissions', value: true } as never);
  eq('the retired setLocationMissions action changes nothing',
    stale.answers, smartBuildDefaults());
}

console.log('\n── 11. the occasion ───────────────────────────────────────');
{
  const d = smartBuildDefaults();
  eq('the default occasion is the neutral one', d.occasion, 'other');
  ok('the default is a real option', (SMART_BUILD_OCCASIONS as readonly string[]).includes(d.occasion));

  let st = initialSmartBuildState();
  st = smartBuildReducer(st, { type: 'setAnswer', key: 'occasion', value: 'wedding' });
  eq('the occasion is answerable', st.answers.occasion, 'wedding');
  eq('…and reaches the composer payload', smartBuildAnswers(runToEnd(st)).occasion, 'wedding');

  // The occasion must NOT decide who is playing. A bar mitzvah with an adult
  // crowd is a real event, and silently rewriting either answer to agree with
  // the other is the contradiction the merged who-question was built to avoid.
  let both = initialSmartBuildState();
  both = smartBuildReducer(both, { type: 'setAnswer', key: 'occasion', value: 'mitzvah' });
  both = smartBuildReducer(both, { type: 'setAnswer', key: 'who', value: 'adults' });
  const a = smartBuildAnswers(runToEnd(both));
  eq('occasion and audience are independent',
    [a.occasion, a.audience], ['mitzvah', 'adults']);

  // Backing out of the FIRST question is still the "leave" signal — the occasion
  // inherited that role from `who` when it moved to the front.
  const left = smartBuildReducer(initialSmartBuildState(), { type: 'back' });
  eq('back from the occasion question signals "leave"', left.index, -1);

  for (const junk of ['nope', '', null, undefined, 42, {}]) {
    let bad = initialSmartBuildState();
    bad = smartBuildReducer(bad, { type: 'setAnswer', key: 'occasion', value: junk as never });
    if (!(SMART_BUILD_OCCASIONS as readonly string[]).includes(bad.answers.occasion)) {
      failures++;
      console.error(`  ✗ occasion ${JSON.stringify(junk)} survived as ${JSON.stringify(bad.answers.occasion)}`);
    }
  }
  ok('an unknown occasion falls back to a real one', true);
}

console.log('\n── 12. every offered option has copy in BOTH languages ─────');
{
  // The component has no test runner, so this is where "a chip renders an id"
  // gets caught. `bankTagLabel` protects the tag-derived questions by returning
  // '' for an unknown id — but the occasion and the prep rating are keyed on
  // their own dictionaries, and a missing key there is a blank chip a creator
  // cannot pick their event from.
  for (const lang of ['he', 'en'] as const) {
    const w = translations[lang].dashboard.wizard;

    const missingOccasion = SMART_BUILD_OCCASIONS.filter((id) => !w.occasionOptions[id]);
    eq(`[${lang}] every occasion has a label`, missingOccasion, []);

    const missingLevel = SMART_BUILD_PREP_LEVELS.filter((l) => !w.prepLevels[String(l)]);
    eq(`[${lang}] every prep level has a label`, missingLevel, []);
    const missingHint = SMART_BUILD_PREP_LEVELS.filter((l) => !w.prepLevelHints[String(l)]);
    eq(`[${lang}] every prep level has an explanation`, missingHint, []);

    // Occasion stage titles are deliberately OPTIONAL — the composer falls back
    // to the generic list. What is not optional is that a declared entry is
    // well-formed, or a stage silently loses its title.
    const malformed = Object.entries(w.occasionStageNames).flatMap(([id, roles]) => {
      const problems: string[] = [];
      if (!(SMART_BUILD_OCCASIONS as readonly string[]).includes(id)) problems.push(`${id}: not an occasion`);
      for (const role of ['opener', 'middle', 'finale']) {
        const list = (roles as Record<string, string[]>)[role];
        if (!Array.isArray(list) || list.length === 0) problems.push(`${id}.${role}: empty`);
        else if (list.some((n) => typeof n !== 'string' || n.trim() === '')) problems.push(`${id}.${role}: a blank title`);
      }
      return problems;
    });
    eq(`[${lang}] every declared occasion stage-title set is well-formed`, malformed, []);
  }

  // The retired keys must be GONE, not merely unused. A dictionary entry nothing
  // reads is the next reader's false lead about how the question works.
  for (const lang of ['he', 'en'] as const) {
    const w = translations[lang].dashboard.wizard as unknown as Record<string, unknown>;
    const stale = ['prepNone', 'prepLight', 'prepFull', 'prepNoneHint', 'prepLightHint',
      'prepFullHint', 'locationMissionsLabel', 'locationMissionsYes', 'locationMissionsNo',
      'locationMissionsHint'].filter((k) => k in w);
    eq(`[${lang}] the retired prep/location keys are gone`, stale, []);
  }
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

console.log('\n── 11. the seed is fixed for the questionnaire\'s life ──────');
{
  // The live shape panel predicts the game by seeding a stream with this value,
  // and `composeGame` is later handed `seededRng(seed)`. If the seed moved while
  // the creator answered, the panel would re-roll the blueprint on every tap and
  // the shape they watched accumulate would not be the shape they were handed.
  // (change: smart-build-delight)
  const start = initialSmartBuildState();

  let s = start;
  let drifted = '';
  const touch = (label: string, next: SmartBuildState) => {
    if (next.seed !== start.seed) drifted ||= `${label}: ${start.seed} → ${next.seed}`;
    return next;
  };

  s = touch('setAnswer occasion', smartBuildReducer(s, { type: 'setAnswer', key: 'occasion', value: 'birthday' }));
  s = touch('setAnswer who', smartBuildReducer(s, { type: 'setAnswer', key: 'who', value: 'teens' }));
  s = touch('setAnswer minutes', smartBuildReducer(s, { type: 'setAnswer', key: 'minutes', value: 120 }));
  s = touch('togglePreferred', smartBuildReducer(s, { type: 'togglePreferred', tag: SMART_BUILD_PREFERRED_TAGS[0] }));
  s = touch('toggleArea', smartBuildReducer(s, { type: 'toggleArea', area: 'mall' }));
  for (let i = 0; i < SMART_BUILD_QUESTION_ORDER.length; i++) {
    s = touch(`next ${i}`, smartBuildReducer(s, { type: 'next' }));
  }
  for (let i = 0; i < SMART_BUILD_QUESTION_ORDER.length; i++) {
    s = touch(`back ${i}`, smartBuildReducer(s, { type: 'back' }));
  }
  s = touch('unknown action', smartBuildReducer(s, { type: 'nonsense' } as never));
  eq('the seed survives every action, forwards and backwards', drifted, '');

  // A malformed seed is COERCED, never re-drawn: safeState runs on every action,
  // so re-drawing would hand the panel a new blueprint on every tap.
  const coerced = smartBuildReducer({ index: 0, answers: smartBuildDefaults(), seed: NaN } as never, { type: 'next' });
  ok('a malformed seed is coerced to a usable number',
    typeof coerced.seed === 'number' && Number.isFinite(coerced.seed) && coerced.seed >= 0);
  const twice = smartBuildReducer(coerced, { type: 'next' });
  eq('…and coercing is stable, not a fresh draw each action', twice.seed, coerced.seed);

  // A fresh questionnaire must be able to differ, or the same answers would
  // always yield the same game and the seed would be decorative.
  const seeds = new Set(Array.from({ length: 40 }, () => initialSmartBuildState().seed));
  ok(`a fresh questionnaire draws a fresh seed (${seeds.size} distinct in 40)`, seeds.size > 1);

  // Total: an injected rng that misbehaves must still yield a usable seed.
  let seedThrew = '';
  for (const bad of [() => NaN, () => Infinity, () => -1, () => 2, (() => { throw new Error('x'); })]) {
    try {
      const v = drawSmartBuildSeed(bad as () => number);
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) seedThrew ||= `bad seed ${String(v)}`;
    } catch (e) {
      // A throwing rng is the caller's problem, but must not be OURS to crash on.
      if (String(e).includes('x')) seedThrew ||= 'a throwing rng escaped drawSmartBuildSeed';
    }
  }
  eq('a misbehaving rng still yields a usable seed', seedThrew, '');
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/smart-build-wizard: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/smart-build-wizard: all assertions passed\x1b[0m');
