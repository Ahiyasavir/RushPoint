// Pure-logic tests — הקמה מהירה / Quick Setup, the shared half
// (change: quick-setup-wizard).
//
// The bug this feature exists to fix is that a template's SETUP INSTRUCTION lives
// inside the very field it is talking about, so a real exported template ships
// "[הערת מפעיל - למחוק]: הגדירו את המיקום…" as the text a PLAYER reads, and a quiz
// whose answer key is literally "(ערכו את התשובה)" passes every launch gate today.
//
// Four properties carry the whole design, and all four are pinned here:
//
//   1. IDENTITY OVER POSITION — a step resolves by stage/task id when it has one,
//      so reordering stages cannot silently re-point an instruction at a different
//      mission.
//   2. FAIL OPEN — an unresolvable step (deleted mission, malformed path) is INERT:
//      not shown, not counted, not launch-blocking, never a throw. A stale pointer
//      must not be able to wedge the Builder or lock a creator out of launching.
//   3. PLACEHOLDER ≠ CONFIGURED — a value that is present but still the template's
//      placeholder counts as unconfigured. This is the exact case computeGameReadiness
//      cannot see, because "(ערכו את התשובה)" is a perfectly valid answer key.
//   4. ONE MARKER LIST — stripping, detection and extraction read the SAME exported
//      list, so a marker can never be recognised in one place and missed in another.
//
//   npx tsx scripts/test-template-wizard.ts
import type { Game, Stage, Task } from '../packages/shared/src/types';
import {
  type TemplateWizardStep,
  resolveWizardTarget,
  readWizardFieldValue,
  isWizardStepConfigured,
  orderQuickSetupSteps,
  remapWizardStepIds,
  normalizeWizardSteps,
  pruneWizardSteps,
  OPERATOR_NOTE_MARKERS,
  stripOperatorNotes,
  isPlaceholderValue,
  extractQuickSetupSteps,
} from '../packages/shared/src/templateWizard';

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
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 5,
    ...over,
  } as Task;
}
function stage(id: string, tasks: Task[], over: Partial<Stage> = {}): Stage {
  return { id, order: 0, title: 'שלב', tasks, ...over } as Stage;
}
function game(stages: Stage[], over: Partial<Game> = {}): Game {
  return {
    id: 'g1', ownerUid: 'u1', title: 'משחק', mode: 'team', stages,
    scoringPreset: 'smart_weighted', registrationFields: [], visibility: 'private',
    tags: [], playCount: 0, createdAt: '', updatedAt: '', ...over,
  } as Game;
}
function step(over: Partial<TemplateWizardStep> & { id: string }): TemplateWizardStep {
  return {
    stageId: '', taskId: '', targetFieldPath: 'title',
    instructionPrompt: 'מלאו את השדה', isRequired: false, ...over,
  };
}

const g = game([
  stage('s1', [task({ id: 't1', title: 'מתחילים פה' })]),
  stage('s2', [
    task({ id: 't2', type: 'numeric', numericAnswer: 3, hint: 'רמז' }),
    task({ id: 't3', type: 'quiz', answers: ['(ערכו את התשובה)'] }),
  ], { order: 1 }),
]);

