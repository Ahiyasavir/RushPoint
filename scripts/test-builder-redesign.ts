// Pure-logic suite for the v2.1 Builder shell redesign (change:
// v2.1-builder-shell-redesign). Covers the four invariants that protect the
// refactor: scannable card previews, the backward-compatible dynamic-quiz
// mapping, Inspiration-Mode template loading, and panel draft isolation.
//   npx tsx scripts/test-builder-redesign.ts
import type { Task, TaskType } from '../packages/shared/src/types/index';
import { taskPreviewLine, TYPE_FAMILY_COLOR, TYPE_LABEL } from '../apps/creator-web/src/lib/taskCardPreview';
import {
  choicesFromTask, choicesToTask, addChoice, removeChoice, setChoiceText, toggleCorrect,
} from '../apps/creator-web/src/lib/quizFields';
import { TASK_SAMPLES, applySample } from '../apps/creator-web/src/lib/taskTemplates';
import { initDraft, editDraft, isDirty, commit } from '../apps/creator-web/src/lib/taskDraft';
import { moveItem } from '../apps/creator-web/src/lib/reorder';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

function task(p: Partial<Task> = {}): Task {
  return {
    id: 't1', title: 'T', type: 'field', coordinates: { lat: 0, lng: 0 },
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 3,
    ...p,
  };
}

// ── 1. taskPreviewLine — every interaction type produces scannable text ──
check('field preview', taskPreviewLine(task({ type: 'field' })) === 'Tap to check in');
check('self_report preview', taskPreviewLine(task({ type: 'self_report' })) === 'Team self report');
check('smart_station with code', taskPreviewLine(task({ type: 'smart_station', smart: { enabled: true, verificationType: 'code_verification', secretCode: 'ABC' } })) === 'Code •••');
check('smart_station no code', taskPreviewLine(task({ type: 'smart_station' })) === 'No code set');
check('photo auto-approve', taskPreviewLine(task({ type: 'photo', smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true } })) === 'Auto approve');
check('photo staff review', taskPreviewLine(task({ type: 'photo' })) === 'Staff review');
check('quiz with choices', taskPreviewLine(task({ type: 'quiz', choices: ['a', 'b'], answers: ['a'] })) === '2 choices, 1 correct');
check('quiz typed answer', taskPreviewLine(task({ type: 'quiz', answers: ['x'] })) === 'Typed answer');
check('quiz empty', taskPreviewLine(task({ type: 'quiz' })) === 'No answer set');
check('numeric set', taskPreviewLine(task({ type: 'numeric', numericAnswer: 42, numericTolerance: 2 })) === 'Answer 42 ± 2');
check('numeric unset', taskPreviewLine(task({ type: 'numeric' })) === 'No answer set');
check('geofence custom radius', taskPreviewLine(task({ type: 'geofence', geofenceRadiusMeters: 30 })) === 'Auto check in within 30m');
check('geofence default radius', taskPreviewLine(task({ type: 'geofence' })) === 'Auto check in within 50m');
check('sequence plural', taskPreviewLine(task({ type: 'sequence', steps: [{ id: 's1', prompt: 'a' }, { id: 's2', prompt: 'b' }, { id: 's3', prompt: 'c' }] })) === '3 ordered steps');
check('sequence singular', taskPreviewLine(task({ type: 'sequence', steps: [{ id: 's1', prompt: 'a' }] })) === '1 ordered step');

// ── 2. Dynamic quiz mapping — add/remove/toggle + backward-compat round-trip ──
{
  const rows = choicesFromTask({ choices: ['Paris', 'London'], answers: ['paris'] });
  check('fromTask row count', rows.length === 2, String(rows.length));
  check('fromTask case-insensitive correct', rows[0].correct === true && rows[1].correct === false);

  const legacy = choicesFromTask({ answers: ['Paris'] });
  check('legacy typed answer becomes a correct row', legacy.length === 1 && legacy[0].correct && legacy[0].text === 'Paris');

  const added = addChoice(rows, 'new-id');
  check('addChoice appends blank', added.length === 3 && added[2].text === '' && added[2].id === 'new-id');

  const typed = setChoiceText(added, 'new-id', 'Rome');
  check('setChoiceText updates row', typed[2].text === 'Rome');

  const toggled = toggleCorrect(typed, typed[1].id);
  check('toggleCorrect flips one row', toggled[1].correct === true && toggled[0].correct === true);

  const removed = removeChoice(toggled, toggled[0].id);
  check('removeChoice drops one row', removed.length === 2 && !removed.some((r) => r.text === 'Paris'));

  // Blank rows are stripped from the persisted model; correct texts become answers.
  const withBlank = addChoice(choicesFromTask({ choices: ['A', 'B'], answers: ['A'] }));
  const model = choicesToTask(withBlank);
  check('toTask drops blanks', model.choices?.length === 2);
  check('toTask answers = correct texts', JSON.stringify(model.answers) === JSON.stringify(['A']));

  // Round-trip preserves choices + correctness (ids are regenerated, ignored).
  const rt = choicesFromTask(choicesToTask(rows));
  check('round-trip preserves text+correct',
    rt.map((r) => `${r.text}:${r.correct}`).join('|') === 'Paris:true|London:false',
    rt.map((r) => `${r.text}:${r.correct}`).join('|'));
}

