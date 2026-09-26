// The Builder's "several codes" (station) and "points by answer" (quiz) edits
// (change: answer-scored-question, D5). Pure: task in, task out.
//
// Switching modes carries the creator's work across instead of dropping it: the station's one
// code becomes the first row (worth the mission's points), and switching back restores it. The
// field that stops applying is removed as a KEY, never set to null or '': the callable transport
// turns undefined into null, and a null that a server guard does not expect bricks autosave
// (CLAUDE.md, the cleared-optional-field trap).

import { MAX_ANSWER_OUTCOMES, MIN_ANSWER_OUTCOMES, type AnswerOutcome, type Task } from '@rushpoint/shared';

const whole = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

function withoutKeys<T extends object>(obj: T, keys: string[]): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of keys) delete out[k];
  return out as T;
}

function nextId(outcomes: AnswerOutcome[]): string {
  const max = outcomes.reduce((m, o) => Math.max(m, Number(/^o(\d+)$/.exec(o.id)?.[1] ?? 0)), 0);
  return `o${max + 1}`;
}

const row = (id: string, text: string, points: number): AnswerOutcome => ({ id, label: text, accepts: [text], points });

export function enableOutcomes(task: Task): Task {
  if (Array.isArray(task.answerOutcomes) && task.answerOutcomes.length >= MIN_ANSWER_OUTCOMES) return task;
  const points = whole(task.pointValue);
  if (task.type === 'smart_station') {
    const code = task.smart?.secretCode?.trim() ?? '';
    const smart = task.smart ? withoutKeys(task.smart, ['secretCode', 'hasCode']) : task.smart;
    return { ...task, smart, answerOutcomes: [row('o1', code, points), row('o2', '', 0)] } as Task;
  }
  const answers = (task.answers ?? []).map((a) => a.trim()).filter(Boolean);
  const first = answers[0] ?? '';
  const rest = withoutKeys(task, ['answers']);
  return {
    ...rest,
    answerOutcomes: [
      { id: 'o1', label: first, accepts: answers.length ? answers : [''], points },
      row('o2', '', 0),
    ],
  } as Task;
}

export function disableOutcomes(task: Task): Task {
  const outcomes = task.answerOutcomes ?? [];
  const texts = outcomes.flatMap((o) => (o.accepts?.length ? o.accepts : o.label ? [o.label] : []))
    .map((s) => s.trim()).filter(Boolean);
  const base = withoutKeys(task, ['answerOutcomes', 'unmatchedPoints', 'revealOutcomePoints']);
  if (task.type === 'smart_station') {
    return { ...base, smart: { ...(task.smart ?? { enabled: true, verificationType: 'code_verification' }), secretCode: texts[0] ?? '', hasCode: !!texts[0] } } as Task;
  }
  return { ...base, answers: texts } as Task;
}

export function setOutcome(task: Task, index: number, patch: { text?: string; points?: number; message?: string }): Task {
  const outcomes = (task.answerOutcomes ?? []).map((o, i) => {
    if (i !== index) return o;
    const next: AnswerOutcome = { ...o };
    if (patch.text !== undefined) { next.label = patch.text; next.accepts = [patch.text]; }
    if (patch.points !== undefined) next.points = whole(patch.points);
    if (patch.message !== undefined) {
      if (patch.message.trim()) next.message = patch.message; else delete next.message;
    }
    return next;
  });
  return { ...task, answerOutcomes: outcomes };
}

export function addOutcome(task: Task): Task {
  const outcomes = task.answerOutcomes ?? [];
  if (outcomes.length >= MAX_ANSWER_OUTCOMES) return task;
  return { ...task, answerOutcomes: [...outcomes, row(nextId(outcomes), '', 0)] };
}

export function removeOutcome(task: Task, index: number): Task {
  const outcomes = task.answerOutcomes ?? [];
  if (outcomes.length <= MIN_ANSWER_OUTCOMES) return task;
  return { ...task, answerOutcomes: outcomes.filter((_, i) => i !== index) };
}