// ── 1. Path resolution ──────────────────────────────────────────────────────
console.log('\ntargetFieldPath resolution');
{
  const byId = resolveWizardTarget(g, step({ id: 'a', stageId: 's2', taskId: 't2', targetFieldPath: 'hint' }));
  eq('leaf-relative path with ids resolves to that task', byId && [byId.scope, byId.stageId, byId.taskId, byId.fieldPath], ['task', 's2', 't2', 'hint']);

  const abs = resolveWizardTarget(g, step({ id: 'b', targetFieldPath: 'stages[1].tasks[1].answers' }));
  eq('absolute indexed path resolves without ids', abs && [abs.scope, abs.stageId, abs.taskId, abs.fieldPath], ['task', 's2', 't3', 'answers']);

  const gameLevel = resolveWizardTarget(g, step({ id: 'c', targetFieldPath: 'title' }));
  eq('a step with no stage/task is game scope', gameLevel && [gameLevel.scope, gameLevel.fieldPath], ['game', 'title']);

  const stageLevel = resolveWizardTarget(g, step({ id: 'd', stageId: 's2', targetFieldPath: 'title' }));
  eq('a step with a stage but no task is stage scope', stageLevel && [stageLevel.scope, stageLevel.stageId], ['stage', 's2']);

  // IDENTITY OVER POSITION — the reordered game puts s2 first, so an index-only
  // path would now name a different mission; the id-carrying step must not move.
  const reordered = game([g.stages[1], g.stages[0]]);
  const after = resolveWizardTarget(reordered, step({ id: 'e', stageId: 's2', taskId: 't2', targetFieldPath: 'hint', }));
  eq('ids beat indexes after a reorder', after && [after.stageId, after.taskId], ['s2', 't2']);

  const stale = resolveWizardTarget(g, step({ id: 'f', stageId: 's2', taskId: 'gone', targetFieldPath: 'hint' }));
  eq('a step naming a deleted mission resolves to null', stale, null);
  eq('an out-of-range index resolves to null', resolveWizardTarget(g, step({ id: 'gx', targetFieldPath: 'stages[9].tasks[0].title' })), null);
  eq('an empty path resolves to null', resolveWizardTarget(g, step({ id: 'h', targetFieldPath: '   ' })), null);
  noThrow('resolution never throws on garbage', () => resolveWizardTarget(g, step({ id: 'i', targetFieldPath: 'stages[[.]].' })));
  noThrow('resolution never throws on a game with no stages', () => resolveWizardTarget(game([]), step({ id: 'j', stageId: 's1', targetFieldPath: 'title' })));
}

