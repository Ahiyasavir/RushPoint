// Pure mapping between the new dynamic Quiz editor UI (a list of isolated choice
// rows, each independently editable and flaggable as correct) and the existing
// server-secret `Task.choices` / `Task.answers` string arrays.
//
// Backward-compatibility contract (change: v2.1-builder-shell-redesign):
//   • The on-disk schema is unchanged — we still persist `choices: string[]`
//     (the rendered buttons) and `answers: string[]` (accepted correct values,
//     matched trimmed + case-insensitive by the participant runtime).
//   • A legacy "typed answer" quiz (answers present, no choices) round-trips:
//     its answers seed correct rows so no data is lost when it is reopened.
//
// Everything here is pure + DOM-free so it runs in the scripts/test-*.ts lane.
import type { Task } from '@rushpoint/shared';

export interface QuizChoice {
  id: string;
  text: string;
  correct: boolean;
}

const uid = (): string =>
  crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

// Comparison key matching the runtime's answer check (trim + case-insensitive).
const norm = (s: string): string => s.trim().toLowerCase();

export function newChoice(text = '', correct = false, id: string = uid()): QuizChoice {
  return { id, text, correct };
}

// Build editor rows from a task. Choices become rows; a row is `correct` when its
// text appears in `answers`. Any answer NOT represented by a choice (legacy typed
// answer) is appended as its own correct row so reopening never drops data.
export function choicesFromTask(task: Pick<Task, 'choices' | 'answers'>): QuizChoice[] {
  const choices = task.choices ?? [];
  const answers = task.answers ?? [];
  const answerSet = new Set(answers.map(norm));
  const rows: QuizChoice[] = choices.map((c) => newChoice(c, answerSet.has(norm(c))));

  const choiceSet = new Set(choices.map(norm));
  for (const a of answers) {
    if (!choiceSet.has(norm(a))) rows.push(newChoice(a, true));
  }
  return rows;
}

// Collapse editor rows back to the persisted arrays. Blank rows are dropped from
// the model (they may still exist in the editor's local UI state while typing).
export function choicesToTask(rows: QuizChoice[]): Pick<Task, 'choices' | 'answers'> {
  const cleaned = rows
    .map((r) => ({ ...r, text: r.text.trim() }))
    .filter((r) => r.text !== '');
  return {
    choices: cleaned.map((r) => r.text),
    answers: cleaned.filter((r) => r.correct).map((r) => r.text),
  };
}

export function addChoice(rows: QuizChoice[], id?: string): QuizChoice[] {
  return [...rows, newChoice('', false, id ?? uid())];
}

export function removeChoice(rows: QuizChoice[], id: string): QuizChoice[] {
  return rows.filter((r) => r.id !== id);
}

export function setChoiceText(rows: QuizChoice[], id: string, text: string): QuizChoice[] {
  return rows.map((r) => (r.id === id ? { ...r, text } : r));
}

// Toggle (checkbox semantics — a quiz may accept multiple correct answers).
export function toggleCorrect(rows: QuizChoice[], id: string): QuizChoice[] {
  return rows.map((r) => (r.id === id ? { ...r, correct: !r.correct } : r));
}

// Single-correct (radio semantics) for callers that want exactly one answer.
export function setOnlyCorrect(rows: QuizChoice[], id: string): QuizChoice[] {
  return rows.map((r) => ({ ...r, correct: r.id === id }));
}
