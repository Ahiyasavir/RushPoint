// Pure-logic test for the new-game wizard's flow (change: guided-new-game-wizard).
//
// The wizard exists because the old entry point asked a brand-new creator to pick
// between template cards they had no way to evaluate, then dropped them into a
// Builder holding an untitled game. So the flow rules it has to guarantee are:
//
//   • the NAME is asked first, on every path, because a named game is the
//     difference between "I am editing my game" and "I am configuring software";
//   • a blank name never BLOCKS — the wizard exists to remove friction, so it
//     falls back to the same untitled title the old blank path produced;
//   • "start from scratch" asks nothing more, and is never nested inside or
//     reachable only after the guided path;
//   • every guided question has a default, so no answer can dead-end the flow;
//   • abandoning the wizard creates nothing at all.
//
// The last one is the reason this is a reducer over an explicit state rather than
// a pile of component `useState`s: "did we create a game yet" has to be answerable
// without rendering anything.
//
//   npx tsx scripts/test-new-game-wizard.ts
import {
  WIZARD_QUESTION_ORDER,
  GAME_TYPES,
  initialWizardState,
  wizardReducer,
  resolveGameTitle,
  isGuidedComplete,
  buildCreationPlan,
  defaultAnswers,
  templateForGameType,
  availableGameTypes,
  type WizardState,
} from '../apps/creator-web/src/lib/newGameWizard';
import type { ComposerAnswers } from '../apps/creator-web/src/lib/composeGame';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const UNTITLED = 'משחק ללא שם';

/** Drive the reducer through a list of actions from a fresh state. */
function run(...actions: Parameters<typeof wizardReducer>[1][]): WizardState {
  let s = initialWizardState();
  for (const a of actions) s = wizardReducer(s, a);
  return s;
}

// ── The name comes first ─────────────────────────────────────────────────────
console.log('\n── question order ──');

check('the name is the first question', WIZARD_QUESTION_ORDER[0] === 'name',
  JSON.stringify(WIZARD_QUESTION_ORDER));
check('the path fork comes straight after the name', WIZARD_QUESTION_ORDER[1] === 'path',
  JSON.stringify(WIZARD_QUESTION_ORDER));
check('every personalization question comes after the fork',
  ['type', 'people', 'duration', 'age'].every((q) => WIZARD_QUESTION_ORDER.indexOf(q) > 1),
  JSON.stringify(WIZARD_QUESTION_ORDER));
check('a fresh wizard starts on the name step', initialWizardState().step === 'name');
check('a fresh wizard has created nothing', initialWizardState().path === null);

// ── Name handling ────────────────────────────────────────────────────────────
console.log('\n── resolveGameTitle ──');

check('a typed name is used', resolveGameTitle('  מרוץ השבט  ', UNTITLED) === 'מרוץ השבט');
check('a blank name falls back to the untitled title', resolveGameTitle('', UNTITLED) === UNTITLED);
check('whitespace only falls back', resolveGameTitle('    ', UNTITLED) === UNTITLED);
for (const junk of [undefined, null, 42, {}]) {
  check(`total on ${JSON.stringify(junk)}`,
    resolveGameTitle(junk as unknown as string, UNTITLED) === UNTITLED);
}
// A blank name must never block: the state machine still advances.
{
  const s = run({ type: 'setName', name: '' }, { type: 'next' });
  check('a blank name still advances past the name step', s.step === 'path', s.step);
}

// ── The scratch path asks nothing more ───────────────────────────────────────
console.log('\n── scratch path ──');
{
  const s = run({ type: 'setName', name: 'X' }, { type: 'next' }, { type: 'choosePath', path: 'scratch' });
  check('scratch is a terminal choice', s.step === 'done', s.step);
  check('scratch records its path', s.path === 'scratch', String(s.path));
  const plan = buildCreationPlan(s);
  check('scratch produces a blank creation plan', plan?.kind === 'blank', JSON.stringify(plan));
  check('scratch carries the title through', plan?.title === 'X', JSON.stringify(plan));
  check('scratch asks no personalization questions',
    !isGuidedComplete(s) || s.path === 'scratch', s.step);
}