// ── 3. Inspiration Mode — templates overwrite the draft with valid sample data ──
{
  const blank = task({ id: 'keep-me', title: '', type: 'quiz' });
  const quizSample = applySample(blank, TASK_SAMPLES.quiz[0]);
  check('quiz sample fills title', quizSample.title === 'History challenge');
  check('quiz sample fills choices', (quizSample.choices?.length ?? 0) === 4);
  check('quiz sample sets one answer', JSON.stringify(quizSample.answers) === JSON.stringify(['1541']));
  check('sample preserves draft id', quizSample.id === 'keep-me');

  const stationSample = applySample(task({ id: 'keep-me', type: 'smart_station' }), TASK_SAMPLES.smart_station[0]);
  check('station sample sets smart.secretCode', stationSample.smart?.secretCode === 'STAR24');
  check('station sample keeps smart.enabled', stationSample.smart?.enabled === true);

  // Every type ships at least one well-formed sample.
  const types = Object.keys(TASK_SAMPLES) as TaskType[];
  check('all 8 types have a sample', types.length === 8 && types.every((t) => TASK_SAMPLES[t].length >= 1), String(types.length));
  const wellFormed = types.every((t) => TASK_SAMPLES[t].every((s) => s.label.trim() !== '' && (s.patch.title ?? '').trim() !== ''));
  check('every sample has label + title', wellFormed);
}

// ── 4. Panel draft isolation — edits stay local until commit ──
{
  const s0 = initDraft(task({ title: 'Original' }));
  const s1 = editDraft(s0, { title: 'Edited' });
  check('editDraft updates draft', s1.draft.title === 'Edited');
  check('editDraft leaves committed untouched', s1.committed.title === 'Original');
  check('committed reference is stable across edits', s1.committed === s0.committed);
  check('isDirty true after edit', isDirty(s1) === true);

  const s2 = commit(s1);
  check('commit syncs committed', s2.committed.title === 'Edited');
  check('isDirty false after commit', isDirty(s2) === false);

  // Deep clone: mutating the post-commit draft cannot alias committed.
  s2.draft.title = 'MutatedInPlace';
  check('commit deep-clones (no aliasing)', s2.committed.title === 'Edited');
}

// ── TaskCard / PacingBar visual encodings: every task type must map to a family
//    colour + label, or a card/bar would render blank for that type. ──────────
{
  const TYPES = ['field', 'self_report', 'smart_station', 'photo', 'quiz', 'numeric', 'geofence', 'sequence'] as const;
  check('every task type has a family colour',
    TYPES.every((ty) => /^#[0-9A-Fa-f]{6}$/.test(TYPE_FAMILY_COLOR[ty])),
    TYPES.filter((ty) => !TYPE_FAMILY_COLOR[ty]).join(','));
  check('every task type has a label',
    TYPES.every((ty) => typeof TYPE_LABEL[ty] === 'string' && TYPE_LABEL[ty].length > 0));
}

// ── moveItem: native drag-drop stage reorder ────────────────────────────────
{
  check('moveItem forward', JSON.stringify(moveItem(['a', 'b', 'c', 'd'], 0, 2)) === JSON.stringify(['b', 'c', 'a', 'd']));
  check('moveItem backward', JSON.stringify(moveItem(['a', 'b', 'c', 'd'], 3, 1)) === JSON.stringify(['a', 'd', 'b', 'c']));
  const same = ['a', 'b', 'c'];
  check('moveItem same index is a no-op (same ref)', moveItem(same, 1, 1) === same);
  check('moveItem out-of-range is a no-op', moveItem(same, 0, 9) === same);
  check('moveItem does not mutate input', (() => { const a = ['a', 'b', 'c']; moveItem(a, 0, 2); return JSON.stringify(a) === JSON.stringify(['a', 'b', 'c']); })());
}

console.log(`\n${failures === 0 ? 'ALL BUILDER-REDESIGN TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
