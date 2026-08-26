// The mission-authoring shorthands, shared by every place that seeds content
// (change: smart-game-composer).
//
// These lived inside templates.ts as module-private helpers. They moved here the
// moment a SECOND authoring source appeared — taskBank.ts — because the only two
// alternatives were worse:
//
//   • duplicating them into the bank, which lets the two drift (a default bumped
//     in one file and not the other is invisible until a creator sees two
//     different point values for the same kind of mission), or
//   • exporting them from a 500-line data file, which makes a data file a utility
//     module by accident.
//
// Nothing here is new: every body below is the byte-for-byte original from
// templates.ts. The behaviour-preservation guard for the move is the existing
// src/lib/__tests__/templatesValid.test.ts, which builds every template and runs
// the same structural validators the server applies on save.
import type { Stage, Task } from '@rushpoint/shared';

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// All seeded tasks play from anywhere: no map pin, no GPS gate, zero transit in
// routing. Null-island coordinates are the "not placed" sentinel.
export function task(over: Partial<Task>): Task {
  return {
    id: uuid(), title: '', type: 'field', coordinates: { lat: 0, lng: 0 },
    locationless: true, triggerMode: 'locationless',
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 5, ...over,
  };
}

export function stage(title: string, tasks: Task[], over: Partial<Stage> = {}): Stage {
  // requiredTaskCount defaults to 1 (change: adaptive-difficulty-routing) — same
  // authoring default as the Builder's blankStage: a multi-task level means "do the
  // best-suited ONE" unless the template says otherwise via `over`.
  return { id: uuid(), order: 0, title, requiredTaskCount: 1, tasks, ...over };
}

// Shorthands for common task kinds (keeps the templates readable). Each takes an
// optional `over` so a template can bump difficulty / points or attach a hint.
export const photo = (title: string, description: string, over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'photo', smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true }, ...over });

export const quiz = (title: string, description: string, answers: string[], choices?: string[], over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'quiz', answers, choices, ...over });

export const numeric = (title: string, description: string, numericAnswer: number, over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'numeric', numericAnswer, numericTolerance: 0, ...over });

export const selfReport = (title: string, description: string, over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'self_report', ...over });

export const survey = (title: string, description: string, surveyChoices: string[], over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'survey', surveyChoices, pointValue: 60, ...over });

export const sequence = (title: string, description: string, steps: NonNullable<Task['steps']>, over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'sequence', steps, ...over });