// ── The guided path ──────────────────────────────────────────────────────────
console.log('\n── guided path ──');
{
  const s = run({ type: 'setName', name: 'עלילה' }, { type: 'next' }, { type: 'choosePath', path: 'guided' });
  check('guided moves on to the questions', s.step === 'details', s.step);
  // Still mid-flow: nothing may be creatable yet, or closing the wizard here
  // would leave a game behind.
  check('guided creates nothing before the questions are answered',
    buildCreationPlan(s) === null, JSON.stringify(buildCreationPlan(s)));
}
{
  // Every question has a default, so continuing without answering must work.
  const s = run(
    { type: 'setName', name: 'עלילה' },
    { type: 'next' },
    { type: 'choosePath', path: 'guided' },
    { type: 'next' },
  );
  check('the guided path completes with no question answered', s.step === 'done', s.step);
  const plan = buildCreationPlan(s);
  check('an unanswered flow still produces a template plan', plan?.kind === 'template',
    JSON.stringify(plan));
  check('defaults fill the group size', plan?.personalize?.groupSize === defaultAnswers().people,
    JSON.stringify(plan?.personalize));
  check('defaults fill the duration', plan?.personalize?.durationMinutes === defaultAnswers().minutes,
    JSON.stringify(plan?.personalize));
  check('defaults fill the age band', typeof plan?.personalize?.minAge === 'number',
    JSON.stringify(plan?.personalize));
  check('defaults pick a game type', !!plan?.gameType, JSON.stringify(plan?.gameType));
}

// ── Game type maps onto the two templates ────────────────────────────────────
console.log('\n── game type ──');
check('exactly two game types are offered', GAME_TYPES.length === 2, JSON.stringify(GAME_TYPES));
check('one of them is the story game', GAME_TYPES.some((t) => t.id === 'story'),
  JSON.stringify(GAME_TYPES));
check('one of them is the missions game', GAME_TYPES.some((t) => t.id === 'missions'),
  JSON.stringify(GAME_TYPES));
{
  const s = run(
    { type: 'setName', name: 'n' }, { type: 'next' }, { type: 'choosePath', path: 'guided' },
    { type: 'setAnswer', key: 'type', value: 'story' }, { type: 'next' },
  );
  check('answering story selects the story type', buildCreationPlan(s)?.gameType === 'story',
    JSON.stringify(buildCreationPlan(s)?.gameType));
}
{
  const s = run(
    { type: 'setName', name: 'n' }, { type: 'next' }, { type: 'choosePath', path: 'guided' },
    { type: 'setAnswer', key: 'type', value: 'missions' }, { type: 'next' },
  );
  check('answering missions selects the missions type',
    buildCreationPlan(s)?.gameType === 'missions', JSON.stringify(buildCreationPlan(s)?.gameType));
}

// ── Genre resolution: a DECLARED field, never inferred ───────────────────────
console.log('\n── templateForGameType ──');
{
  const templates = [
    { groupKey: 'g-missions', templateGenre: 'missions' as const },
    { groupKey: 'g-story', templateGenre: 'story' as const },
  ];
  check('missions resolves to the missions template',
    templateForGameType(templates, 'missions')?.groupKey === 'g-missions');
  check('story resolves to the story template',
    templateForGameType(templates, 'story')?.groupKey === 'g-story');
  check('both types are offered when both are tagged',
    availableGameTypes(templates).length === 2, JSON.stringify(availableGameTypes(templates)));
}
{
  // An untagged template must NOT be guessed at. Offering a type nothing can
  // build would silently create the wrong game, so the option is hidden instead.
  const untagged = [{ groupKey: 'g-1' }, { groupKey: 'g-2' }];
  check('an untagged template resolves to nothing',
    templateForGameType(untagged, 'story') === null);
  check('no type is offered when no template declares one',
    availableGameTypes(untagged).length === 0, JSON.stringify(availableGameTypes(untagged)));
}
{
  const partial = [{ groupKey: 'g-1', templateGenre: 'missions' as const }, { groupKey: 'g-2' }];
  check('only the declared type is offered',
    JSON.stringify(availableGameTypes(partial)) === JSON.stringify(['missions']),
    JSON.stringify(availableGameTypes(partial)));
}
for (const junk of [null, undefined, 'nope', 42]) {
  check(`templateForGameType total on ${JSON.stringify(junk)}`,
    templateForGameType(junk as never, 'story') === null);
  check(`availableGameTypes total on ${JSON.stringify(junk)}`,
    Array.isArray(availableGameTypes(junk as never)));
}

