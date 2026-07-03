// Pure navigation + metadata for the 3-step task wizard
// (change: v2.1-builder-shell-redesign). Extracted so the step-gating rules are
// unit-testable without rendering. Steps are ordered by decision priority:
//   1 Location → 2 Details → 3 Interaction.
import type { Task, TaskType } from '@rushpoint/shared';

export const WIZARD_STEPS = [1, 2, 3] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

const genId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// A fresh task the wizard starts from: a located check-in with no pin yet
// (coordinates 0,0), no title, sensible scoring defaults. NOT locationless —
// the creator places a pin or switches it to a locationless/instant trigger.
export function blankTask(id: string = genId()): Task {
  return {
    id,
    title: '',
    type: 'field',
    coordinates: { lat: 0, lng: 0 },
    difficulty: 5,
    estimatedMinutes: 15,
    pointValue: 100,
    maxConcurrentTeams: 3,
    tags: [],
  };
}

export const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Location',
  2: 'Details',
  3: 'Interaction',
};

// A located task needs a real pin; a locationless/instant task never does.
export function isTaskLocationValid(task: Task): boolean {
  if (task.locationless || task.triggerMode === 'locationless' || task.triggerMode === 'instant') return true;
  return task.coordinates.lat !== 0 || task.coordinates.lng !== 0;
}

// Step 1 is always passable (a sensible default location/mode is pre-seeded).
// Step 2 blocks forward until the task has a title. Step 3 is terminal.
export function canGoNext(step: WizardStep, task: Task): boolean {
  if (step === 1) return true;
  if (step === 2) return task.title.trim() !== '';
  return false;
}

export function canGoBack(step: WizardStep): boolean {
  return step > 1;
}

// Interaction (step 3) config sanity: block finishing a task that can never be
// completed. A quiz with no non-empty accepted answer is unwinnable — the
// participant's answer is checked against `answers`, so an empty list always
// fails. Other types self-validate or have safe defaults.
export function isTaskInteractionValid(task: Task): boolean {
  if (task.type === 'quiz') {
    return !!task.answers && task.answers.some((a) => a.trim() !== '');
  }
  return true;
}

export interface TaskTypeMeta {
  emoji: string;
  label: string;
  description: string;
}

// Friendly, plain-English card content for the visual type picker in step 3.
export const TASK_TYPE_META: Record<TaskType, TaskTypeMeta> = {
  smart_station: { emoji: '🔑', label: 'Station',    description: 'Players find and enter a secret code on site.' },
  photo:         { emoji: '📸', label: 'Photo',      description: 'Teams submit a photo, auto or staff approved.' },
  quiz:          { emoji: '❓', label: 'Quiz',       description: 'Multiple choice or a typed answer.' },
  numeric:       { emoji: '🔢', label: 'Numeric',    description: 'Submit a number within a tolerance.' },
  field:         { emoji: '✅', label: 'Check in',   description: 'Tap to confirm arrival at the spot.' },
  self_report:   { emoji: '🙋', label: 'Self report', description: 'Finish a challenge and rate yourselves.' },
  geofence:      { emoji: '📡', label: 'Geofence',   description: 'Auto check in by GPS within a radius.' },
  sequence:      { emoji: '📋', label: 'Sequence',   description: 'Several ordered steps at one stop.' },
};

// Order the picker grid presents types (most common first).
export const TYPE_PICKER_ORDER: TaskType[] = [
  'smart_station', 'photo', 'quiz', 'numeric', 'field', 'self_report', 'geofence', 'sequence',
];
