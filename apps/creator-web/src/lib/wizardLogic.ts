// Pure navigation + metadata for the 3-step task wizard
// (change: v2.1-builder-shell-redesign; reordered by builder-first-task-flow).
// Extracted so the step-gating rules are unit-testable without rendering.
//
// Steps are ordered the way a creator thinks (change: builder-first-task-flow):
//   1 Details → 2 Interaction → 3 Placement.
// Naming is the first thing asked and the ONLY forward gate; placement is last
// and never blocks navigation. An unplaced task is reported by the readiness
// surface (lib/gameReadiness) instead, which also refuses the launch.
import type { Task, TaskType } from '@rushpoint/shared';
import { validateOrderItems } from '@rushpoint/shared';

// Step POSITIONS (1 based) — the wizard holds one of these as its current step.
export const WIZARD_STEPS = [1, 2, 3] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

// The declared step sequence. The tabs, the bodies and the labels all read this
// one array, so a tab and the body under it can never disagree.
export type WizardStepKey = 'details' | 'interaction' | 'placement';
export const WIZARD_STEP_ORDER: readonly WizardStepKey[] = ['details', 'interaction', 'placement'];

/** The key of the step at a 1 based position (clamped to the declared order). */
export function stepKeyAt(position: number): WizardStepKey {
  const i = Math.min(Math.max(Math.round(position), 1), WIZARD_STEP_ORDER.length);
  return WIZARD_STEP_ORDER[i - 1];
}

/** The 1 based position of a step key. */
export function stepIndexOf(key: WizardStepKey): number {
  return WIZARD_STEP_ORDER.indexOf(key) + 1;
}

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
    // task-duration-defaults: DELIBERATELY still 15, not the derived per-interaction
    // default. `estimatedMinutes` is compared against a span the server measures from
    // RunTaskRecord.startedAt, which is stamped at ASSIGNMENT (functions/src/runs/
    // index.ts:3022) — so it includes the WALK to the stop, not just the activity there.
    // Seeding it with an interaction-only number (a `field` check in derives 1 minute)
    // would make every team look 5x slow under smart_weighted. The derived default fills
    // `expectedDurationMinutes` instead, and the Builder surfaces it as a suggestion.
    estimatedMinutes: 15,
    pointValue: 100,
    maxConcurrentTeams: 3,
    tags: [],
  };
}

// Developer-facing fallback labels (the UI reads t.builder.step*).
export const STEP_LABELS: Record<WizardStepKey, string> = {
  details: 'Details',
  interaction: 'Interaction',
  placement: 'Placement',
};

// Placement has THREE states, not two (change: builder-first-task-flow):
//   notRequired — the trigger needs no coordinates at all
//   placed      — a real pin was dropped
//   unplaced    — a located task still sitting on the {0,0} sentinel blankTask
//                 ships. This is not an error while authoring; it is an
//                 unfinished step, disclosed calmly on the placement step and
//                 listed as a launch blocker on the readiness surface.
export type PlacementState = 'placed' | 'unplaced' | 'notRequired';

export function taskPlacementState(task: Task): PlacementState {
  if (task.locationless || task.triggerMode === 'locationless' || task.triggerMode === 'instant') return 'notRequired';
  return task.coordinates.lat !== 0 || task.coordinates.lng !== 0 ? 'placed' : 'unplaced';
}

// A located task needs a real pin; a locationless/instant task never does.
// ONE rule, expressed once: this is `taskPlacementState` read as a boolean.
export function isTaskLocationValid(task: Task): boolean {
  return taskPlacementState(task) !== 'unplaced';
}

// Naming is the wizard's ONLY forward gate. Interaction and placement never
// block: an unpinned or answer-key-less task is reported by the readiness
// surface, not by a disabled control (change: builder-first-task-flow).
export function canGoNext(step: WizardStepKey, task: Task): boolean {
  if (step === 'details') return task.title.trim() !== '';
  return true;
}

export function canGoBack(step: WizardStep): boolean {
  return step > 1;
}

// Interaction (step 3) config sanity: block finishing a task that can never be
// completed. Each rule mirrors the server-side check that would otherwise fail
// every participant attempt:
//   quiz    — matchesTaskAnswer needs ≥1 non-empty accepted answer
//   numeric — matchesTaskAnswer returns false when numericAnswer is null/NaN
//   station — verifyStationCode rejects everything when no secretCode is set
//   sequence — submitSequenceStep throws failed-precondition on empty steps
// Other types self-validate or have safe defaults.
export function isTaskInteractionValid(task: Task): boolean {
  if (task.type === 'quiz') {
    // Ordering variant (change: quiz-ordering): valid orderItems replace answers.
    if (task.orderItems && task.orderItems.length > 0) {
      return validateOrderItems(task.orderItems) === null;
    }
    return !!task.answers && task.answers.some((a) => a.trim() !== '');
  }
  if (task.type === 'numeric') {
    return task.numericAnswer != null && Number.isFinite(task.numericAnswer);
  }
  if (task.type === 'smart_station') {
    return !!task.smart?.secretCode?.trim();
  }
  if (task.type === 'sequence') {
    return !!task.steps && task.steps.length > 0;
  }
  // survey (change: survey-tasks): no right answer — a free-text survey (no
  // choices) or a valid choice list both complete. The editor pushes only a
  // valid 2–8 choice list (else undefined ⇒ free-text), so a survey is always
  // completable.
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
  survey:        { emoji: '🗳️', label: 'Survey',     description: 'Ask a question with no right answer.' },
};

// Order the picker grid presents types (most common first).
export const TYPE_PICKER_ORDER: TaskType[] = [
  'smart_station', 'photo', 'quiz', 'numeric', 'field', 'self_report', 'geofence', 'sequence', 'survey',
];