// ── Abandoning creates nothing ───────────────────────────────────────────────
console.log('\n── abandonment ──');
{
  const s = run(
    { type: 'setName', name: 'half done' }, { type: 'next' },
    { type: 'choosePath', path: 'guided' },
    { type: 'setAnswer', key: 'people', value: 24 },
    { type: 'cancel' },
  );
  check('cancelling yields no creation plan', buildCreationPlan(s) === null, JSON.stringify(s));
  check('cancelling returns to a closed wizard', s.step === 'closed', s.step);
}
check('a wizard that never finished yields no plan',
  buildCreationPlan(run({ type: 'setName', name: 'x' })) === null);

// ── Answers reach the plan ───────────────────────────────────────────────────
console.log('\n── answers reach the plan ──');
{
  const s = run(
    { type: 'setName', name: 'מרוץ' }, { type: 'next' }, { type: 'choosePath', path: 'guided' },
    { type: 'setAnswer', key: 'type', value: 'missions' },
    { type: 'setAnswer', key: 'people', value: 24 },
    { type: 'setAnswer', key: 'duration', value: 120 },
    { type: 'setAnswer', key: 'age', value: 'band-11-13' },
    { type: 'next' },
  );
  const plan = buildCreationPlan(s);
  check('the title reaches the plan', plan?.title === 'מרוץ', JSON.stringify(plan?.title));
  check('the group size reaches the plan', plan?.personalize?.groupSize === 24,
    JSON.stringify(plan?.personalize));
  check('the duration reaches the plan', plan?.personalize?.durationMinutes === 120,
    JSON.stringify(plan?.personalize));
  // Ages 11 to 13 sit below the guardian-consent threshold, so minAge is the
  // band's floor.
  check('the age band reaches the plan as its lower bound', plan?.personalize?.minAge === 11,
    JSON.stringify(plan?.personalize));
  check('the answers are carried for the description blend',
    plan?.answers?.people === 24 && plan?.answers?.minutes === 120 && plan?.answers?.ageBandId === 'band-11-13',
    JSON.stringify(plan?.answers));
}

{
  // A band id nothing recognises must NOT invent a minAge — it would set a
  // safety threshold from a value the product cannot explain.
  const s2 = run(
    { type: 'setName', name: 'x' }, { type: 'next' }, { type: 'choosePath', path: 'guided' },
    { type: 'setAnswer', key: 'age', value: 'not-a-band' }, { type: 'next' },
  );
  const p2 = buildCreationPlan(s2);
  check('an unknown age band sets no minAge', p2?.personalize?.minAge === undefined,
    JSON.stringify(p2?.personalize));
  check('an unknown age band still creates a game', p2?.kind === 'template');
}

// ── Totality ─────────────────────────────────────────────────────────────────
console.log('\n── totality ──');
for (const junk of [null, undefined, {}, 'nope', 42]) {
  const s = wizardReducer(junk as unknown as WizardState, { type: 'next' });
  check(`reducer total on state ${JSON.stringify(junk)}`, !!s && typeof s.step === 'string',
    JSON.stringify(s));
  check(`buildCreationPlan total on ${JSON.stringify(junk)}`,
    buildCreationPlan(junk as unknown as WizardState) === null);
}
for (const junk of [null, undefined, {}, 'nope']) {
  const s = wizardReducer(initialWizardState(), junk as never);
  check(`reducer total on action ${JSON.stringify(junk)}`, !!s && typeof s.step === 'string');
}

// ── The smart-build fork (change: smart-game-composer) ───────────────────────
//
// ADDITIVE ONLY. Everything above this line describes the wizard as it was, and
// must keep passing untouched — the third path is a new arm on existing unions,
// not a rewrite. The last block below is the explicit regression guard for that.
console.log('\n── smart build: the third path ──');

{
  const s = run({ type: 'setName', name: 'מרוץ' }, { type: 'next' }, { type: 'choosePath', path: 'smart_build' });
  check('choosing smart build records the path', s.path === 'smart_build', JSON.stringify(s.path));
  check('…and opens the questionnaire step', s.step === 'smartBuildDetails', JSON.stringify(s.step));
  check('nothing is created yet', buildCreationPlan(s) === null, JSON.stringify(buildCreationPlan(s)));
}

{
  // Back from the questionnaire returns to the fork with NO path selected, so
  // the creator can pick a different card — same shape as the guided arm.
  const s = run(
    { type: 'setName', name: 'מרוץ' }, { type: 'next' },
    { type: 'choosePath', path: 'smart_build' }, { type: 'back' },
  );
  check('back returns to the fork', s.step === 'path', JSON.stringify(s.step));
  check('…with the path cleared', s.path === null, JSON.stringify(s.path));
  check('…and still nothing created', buildCreationPlan(s) === null);
}

