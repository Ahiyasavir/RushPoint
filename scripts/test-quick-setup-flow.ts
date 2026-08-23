// Pure-logic tests — הקמה מהירה / Quick Setup, the creator-web half
// (change: quick-setup-wizard).
//
// What has to hold for the flow to be trustworthy:
//
//   • "REMAINING" IS DERIVED. The pill count and the launch guard read the LIVE
//     game, never a stored completion flag. A creator who fills a deferred field
//     by hand sees the count drop without touching the flow, and no stored record
//     can claim a field is done while it is empty.
//   • DEFERRAL IS NOT ABANDONMENT. Advancing past the last step re-enters the first
//     deferred step that is still unconfigured; only when there is none is the flow
//     done. "חזור לזה מאוחר יותר" has to actually come back.
//   • THE FOCUS PLAN IS DATA. Every field a step can target names the editor tab
//     that owns it and the collapsed group it hides in, so deep navigation is a
//     table lookup rather than a per-field special case in JSX.
//   • PERSISTENCE IS PER CREATOR AND PER GAME, and malformed storage degrades to
//     "never started" rather than throwing inside the Builder.
//
//   npx tsx scripts/test-quick-setup-flow.ts
import type { Game, Stage, Task } from '../packages/shared/src/types';
import type { TemplateWizardStep } from '../packages/shared/src/templateWizard';
import {
  INITIAL_QUICK_SETUP_STATE,
  quickSetupReducer,
  quickSetupSteps,
  outstandingQuickSetupIds,
  quickSetupRemainingCount,
  quickSetupLaunchBlockers,
  firstQuickSetupBlocker,
  currentQuickSetupStep,
  quickSetupIntroStep,
  quickSetupChapterKey,
  shouldAutoOpenQuickSetup,
  missionSummaryLine,
  quickSetupProgress,
  quickSetupStorageKey,
  readQuickSetupRecord,
  writeQuickSetupRecord,
  quickSetupFocusPlan,
  QUICK_SETUP_FIELDS,
  QUICK_SETUP_COPY_KEYS,
  QUICK_SETUP_VERSION,
} from '../apps/creator-web/src/lib/quickSetup';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  ok(`${label} (got ${a}, want ${e})`, a === e);
}
function noThrow(label: string, fn: () => unknown): unknown {
  try { const v = fn(); ok(label, true); return v; } catch (e) {
    failures++; console.error(`  ✗ ${label} — threw ${String(e)}`); return undefined;
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: 'משימה', type: 'field', coordinates: { lat: 0, lng: 0 },
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 5, ...over,
  } as Task;
}
function game(stages: Stage[], steps: TemplateWizardStep[]): Game {
  return {
    id: 'g1', ownerUid: 'u1', title: 'משחק', mode: 'team', stages,
    scoringPreset: 'smart_weighted', registrationFields: [], visibility: 'private',
    tags: [], playCount: 0, createdAt: '', updatedAt: '', wizardSteps: steps,
  } as Game;
}
function step(over: Partial<TemplateWizardStep> & { id: string }): TemplateWizardStep {
  return {
    stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates',
    instructionPrompt: 'שימו סיכה על המפה', isRequired: true, ...over,
  };
}

