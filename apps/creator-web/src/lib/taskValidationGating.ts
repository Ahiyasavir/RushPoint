// Reveal gating for the task editor (change: builder-first-task-flow).
//
// The Builder used to greet a brand new task with its own errors: a fresh quiz
// reported "no correct answer" against the two empty rows the editor had just
// seeded, a fresh ordering quiz reported a bad item count against its own
// padding, and every new quiz/numeric/station/sequence task reported "this task
// cannot be completed" before a single keystroke. A validation message must be a
// response to something the creator DID, never a greeting.
//
// The model is deliberately tiny so it can be tested exhaustively:
//   • a monotonic set of TOUCHED field groups (one member per renderable
//     message, so `shouldReveal` is total by construction and a new message
//     without a reveal rule is a typecheck failure), plus
//   • one `revealAll` flag, set when the creator pressed the finish control or
//     arrived by clicking the problem on the readiness surface.
//
// Granularity is the field GROUP, not the input: "no choice is marked correct"
// is a property of the choice list, not of choice #2. Touching is monotonic:
// once a creator has engaged with a group, telling them it is empty is help, not
// scolding, so clearing the field keeps the message visible.
import type { Task } from '@rushpoint/shared';
import { isTaskInteractionValid } from './wizardLogic';

export type ValidationField =
  | 'title' | 'quizChoices' | 'quizOrdering' | 'numericAnswer'
  | 'stationCode' | 'sequenceSteps' | 'surveyChoices' | 'placement';

// Every member of the union, for totality tests and for revealAll.
export const VALIDATION_FIELDS: readonly ValidationField[] = [
  'title', 'quizChoices', 'quizOrdering', 'numericAnswer',
  'stationCode', 'sequenceSteps', 'surveyChoices', 'placement',
];

export interface RevealState {
  touched: ReadonlySet<ValidationField>;
  revealAll: boolean;
}

/**
 * A fresh reveal state. `revealAll` is set ONLY when the editor was opened by
 * following a readiness entry that names this task: the creator arrived by
 * clicking the statement of the problem and would otherwise land on a silent
 * form. The state lives in the editor and resets when it re-opens, because the
 * persistent, game wide record of what is broken is the readiness surface.
 */
export function initialRevealState(opts?: { revealAll?: boolean }): RevealState {
  return { touched: new Set<ValidationField>(), revealAll: !!opts?.revealAll };
}

/** Monotonic: returns the SAME state when the group was already touched. */
export function markTouched(state: RevealState, field: ValidationField): RevealState {
  if (state.touched.has(field)) return state;
  const touched = new Set(state.touched);
  touched.add(field);
  return { ...state, touched };
}

export function shouldReveal(state: RevealState, field: ValidationField): boolean {
  return state.revealAll || state.touched.has(field);
}

/**
 * What the ALWAYS ENABLED finish control does next. The first press with an
 * unrevealed blocker reveals every blocker and keeps the editor open; the next
 * press closes it. Never a trap (the second press always works), never an error
 * on open, and never a way to ship a broken task, because the readiness surface
 * still refuses the launch.
 */
export function nextFinishAction(state: RevealState, blockers: readonly ValidationField[]): 'reveal' | 'close' {
  return blockers.some((f) => !shouldReveal(state, f)) ? 'reveal' : 'close';
}

/**
 * The reveal-gated messages this task would show, i.e. the groups whose message
 * the finish control has to make visible before it may close.
 *
 * Two deliberate exclusions:
 *  • `placement` — the "not placed yet" state is disclosed unconditionally on
 *    the placement step, so there is nothing to reveal; the readiness surface
 *    keeps refusing the launch.
 *  • `title` — the naming gate states its reason beside the field at all times
 *    (it is a hint next to a disabled Next, not an error), and an untitled task
 *    has never blocked a launch.
 *
 * An unfinished quiz names BOTH quiz groups: which editor is mounted (classic
 * choices or ordering) is local editor state, and only the mounted one renders
 * its message, so revealing both is exact rather than approximate.
 */
export function taskRevealBlockers(task: Task): ValidationField[] {
  if (isTaskInteractionValid(task)) return [];
  switch (task.type) {
    case 'quiz': return ['quizChoices', 'quizOrdering'];
    case 'numeric': return ['numericAnswer'];
    case 'smart_station': return ['stationCode'];
    case 'sequence': return ['sequenceSteps'];
    default: return [];
  }
}
