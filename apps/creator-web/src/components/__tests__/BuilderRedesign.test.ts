// Vitest suite for the v2.1 Builder shell redesign (change:
// v2.1-builder-shell-redesign). Covers the four invariants that protect the
// refactor — all at the pure-logic layer (the redesign's correctness lives in
// these reducers, so they can be proven without rendering React):
//   1. taskPreviewLine() output logic (scannable card second line)
//   2. dynamic Quiz row <-> choices/answers array mapping (schema unchanged)
//   3. Inspiration-Mode template loading accuracy
//   4. context-panel state isolation: editing the draft never touches `committed`
//      (the mechanism that guarantees keystrokes don't re-render the canvas /
//      hit the server until the debounce/Done flush commits)
import { describe, it, expect } from 'vitest';
import type { Task } from '@rushpoint/shared';
import { taskPreviewLine } from '../../lib/taskCardPreview';
import { choicesFromTask, choicesToTask, addChoice, setChoiceText, toggleCorrect } from '../../lib/quizFields';
import { TASK_SAMPLES, applySample } from '../../lib/taskTemplates';
import { initDraft, editDraft, isDirty, commit } from '../../lib/taskDraft';

function task(p: Partial<Task> = {}): Task {
  return {
    id: 't1', title: '', type: 'field', coordinates: { lat: 0, lng: 0 },
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 3, tags: [],
    ...p,
  };
}

describe('taskPreviewLine — scannable card second line', () => {
  it('summarises a quiz by choice + correct counts', () => {
    expect(taskPreviewLine(task({ type: 'quiz', choices: ['a', 'b', 'c'], answers: ['a'] }))).toBe('3 choices, 1 correct');
  });
  it('reports a typed-answer quiz', () => {
    expect(taskPreviewLine(task({ type: 'quiz', answers: ['Paris'] }))).toBe('Typed answer');
  });
  it('masks a station secret code', () => {
    expect(taskPreviewLine(task({ type: 'smart_station', smart: { enabled: true, verificationType: 'code_verification', secretCode: 'STAR24' } }))).toBe('Code ••••••');
  });
  it('reports numeric answer + tolerance', () => {
    expect(taskPreviewLine(task({ type: 'numeric', numericAnswer: 42, numericTolerance: 2 }))).toBe('Answer 42 ± 2');
  });
  it('reports geofence radius and sequence step count', () => {
    expect(taskPreviewLine(task({ type: 'geofence', geofenceRadiusMeters: 30 }))).toBe('Auto check in within 30m');
    expect(taskPreviewLine(task({ type: 'sequence', steps: [{ id: 's1', prompt: 'p' }] }))).toBe('1 ordered step');
  });
});

describe('dynamic Quiz row <-> array mapping (schema unchanged)', () => {
  it('round-trips choices and answers', () => {
    const rows = choicesFromTask({ choices: ['Paris', 'London'], answers: ['Paris'] });
    expect(rows.map((r) => r.text)).toEqual(['Paris', 'London']);
    expect(rows.find((r) => r.text === 'Paris')?.correct).toBe(true);
    expect(choicesToTask(rows)).toEqual({ choices: ['Paris', 'London'], answers: ['Paris'] });
  });
  it('seeds a legacy typed-answer quiz as a correct row', () => {
    const rows = choicesFromTask({ answers: ['1541'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: '1541', correct: true });
  });
  it('add + edit + toggle maps back to arrays, dropping blanks', () => {
    let rows = choicesFromTask({ choices: ['A'], answers: [] });
    rows = addChoice(rows, 'r2');
    rows = setChoiceText(rows, 'r2', 'B');
    rows = toggleCorrect(rows, 'r2');
    rows = addChoice(rows, 'blank'); // left empty -> dropped
    const out = choicesToTask(rows);
    expect(out.choices).toEqual(['A', 'B']);
    expect(out.answers).toEqual(['B']);
  });
});

describe('Inspiration-Mode template loading', () => {
  it('every task type ships at least one sample', () => {
    for (const type of Object.keys(TASK_SAMPLES) as (keyof typeof TASK_SAMPLES)[]) {
      expect(TASK_SAMPLES[type].length).toBeGreaterThan(0);
    }
  });
  it('applySample fills the draft but preserves identity + coordinates', () => {
    const draft = task({ id: 'keep-me', type: 'quiz', coordinates: { lat: 31.7, lng: 35.2 } });
    const sample = TASK_SAMPLES.quiz[0];
    const next = applySample(draft, sample);
    expect(next.id).toBe('keep-me');
    expect(next.coordinates).toEqual({ lat: 31.7, lng: 35.2 });
    expect(next.title).toBe(sample.patch.title);
    expect(next.choices).toEqual(sample.patch.choices);
  });
  it('merges smart config rather than replacing it', () => {
    const draft = task({ type: 'smart_station', smart: { enabled: true, verificationType: 'code_verification', longInstructions: 'keep' } });
    const next = applySample(draft, TASK_SAMPLES.smart_station[0]);
    expect(next.smart?.longInstructions).toBe('keep');
    expect(next.smart?.secretCode).toBe('STAR24');
  });
});

describe('context-panel state isolation (keystrokes do not reach the canvas)', () => {
  it('editing the draft leaves committed untouched (same reference)', () => {
    const s0 = initDraft(task({ title: 'Original' }));
    const s1 = editDraft(s0, { title: 'Typed once' });
    const s2 = editDraft(s1, { title: 'Typed twice' });
    // The canvas/global state reads `committed` — it must be byte-identical AND
    // the same reference across every keystroke until an explicit commit.
    expect(s2.committed).toBe(s0.committed);
    expect(s2.committed.title).toBe('Original');
    expect(s2.draft.title).toBe('Typed twice');
    expect(isDirty(s2)).toBe(true);
  });
  it('commit flushes the draft into committed and clears dirty', () => {
    const flushed = commit(editDraft(initDraft(task({ title: 'A' })), { title: 'B' }));
    expect(flushed.committed.title).toBe('B');
    expect(isDirty(flushed)).toBe(false);
  });
  it('a committed draft cannot alias (deep clone)', () => {
    const flushed = commit(editDraft(initDraft(task()), { title: 'X' }));
    flushed.draft.title = 'mutated';
    expect(flushed.committed.title).toBe('X');
  });
});