// Authored deliberately "wrong" for the flow: the map pin is written FIRST, but
// "explain, then place" runs the picture (rank 20) ahead of the pin (rank 40), so
// the expected order below is pic → pin, not the authored pin → pic.
const STEPS: TemplateWizardStep[] = [
  step({ id: 'pin', stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates', isRequired: true }),
  step({ id: 'pic', stageId: 's1', taskId: 't1', targetFieldPath: 'media', isRequired: true }),
  step({ id: 'ans', stageId: 's2', taskId: 't2', targetFieldPath: 'answers', isRequired: true }),
  step({ id: 'tip', stageId: 's2', taskId: 't2', targetFieldPath: 'hint', isRequired: false }),
];

/** Nothing configured: no pin, no media, a placeholder answer key, no hint. */
const raw = game([
  { id: 's1', order: 0, title: 'שלב 1', tasks: [task({ id: 't1' })] } as Stage,
  { id: 's2', order: 1, title: 'שלב 2', tasks: [task({ id: 't2', type: 'quiz', answers: ['(ערכו את התשובה)'] })] } as Stage,
], STEPS);

/** Everything a launch needs is filled in; only the optional hint is left. */
const ready = game([
  {
    id: 's1', order: 0, title: 'שלב 1',
    tasks: [task({
      id: 't1', coordinates: { lat: 31.78, lng: 35.21 },
      media: [{ id: 'm', kind: 'image', url: 'https://x/y.png' }] as Task['media'],
    })],
  } as Stage,
  { id: 's2', order: 1, title: 'שלב 2', tasks: [task({ id: 't2', type: 'quiz', answers: ['כחול'] })] } as Stage,
], STEPS);

// ── 1. Derived outstanding work ─────────────────────────────────────────────
console.log('\nremaining is derived from the game');
{
  // `raw`/`ready` already carry a configured game.title ('משחק'), so the SYNTHETIC
  // game-name step (see `quickSetupSteps`) is prepended but is never outstanding —
  // it still appears in the ordered list, first, because a real title step would
  // too.
  eq('the flow orders fields by "explain then place", the synthetic game name always first',
    quickSetupSteps(raw).map((s) => s.id), ['qs-synthetic-game-title', 'pic', 'pin', 'ans', 'tip']);
  eq('nothing filled in yet ⇒ everything outstanding', outstandingQuickSetupIds(raw).sort(), ['ans', 'pic', 'pin', 'tip']);
  eq('the pill counts outstanding steps', quickSetupRemainingCount(raw), 4);
  eq('a configured game leaves only the optional hint', outstandingQuickSetupIds(ready), ['tip']);
  eq('a game with no steps has nothing outstanding', quickSetupRemainingCount(game([], [])), 0);
  noThrow('a game with no wizardSteps at all is inert', () => quickSetupRemainingCount({ ...raw, wizardSteps: undefined }));
}

// ── 2. Launch guard ─────────────────────────────────────────────────────────
console.log('\nlaunch guard');
{
  eq('required and unconfigured steps block a launch', quickSetupLaunchBlockers(raw).map((s) => s.id), ['pic', 'pin', 'ans']);
  eq('the first blocker is the first in recommended order', firstQuickSetupBlocker(raw)?.id, 'pic');
  eq('an optional outstanding step never blocks', quickSetupLaunchBlockers(ready), []);
  eq('no blockers ⇒ null', firstQuickSetupBlocker(ready), null);
  // A placeholder answer key is structurally VALID, which is exactly why the
  // existing readiness surface cannot catch it.
  ok('a placeholder answer key IS a blocker', quickSetupLaunchBlockers(raw).some((s) => s.id === 'ans'));
}

// ── 3. The state machine ────────────────────────────────────────────────────
// `quickSetupSteps(raw)` is now 5-long: the synthetic game-name step (already
// configured, since `raw.title` is set) always leads, then pic+pin share a
// chapter (s1/t1), then ans+tip share a chapter (s2/t2). Context-first: every
// ENTRY into the flow lands on the chapter's INTRO, never straight on a field,
// and moving between two fields of the SAME chapter never re-shows it.
console.log('\nquickSetupReducer — context-first');
{
  const ctx = { steps: quickSetupSteps(raw), outstanding: outstandingQuickSetupIds(raw) };
  const run = (state: typeof INITIAL_QUICK_SETUP_STATE, ...actions: Parameters<typeof quickSetupReducer>[1][]) =>
    actions.reduce((s, a) => quickSetupReducer(s, a, ctx), state);

  eq('the synthetic game name leads, ahead of every mission', ctx.steps[0].id, 'qs-synthetic-game-title');
  eq('pic and pin share a chapter', quickSetupChapterKey(ctx.steps[1]), quickSetupChapterKey(ctx.steps[2]));
  ok('pic and ans do not', quickSetupChapterKey(ctx.steps[1]) !== quickSetupChapterKey(ctx.steps[3]));

  const invited = run(INITIAL_QUICK_SETUP_STATE, { type: 'invite' });
  // entryIndex skips the ALREADY-CONFIGURED synthetic step (raw.title is set) and
  // lands on the first genuinely outstanding field, 'pic' — index 1, not 0.
  eq('invite opens the welcome card, touching nothing yet', [invited.status, invited.index], ['welcome', 1]);
  eq('no bar and no intro card while on welcome', [currentQuickSetupStep(invited, ctx.steps), quickSetupIntroStep(invited, ctx.steps)], [null, null]);

  const opened = run(INITIAL_QUICK_SETUP_STATE, { type: 'open' });
  eq('open lands on the chapter intro, not on the field', [opened.status, opened.index], ['intro', 1]);
  eq('the intro card names the right step', quickSetupIntroStep(opened, ctx.steps)?.id, 'pic');
  eq('no bar is shown while the intro card is up', currentQuickSetupStep(opened, ctx.steps), null);

  const begun = run(opened, { type: 'begin' });
  eq('begin moves from intro into the bar, same field', [begun.status, begun.index], ['running', 1]);
  eq('current step is the one at the index', currentQuickSetupStep(begun, ctx.steps)?.id, 'pic');
  eq('progress is one-based, out of all five (incl. the game name)', quickSetupProgress(begun, ctx.steps), { step: 2, total: 5 });
  // The welcome card has not shown a single mission's context yet, so its own
  // `begin` steps DOWN to that mission's intro card rather than skipping straight
  // to the bar — otherwise the very first OUTSTANDING mission would be the one
  // mission that never gets oriented.
  const welcomeBegun = run(invited, { type: 'begin' });
  eq('welcome → begin lands on the first outstanding mission\'s intro, not the bar', [welcomeBegun.status, welcomeBegun.index], ['intro', 1]);
  eq('and intro → begin from there reaches the bar', run(welcomeBegun, { type: 'begin' }).status, 'running');

  const withinChapter = run(begun, { type: 'next' });
  eq('next within the same mission goes straight to the next field', [withinChapter.status, withinChapter.index], ['running', 2]);

  const acrossChapter = run(withinChapter, { type: 'next' });
  eq('next INTO a new mission returns to that mission\'s intro card first', [acrossChapter.status, acrossChapter.index], ['intro', 3]);

  eq('next cannot step past an intro card the creator has not acknowledged', run(acrossChapter, { type: 'next' }), acrossChapter);
  // "Not this mission, not now" is a decision a creator may make FROM the context
  // card, so defer is live on both surfaces — unlike next.
  const deferredFromIntro = run(acrossChapter, { type: 'defer' });
  eq('defer works from the intro card too', [deferredFromIntro.deferred, deferredFromIntro.index], [['ans'], 4]);

  eq('jump always re-introduces the target mission', run(begun, { type: 'jump', index: 99 }).status, 'intro');
  eq('jump clamps out-of-range', run(begun, { type: 'jump', index: 99 }).index, 4);
  // Jumping to index 0 now lands on the (already-configured) synthetic step — a
  // valid clamp target regardless, since clamping only bounds the index.
  eq('jump clamps negatives', run(begun, { type: 'jump', index: -4 }).index, 0);

  const deferred = run(begun, { type: 'defer' });
  eq('defer records the step and advances within the mission', [deferred.deferred, deferred.status, deferred.index], [['pic'], 'running', 2]);
  eq('deferring twice does not duplicate', run(deferred, { type: 'jump', index: 1 }, { type: 'begin' }, { type: 'defer' }).deferred, ['pic']);

  // DEFERRAL IS NOT ABANDONMENT.
  const atEnd = run(deferred, { type: 'jump', index: 4 }, { type: 'begin' }, { type: 'next' });
  eq('advancing off the end returns to the deferred step\'s intro', [atEnd.status, atEnd.index], ['intro', 1]);

  const noneDeferred = run(begun, { type: 'jump', index: 4 }, { type: 'begin' }, { type: 'next' });
  eq('with nothing deferred, advancing off the end finishes', noneDeferred.status, 'done');

  // A deferred step the creator filled in elsewhere must not be re-offered.
  // `ready.title` is configured too, so `quickSetupSteps(ready)` is the same
  // 5-long shape; index 4 is its LAST step ('tip').
  const doneCtx = { steps: quickSetupSteps(ready), outstanding: outstandingQuickSetupIds(ready) };
  const stale = quickSetupReducer({ status: 'running', index: 4, deferred: ['pic'] }, { type: 'next' }, doneCtx);
  eq('a deferred step that is now configured is not revisited', stale.status, 'done');

  const closed = run(begun, { type: 'close' });
  eq('close stops the flow but keeps the deferrals', [closed.status, closed.deferred], ['closed', []]);
  eq('resume reopens on the intro card, not mid-field', run(closed, { type: 'resume' }).status, 'intro');
  eq('resume prefers a deferred step', quickSetupReducer(
    { status: 'closed', index: 0, deferred: ['ans'] }, { type: 'resume' }, ctx,
  ).index, 3);
  eq('reset clears everything', run(deferred, { type: 'reset' }), INITIAL_QUICK_SETUP_STATE);

  // Totality.
  const empty = { steps: [], outstanding: [] };
  eq('open with no steps finishes immediately', quickSetupReducer(INITIAL_QUICK_SETUP_STATE, { type: 'open' }, empty).status, 'done');
  eq('invite with no steps finishes immediately', quickSetupReducer(INITIAL_QUICK_SETUP_STATE, { type: 'invite' }, empty).status, 'done');
  eq('next with no steps is inert', quickSetupReducer({ status: 'running', index: 0, deferred: [] }, { type: 'next' }, empty).status, 'done');
  eq('current step of an idle flow is null', currentQuickSetupStep(INITIAL_QUICK_SETUP_STATE, ctx.steps), null);
  eq('intro step of an idle flow is null', quickSetupIntroStep(INITIAL_QUICK_SETUP_STATE, ctx.steps), null);
  eq('progress of an empty flow is zeroes', quickSetupProgress(begun, []), { step: 0, total: 0 });
  noThrow('an unknown action is inert', () => quickSetupReducer(begun, { type: 'nope' } as never, ctx));
}

// ── 3a. The synthetic game-name step ────────────────────────────────────────
console.log('\nquickSetupSteps — the synthetic game-name step');
{
  const untitled = game([
    { id: 's1', order: 0, title: 'שלב 1', tasks: [task({ id: 't1' })] } as Stage,
  ], [step({ id: 'pin', stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates' })]);
  (untitled as { title: string }).title = '';

  const withUntitled = quickSetupSteps(untitled);
  eq('the game name leads a game whose title is not yet set', withUntitled[0]?.id, 'qs-synthetic-game-title');
  eq('it is required', withUntitled[0]?.isRequired, true);
  ok('an untitled game reports the name as outstanding',
    outstandingQuickSetupIds(untitled).includes('qs-synthetic-game-title'));
  ok('an untitled game refuses to launch on the name alone',
    quickSetupLaunchBlockers(untitled).some((s) => s.id === 'qs-synthetic-game-title'));

  ok('a game with NO real steps at all gets no synthetic step either — Quick Setup is silent for it',
    quickSetupSteps(game([], [])).length === 0);

  // A real, template-authored step targeting the game's own title pre-empts the
  // synthetic one — no duplicate "set the name" entries.
  const withRealTitleStep = game([
    { id: 's1', order: 0, title: 'שלב 1', tasks: [task({ id: 't1' })] } as Stage,
  ], [step({ id: 'realName', stageId: '', taskId: '', targetFieldPath: 'title', isRequired: true })]);
  eq('a real title step is used as-is, not doubled up',
    quickSetupSteps(withRealTitleStep).filter((s) => s.stageId === '' && s.targetFieldPath === 'title').length, 1);
  eq('...and it keeps its own id', quickSetupSteps(withRealTitleStep)[0]?.id, 'realName');
}

// ── 3b. The auto-invite gate ────────────────────────────────────────────────
console.log('\nshouldAutoOpenQuickSetup');
{
  ok('offers the welcome card on a fresh template with work outstanding',
    shouldAutoOpenQuickSetup({ hasRecord: false, outstanding: 4, total: 4 }));
  ok('never re-offers once this creator has a record for this game',
    !shouldAutoOpenQuickSetup({ hasRecord: true, outstanding: 4, total: 4 }));
  ok('never offers a game with no Quick Setup steps at all',
    !shouldAutoOpenQuickSetup({ hasRecord: false, outstanding: 0, total: 0 }));
  ok('never offers a game that is already fully configured',
    !shouldAutoOpenQuickSetup({ hasRecord: false, outstanding: 0, total: 4 }));
}

// ── 3c. The context card's mission summary ──────────────────────────────────
// Quoting the creator's own description beats any generic line — but a context
// card is not the place to read three paragraphs, and it must degrade to '' (the
// caller's generic line) rather than to a broken quote.
console.log('\nmissionSummaryLine');
{
  eq('a one-sentence description is quoted whole',
    missionSummaryLine('מצאו את הפסל בכיכר וצלמו אותו.'), 'מצאו את הפסל בכיכר וצלמו אותו.');
  eq('only the first sentence is quoted',
    missionSummaryLine('מצאו את הפסל. אחר כך רוצו לנקודה הבאה.'), 'מצאו את הפסל.');
  eq('whitespace and newlines collapse',
    missionSummaryLine('  מצאו\n\n  את הפסל  '), 'מצאו את הפסל');
  ok('a very long single sentence is clipped, not dumped',
    missionSummaryLine('א'.repeat(40) + ' ' + 'ב'.repeat(300)).length < 160);
  ok('a clipped summary ends in an ellipsis',
    missionSummaryLine('word '.repeat(90)).endsWith('…'));
  eq('an empty description yields the empty string', missionSummaryLine(''), '');
  eq('a whitespace-only description yields the empty string', missionSummaryLine('   \n  '), '');
  eq('a missing description yields the empty string', missionSummaryLine(undefined), '');
  eq('a non-string is safe', missionSummaryLine(null), '');
}

// ── 4. Persistence ──────────────────────────────────────────────────────────
console.log('\npersistence');
{
  ok('the key is scoped by uid AND game', quickSetupStorageKey('uidA', 'g1') !== quickSetupStorageKey('uidB', 'g1')
    && quickSetupStorageKey('uidA', 'g1') !== quickSetupStorageKey('uidA', 'g2'));
  ok('a missing uid still yields a usable key', quickSetupStorageKey(null, 'g1').length > 0);

  const stored = writeQuickSetupRecord({ status: 'closed', index: 2, deferred: ['pin'] });
  const back = readQuickSetupRecord(stored);
  eq('a record round-trips', [back?.status, back?.deferred], ['closed', ['pin']]);
  eq('the version is stamped', JSON.parse(stored).version, QUICK_SETUP_VERSION);
  eq('missing storage reads as never started', readQuickSetupRecord(null), null);
  eq('malformed storage reads as never started', readQuickSetupRecord('{{{'), null);
  eq('a record with a junk status is rejected', readQuickSetupRecord('{"version":1,"status":"weird"}'), null);
  eq('junk inside deferred is filtered out', readQuickSetupRecord('{"version":1,"status":"closed","deferred":["a",3,null]}')?.deferred, ['a']);
  noThrow('reading an array is safe', () => readQuickSetupRecord('[1,2,3]'));
}

// ── 5. The focus plan ───────────────────────────────────────────────────────
console.log('\nquickSetupFocusPlan');
{
  const plan = (fieldPath: string, scope: 'game' | 'stage' | 'task' = 'task') =>
    quickSetupFocusPlan({ scope, stageId: 's1', taskId: 't1', stageIndex: 0, taskIndex: 0, fieldPath });

  eq('the map pin lives on the location tab', [plan('coordinates').wizardStep, plan('coordinates').optInGroup], ['location', null]);
  eq('the description lives on the details tab', plan('description').wizardStep, 'details');
  eq('media lives on the details tab, not behind a chip', [plan('media').wizardStep, plan('media').optInGroup], ['details', null]);
  eq('an answer key lives on the execution tab', plan('answers').wizardStep, 'execution');
  eq('the paid hint hides inside the hint group', [plan('hint').wizardStep, plan('hint').optInGroup], ['execution', 'hint']);
  eq('points hide inside the timing group', plan('pointValue').optInGroup, 'timerPoints');
  eq('the concurrency cap hides inside the rules group', plan('maxConcurrentTeams').optInGroup, 'rules');
  eq('a game-level field has no editor tab', [plan('title', 'game').wizardStep, plan('title', 'game').anchor], [null, 'game.title']);
  eq('the primer anchors on its own control', plan('instructions.bodyHe', 'game').anchor, 'game.instructions');
  eq('a task field anchors on its own path', plan('answers').anchor, 'answers');

  // An unknown field must degrade, not throw: the editor still opens.
  const unknown = plan('someFutureField');
  eq('an unrecognised field opens the editor and focuses nothing', [unknown.anchor, unknown.wizardStep, unknown.optInGroup], [null, null, null]);
  noThrow('a malformed target is safe', () => quickSetupFocusPlan(null));

  ok('every registry entry declares an anchor', Object.entries(QUICK_SETUP_FIELDS)
    .every(([path, entry]) => typeof entry.anchor === 'string' && entry.anchor.length > 0 && path.length > 0));
  ok('every task-scope entry names an editor tab', Object.values(QUICK_SETUP_FIELDS)
    .every((e) => e.scope === 'game' ? e.wizardStep === null : e.wizardStep !== null));
  ok('every registry entry names a real copy slot', Object.values(QUICK_SETUP_FIELDS)
    .every((e) => (QUICK_SETUP_COPY_KEYS as readonly string[]).includes(e.copy)));
  ok('the registry covers every field extraction can produce',
    ['coordinates', 'media', 'answers', 'numericAnswer', 'surveyChoices', 'steps', 'hint', 'smart.autoApprove', 'description', 'instructions.bodyHe']
      .every((f) => f in QUICK_SETUP_FIELDS));
}

console.log(failures === 0 ? '\n✅ quick-setup-flow: ALL PASS' : `\n❌ quick-setup-flow: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