{
  const s = run(
    { type: 'setName', name: 'מרוץ' }, { type: 'next' },
    { type: 'choosePath', path: 'smart_build' }, { type: 'cancel' },
  );
  check('cancel closes the wizard', s.step === 'closed', JSON.stringify(s.step));
  check('…creating nothing', buildCreationPlan(s) === null);
}

{
  const answers: ComposerAnswers = {
    audience: 'youth', setting: 'outdoor', people: 24, minutes: 90,
    ageBandId: 'band-14-17', difficultyPreference: 'balanced',
  };
  const s = run(
    { type: 'setName', name: 'מרוץ' }, { type: 'next' },
    { type: 'choosePath', path: 'smart_build' },
    { type: 'setComposerAnswers', answers },
    { type: 'next' },
  );
  const plan = buildCreationPlan(s, UNTITLED);
  check('a finished smart build yields a smart_build plan', plan?.kind === 'smart_build', JSON.stringify(plan?.kind));
  check('the title reaches the plan', plan?.title === 'מרוץ', JSON.stringify(plan?.title));
  check('the composer answers reach the plan',
    plan?.kind === 'smart_build' && JSON.stringify(plan.composerAnswers) === JSON.stringify(answers),
    JSON.stringify(plan?.kind === 'smart_build' ? plan.composerAnswers : null));
}

{
  // A blank name must not block here either (rule 2), and the questionnaire's
  // own defaults must carry through when the creator answered nothing.
  const s = run(
    { type: 'setName', name: '   ' }, { type: 'next' },
    { type: 'choosePath', path: 'smart_build' }, { type: 'next' },
  );
  const plan = buildCreationPlan(s, UNTITLED);
  check('a blank name falls back to the untitled title', plan?.title === UNTITLED, JSON.stringify(plan?.title));
  check('…and still produces a smart_build plan', plan?.kind === 'smart_build');
  check('…carrying usable default answers',
    plan?.kind === 'smart_build'
    && typeof plan.composerAnswers?.audience === 'string'
    && typeof plan.composerAnswers?.minutes === 'number'
    && plan.composerAnswers.minutes > 0,
    JSON.stringify(plan?.kind === 'smart_build' ? plan.composerAnswers : null));
}

// ── The two existing paths are byte-identical to before ──────────────────────
//
// Snapshotted explicitly rather than trusted: the smart-build arm shares this
// reducer, and a regression in it would otherwise only surface as a template
// path that quietly stopped personalising.
console.log('\n── smart build: the existing paths are untouched ──');

{
  const scratch = run({ type: 'setName', name: 'מרוץ' }, { type: 'next' }, { type: 'choosePath', path: 'scratch' });
  check('scratch still finishes immediately', scratch.step === 'done' && scratch.path === 'scratch',
    JSON.stringify(scratch));
  check('scratch still yields exactly a blank plan',
    JSON.stringify(buildCreationPlan(scratch, UNTITLED)) === JSON.stringify({ kind: 'blank', title: 'מרוץ' }),
    JSON.stringify(buildCreationPlan(scratch, UNTITLED)));

  const guided = run(
    { type: 'setName', name: 'מרוץ' }, { type: 'next' }, { type: 'choosePath', path: 'guided' },
    { type: 'setAnswer', key: 'type', value: 'missions' },
    { type: 'setAnswer', key: 'people', value: 24 },
    { type: 'setAnswer', key: 'duration', value: 120 },
    { type: 'setAnswer', key: 'age', value: 'band-11-13' },
    { type: 'next' },
  );
  check('guided still yields exactly the template plan it always did',
    JSON.stringify(buildCreationPlan(guided, UNTITLED)) === JSON.stringify({
      kind: 'template',
      title: 'מרוץ',
      gameType: 'missions',
      personalize: { groupSize: 24, durationMinutes: 120, minAge: 11 },
      answers: { people: 24, minutes: 120, ageBandId: 'band-11-13' },
    }),
    JSON.stringify(buildCreationPlan(guided, UNTITLED)));

  // An unknown path must still be ignored, now that there are three of them.
  const bogus = run({ type: 'setName', name: 'x' }, { type: 'next' }, { type: 'choosePath', path: 'nonsense' as never });
  check('an unknown path is still ignored', bogus.step === 'path' && bogus.path === null, JSON.stringify(bogus));
}

console.log(`\n${failures === 0 ? 'ALL NEW-GAME-WIZARD TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