// ── 2. Reading values ───────────────────────────────────────────────────────
console.log('\nreadWizardFieldValue');
{
  eq('reads a nested task field', readWizardFieldValue(g, step({ id: 'a', stageId: 's2', taskId: 't2', targetFieldPath: 'numericAnswer' })), 3);
  eq('reads a game field', readWizardFieldValue(g, step({ id: 'b', targetFieldPath: 'title' })), 'משחק');
  eq('reads a dotted sub-field', readWizardFieldValue(g, step({ id: 'c', stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates.lat' })), 0);
  eq('an unreachable field reads undefined', readWizardFieldValue(g, step({ id: 'd', stageId: 's1', taskId: 't1', targetFieldPath: 'nope.deeper' })), undefined);
}

// ── 3. Configured, per field kind ───────────────────────────────────────────
console.log('\nisWizardStepConfigured');
{
  const cfg = (over: Partial<TemplateWizardStep>) => isWizardStepConfigured(g, step({ id: 'x', ...over }));
  ok('the {0,0} sentinel is NOT a placed location', !cfg({ stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates' }));

  const placed = game([stage('s1', [task({ id: 't1', coordinates: { lat: 31.7, lng: 35.2 } })])]);
  ok('a real pin is configured', isWizardStepConfigured(placed, step({ id: 'x', stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates' })));

  const anywhere = game([stage('s1', [task({ id: 't1', locationless: true })])]);
  ok('a locationless mission counts as located', isWizardStepConfigured(anywhere, step({ id: 'x', stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates' })));

  ok('a placeholder answer key is NOT configured', !cfg({ stageId: 's2', taskId: 't3', targetFieldPath: 'answers' }));
  ok('a real answer key is configured', isWizardStepConfigured(
    game([stage('s2', [task({ id: 't3', type: 'quiz', answers: ['כחול'] })])]),
    step({ id: 'x', stageId: 's2', taskId: 't3', targetFieldPath: 'answers' }),
  ));
  ok('a finite number is configured', cfg({ stageId: 's2', taskId: 't2', targetFieldPath: 'numericAnswer' }));
  ok('a missing number is not', !cfg({ stageId: 's2', taskId: 't3', targetFieldPath: 'numericAnswer' }));
  ok('an empty media list is not configured', !cfg({ stageId: 's2', taskId: 't2', targetFieldPath: 'media' }));
  ok('a non-empty media list is', isWizardStepConfigured(
    game([stage('s2', [task({ id: 't2', media: [{ id: 'm', kind: 'image', url: 'https://x/y.png' }] as Task['media'] })])]),
    step({ id: 'x', stageId: 's2', taskId: 't2', targetFieldPath: 'media' }),
  ));
  ok('a blank description is not configured', !isWizardStepConfigured(
    game([stage('s1', [task({ id: 't1', description: '   ' })])]),
    step({ id: 'x', stageId: 's1', taskId: 't1', targetFieldPath: 'description' }),
  ));
  ok('a description still carrying an operator note is not configured', !isWizardStepConfigured(
    game([stage('s1', [task({ id: 't1', description: '[הערת מפעיל - למחוק]: הגדירו מיקום' })])]),
    step({ id: 'x', stageId: 's1', taskId: 't1', targetFieldPath: 'description' }),
  ));
  ok('a boolean is always configured (no unset state)', isWizardStepConfigured(
    game([stage('s1', [task({ id: 't1', smart: { enabled: true, verificationType: 'photo_upload', autoApprove: false } })])]),
    step({ id: 'x', stageId: 's1', taskId: 't1', targetFieldPath: 'smart.autoApprove' }),
  ));
  // FAIL OPEN — an inert step must never read as outstanding work.
  ok('an unresolvable step counts as configured', cfg({ stageId: 's2', taskId: 'gone', targetFieldPath: 'hint' }));
}

// ── 4. Recommended order ────────────────────────────────────────────────────
console.log('\norderQuickSetupSteps');
{
  const authored: TemplateWizardStep[] = [
    step({ id: 'late', stageId: 's2', taskId: 't3', targetFieldPath: 'answers' }),
    step({ id: 'early', stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates' }),
    step({ id: 'gone', stageId: 's9', taskId: 't9', targetFieldPath: 'title' }),
    step({ id: 'name', targetFieldPath: 'title' }),
    step({ id: 'mid', stageId: 's2', taskId: 't2', targetFieldPath: 'hint' }),
  ];
  eq('game level first, then stage then task order, unresolvable dropped',
    orderQuickSetupSteps(g, authored).map((s) => s.id), ['name', 'early', 'mid', 'late']);
  eq('an empty list is empty', orderQuickSetupSteps(g, []), []);
  eq('undefined steps is empty', orderQuickSetupSteps(g, undefined), []);

  // Five lettered tiers, within ONE mission, NOT authored order: a. concept →
  // b. details/riddle → c. location → d. verification → e. advanced. A numeric
  // riddle's answer always follows the pin, because the number is almost always a
  // property of the physical spot the pin marks — asking for it first is asking
  // the creator to answer a question about a place that does not exist yet.
  const fiveTierOrder = [
    step({ id: 'verification', stageId: 's2', taskId: 't2', targetFieldPath: 'numericAnswer' }),
    step({ id: 'location', stageId: 's2', taskId: 't2', targetFieldPath: 'coordinates' }),
    step({ id: 'advanced', stageId: 's2', taskId: 't2', targetFieldPath: 'hint' }),
    step({ id: 'details', stageId: 's2', taskId: 't2', targetFieldPath: 'locationClue' }),
    step({ id: 'concept', stageId: 's2', taskId: 't2', targetFieldPath: 'description' }),
  ];
  eq('one mission orders a.concept → b.details → c.location → d.verification → e.advanced, not authored order',
    orderQuickSetupSteps(g, fiveTierOrder).map((s) => s.id),
    ['concept', 'details', 'location', 'verification', 'advanced']);

  // The riddle/clue text precedes the pin: it is what the creator WRITES to
  // describe the mission, not the location itself.
  const riddleBeforePin = [
    step({ id: 'pin', stageId: 's2', taskId: 't2', targetFieldPath: 'coordinates' }),
    step({ id: 'riddle', stageId: 's2', taskId: 't2', targetFieldPath: 'locationClue' }),
  ];
  eq('the riddle/clue text precedes the pin', orderQuickSetupSteps(g, riddleBeforePin).map((s) => s.id), ['riddle', 'pin']);

  // auto-approve is a VERIFICATION setting (how a submission is judged), so it
  // precedes advanced/scoring fields rather than sitting alongside them.
  const autoApproveIsVerification = [
    step({ id: 'points', stageId: 's2', taskId: 't2', targetFieldPath: 'pointValue' }),
    step({ id: 'autoApprove', stageId: 's2', taskId: 't2', targetFieldPath: 'smart.autoApprove' }),
  ];
  eq('auto-approve is verification, ordered before advanced/scoring',
    orderQuickSetupSteps(g, autoApproveIsVerification).map((s) => s.id), ['autoApprove', 'points']);

  // Two fields that share a rank tier (both "how it is completed") keep the
  // order they were authored in — the sort is stable, not arbitrary.
  const tie = [
    step({ id: 'second', stageId: 's2', taskId: 't2', targetFieldPath: 'answers' }),
    step({ id: 'first', stageId: 's2', taskId: 't2', targetFieldPath: 'choices' }),
  ];
  eq('two steps on ONE mission with the same rank keep their authored order', orderQuickSetupSteps(g, tie).map((s) => s.id), ['second', 'first']);
}

// ── 5. Normalization / pruning (the updateGame contract) ────────────────────
console.log('\nnormalizeWizardSteps + pruneWizardSteps');
{
  eq('undefined stays undefined (field not sent)', normalizeWizardSteps(undefined), undefined);
  eq('null clears to an empty list', normalizeWizardSteps(null), []);
  eq('a non-array is malformed', normalizeWizardSteps('nope'), null);
  eq('an entry with no id is malformed', normalizeWizardSteps([{ targetFieldPath: 'title' }]), null);
  eq('an entry with no path is malformed', normalizeWizardSteps([{ id: 'a', targetFieldPath: '' }]), null);

  const kept = normalizeWizardSteps([
    { id: 'a', stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates', instructionPrompt: 'שימו סיכה', isRequired: true, extra: 'dropped' },
  ]);
  eq('a valid entry keeps exactly the declared fields', kept, [
    { id: 'a', stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates', instructionPrompt: 'שימו סיכה', isRequired: true },
  ]);
  eq('optional members default', normalizeWizardSteps([{ id: 'b', targetFieldPath: 'title' }]), [
    { id: 'b', stageId: '', taskId: '', targetFieldPath: 'title', instructionPrompt: '', isRequired: false },
  ]);
  eq('a duplicate id is dropped, first wins',
    (normalizeWizardSteps([{ id: 'a', targetFieldPath: 'title' }, { id: 'a', targetFieldPath: 'description' }]) ?? []).map((s) => s.targetFieldPath), ['title']);

  // A deleted mission must NOT be able to refuse an autosave.
  const pruned = pruneWizardSteps([
    step({ id: 'live', stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates' }),
    step({ id: 'dead', stageId: 's1', taskId: 'deleted', targetFieldPath: 'coordinates' }),
  ], g.stages);
  eq('pruning drops steps naming a missing mission', pruned.map((s) => s.id), ['live']);
  eq('pruning tolerates no stages', pruneWizardSteps([step({ id: 'a', stageId: 's1', targetFieldPath: 'title' })], []), []);
}

// ── 6. Remap on copy ────────────────────────────────────────────────────────
console.log('\nremapWizardStepIds');
{
  const map = new Map([['s1', 'S1'], ['t1', 'T1']]);
  const out = remapWizardStepIds([
    step({ id: 'a', stageId: 's1', taskId: 't1', targetFieldPath: 'coordinates' }),
    step({ id: 'b', targetFieldPath: 'title' }),
  ], map);
  eq('stage and task references follow the copy', [out[0].stageId, out[0].taskId], ['S1', 'T1']);
  eq('a game-level step is untouched', [out[1].stageId, out[1].taskId], ['', '']);
  eq('an unmapped id is left alone rather than dropped',
    remapWizardStepIds([step({ id: 'a', stageId: 'zz', targetFieldPath: 'title' })], map)[0].stageId, 'zz');
  noThrow('remap tolerates an empty list', () => remapWizardStepIds([], map));
}

// ── 7. The marker list, stripping, and extraction ───────────────────────────
console.log('\noperator notes');
{
  ok('the marker list is non-empty and exported once', OPERATOR_NOTE_MARKERS.length > 0);

  // Verbatim shapes from the real exported template.
  const realNote = '[הערת מפעיל - למחוק]: הגדירו את המיקום בשלב 1 וצרפו תמונה תקריב (קלוז-אפ) קשה לזיהוי של האובייקט/המקום.';
  eq('a note that IS the whole description strips to nothing', stripOperatorNotes(realNote), '');

  const mixed = '[הוראות למפעיל - למחוק]: הוסיפו את נקודת הסיום במפה במערכת, ולאחר הקריאה מחקו את הפסקה הזו.נווטו אל נקודת הסיום של המירוץ';
  eq('the player-facing remainder survives', stripOperatorNotes(mixed), 'נווטו אל נקודת הסיום של המירוץ');

  eq('an inline answer placeholder is removed from prose',
    stripOperatorNotes('באיזו שנה נולד/ה חתן/כלת השמחה? (ערכו את התשובה)'), 'באיזו שנה נולד/ה חתן/כלת השמחה?');
  eq('clean prose is returned unchanged', stripOperatorNotes('תבנו דגל ישראל ענק'), 'תבנו דגל ישראל ענק');
  eq('empty input is empty', stripOperatorNotes(''), '');
  eq('undefined input is empty', stripOperatorNotes(undefined), '');

  ok('a placeholder answer key is detected', isPlaceholderValue('(ערכו את התשובה) / (edit this answer)'));
  ok('the English placeholder is detected', isPlaceholderValue('(edit this answer)'));
  ok('a bracketed note is detected', isPlaceholderValue('[הערת מפעיל - למחוק]: משהו'));
  ok('a real answer is not a placeholder', !isPlaceholderValue('כחול'));
  ok('a blank is not treated as a placeholder', !isPlaceholderValue('   '));
}

console.log('\nextractQuickSetupSteps');
{
  const dirty = game([
    stage('s1', [task({
      id: 't1', title: 'מתחילים פה',
      description: 'הוראות ליוצר: (הכניסו את נקודת ההתחלה של המשחק על גבי המפה במערכת, ולאחר הקריאה מחקו את הפסקה הזו).',
    })]),
    stage('s2', [
      task({
        id: 't2', type: 'geofence',
        description: '[הערת מפעיל - למחוק]: הגדירו את המיקום בשלב 1 וצרפו תמונה תקריב (קלוז-אפ) קשה לזיהוי של האובייקט/המקום.',
      }),
      task({
        id: 't3', type: 'quiz', description: 'מה הצבע האהוב? (ערכו את התשובה)',
        answers: ['(ערכו את התשובה) / (edit this answer)'],
      }),
      task({ id: 't4', description: 'תבנו דגל ישראל ענק וצלמו אותו' }),
    ], { order: 1 }),
  ], {
    instructions: { title: 'איך משחקים', bodyHe: '[הערת מפעיל - למחוק/התאימו לפי הצורך]: המשחק נפתח בנקודת התחלה משותפת.' },
  });

  const out = extractQuickSetupSteps(dirty);

  // (a) the prose is cleaned
  eq('the creator-note description is emptied', out.stages[1].tasks[0].description, '');
  eq('the player half of a mixed description survives', out.stages[1].tasks[1].description, 'מה הצבע האהוב?');
  eq('clean prose is untouched', out.stages[1].tasks[2].description, 'תבנו דגל ישראל ענק וצלמו אותו');
  eq('a placeholder answer key is emptied, not kept', out.stages[1].tasks[1].answers, []);
  eq('the primer note is stripped too', out.instructions?.bodyHe, 'המשחק נפתח בנקודת התחלה משותפת.');

  // (b) every stripped instruction reappears as a step
  const paths = out.wizardSteps.map((s) => `${s.taskId || 'game'}:${s.targetFieldPath}`);
  ok('the start-point note becomes a location step', paths.includes('t1:coordinates'));
  ok('a note naming BOTH a location and a photo yields two steps', paths.includes('t2:coordinates') && paths.includes('t2:media'));
  ok('a placeholder answer key becomes an answer step', paths.includes('t3:answers'));
  ok('a clean mission produces no step', !paths.some((p) => p.startsWith('t4:')));
  ok('every produced step carries a non-empty prompt', out.wizardSteps.every((s) => s.instructionPrompt.trim() !== ''));
  ok('every produced step has a unique id', new Set(out.wizardSteps.map((s) => s.id)).size === out.wizardSteps.length);
  ok('every produced step resolves against the cleaned game',
    out.wizardSteps.every((s) => resolveWizardTarget(game(out.stages), s) !== null));
  ok('location and answer steps are required', out.wizardSteps
    .filter((s) => ['coordinates', 'answers', 'media'].includes(s.targetFieldPath))
    .every((s) => s.isRequired));

  // (c) idempotence — running it twice must not duplicate work
  const again = extractQuickSetupSteps(game(out.stages, { instructions: out.instructions, wizardSteps: out.wizardSteps }));
  eq('a cleaned game yields no new steps', again.wizardSteps.length, out.wizardSteps.length);

  noThrow('extraction tolerates an empty game', () => extractQuickSetupSteps(game([])));
}

console.log(failures === 0 ? '\n✅ template-wizard: ALL PASS' : `\n❌ template-wizard: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
