// Pure navigation + metadata for the 3-step task wizard
// (change: v2.1-builder-shell-redesign; reordered again by
// task-editor-progressive-disclosure).
// Extracted so the step-gating rules are unit-testable without rendering.
//
// Steps (change: task-editor-progressive-disclosure):
//   1 Location → 2 Details & type → 3 Execution & enhancements.
//
// Location leads because it owns the interactive map, which needs the whole panel
// rather than a share of a scroll; it asks one question with two answers and never
// blocks. Naming remains the ONLY forward gate, so it now guards the 2 → 3
// transition instead of 1 → 2. An unplaced task is still reported by the readiness
// surface (lib/gameReadiness), which also refuses the launch.
import type { Game, Task, TaskType } from '@rushpoint/shared';
import { validateOrderItems, defaultEstimatedMinutes } from '@rushpoint/shared';

// Step POSITIONS (1 based) — the wizard holds one of these as its current step.
export const WIZARD_STEPS = [1, 2, 3] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

// The declared step sequence. The tabs, the bodies and the labels all read this
// one array, so a tab and the body under it can never disagree.
export type WizardStepKey = 'location' | 'details' | 'execution';
export const WIZARD_STEP_ORDER: readonly WizardStepKey[] = ['location', 'details', 'execution'];

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
  const base = {
    id,
    title: '',
    type: 'field' as TaskType,
    coordinates: { lat: 0, lng: 0 },
    difficulty: 5,
    pointValue: 100,
    // 1, not 3: nobody has said this mission has room for more than one team
    // at a time yet, and 1 is the safe assumption until the creator says
    // otherwise. Mirrors TASK_FIELD_DEFAULTS (lib/taskOptInGroups.ts) — the two
    // must never disagree (see that file's header for what happens when they do).
    maxConcurrentTeams: 1,
    tags: [] as string[],
  };
  return {
    ...base,
    // visible-time-estimates: the derived WALK INCLUSIVE estimate, no longer a flat 15.
    // `estimatedMinutes` is compared against a span the server measures from
    // RunTaskRecord.startedAt, which is stamped at ASSIGNMENT (functions/src/runs/
    // index.ts:3059) — so it includes the WALK to the stop, not just the activity there.
    // That is why the interaction only default fills `expectedDurationMinutes` instead,
    // and why this field gets `defaultExpectedDurationMinutes` PLUS a transit allowance.
    // A brand new task has no stage context yet, so it is derived with no siblings: the
    // unknown leg constant. The editor recomputes and offers the real number once the
    // task has a type and a pin. Seeding a task that has never existed cannot move any
    // stored game, any run in flight, or any finalised run.
    estimatedMinutes: defaultEstimatedMinutes({ ...base, estimatedMinutes: 0 } as Task, []),
  };
}

// Developer-facing fallback labels (the UI reads t.builder.step*).
export const STEP_LABELS: Record<WizardStepKey, string> = {
  location: 'Location',
  details: 'Details & type',
  execution: 'Execution & extras',
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

// Naming is the wizard's ONLY forward gate. It lives on the DETAILS step, which
// is now step 2, so the gate guards 2 → 3 (change:
// task-editor-progressive-disclosure). Location and execution never block: an
// unpinned or answer-key-less task is reported by the readiness surface, not by a
// disabled control (change: builder-first-task-flow).
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

// ─────────────────────────────────────────────────────────────────────────────
// First-task auto-open (change: builder-first-task-flow)
// ─────────────────────────────────────────────────────────────────────────────
// When a creator opens a BRAND-NEW blank game we drop them straight into naming
// their first task, instead of leaving them to discover and click the seeded
// "Untitled task" card. The whole risk is firing on a game the creator is
// RETURNING to edit, so the "untouched blank" test is narrow and pure: it must
// structurally match a single freshly seeded `blankTask` the creator has not yet
// touched. Any edit — a typed title, a dropped pin, a second task, a second
// stage — makes it return null and the Builder opens at rest as before.
export function shouldAutoOpenFirstTask(game: Game): { stageId: string; taskId: string } | null {
  // Exactly one stage …
  if (game.stages.length !== 1) return null;
  const stage = game.stages[0];
  // … holding exactly one task …
  if (stage.tasks.length !== 1) return null;
  const task = stage.tasks[0];
  // … that is still the untouched seed: no name and no pin. `blankTask` seeds an
  // empty title and the {0,0} null-island placeholder, so a non-empty (trimmed)
  // title or any real coordinate means the creator has already started editing.
  if (task.title.trim() !== '') return null;
  if (task.coordinates.lat !== 0 || task.coordinates.lng !== 0) return null;
  return { stageId: stage.id, taskId: task.id };
}
