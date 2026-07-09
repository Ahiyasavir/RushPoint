// State-isolation contract for the slide-in context panel
// (change: v2.1-builder-shell-redesign).
//
// The panel edits a LOCAL `draft` copy of the task. The central canvas + the
// global game state read `committed`. Edits mutate `draft` only; `committed` (and
// therefore the canvas / the debounced server flush) does not change until an
// explicit commit() — i.e. the 1500ms debounce fires or the creator clicks Done.
// Modelling this as a pure reducer lets the isolation invariant be unit-tested in
// the scripts/test-*.ts lane without rendering React.
import type { Task } from '@rushpoint/shared';

export interface DraftState {
  committed: Task; // what the canvas / game state currently shows
  draft: Task;     // the panel's in-progress local copy
}

const clone = (t: Task): Task =>
  typeof structuredClone === 'function'
    ? structuredClone(t)
    : (JSON.parse(JSON.stringify(t)) as Task);

const serialize = (t: Task): string => JSON.stringify(t);

// Open the panel on a task: draft and committed start equal (deep copies, so
// mutating one can never alias the other).
export function initDraft(task: Task): DraftState {
  return { committed: clone(task), draft: clone(task) };
}

// Edit the local draft. `committed` is returned untouched (same reference) — this
// is the heart of the isolation guarantee.
export function editDraft(state: DraftState, patch: Partial<Task>): DraftState {
  return { committed: state.committed, draft: { ...state.draft, ...patch } };
}

// True when the draft has diverged from what the canvas shows.
export function isDirty(state: DraftState): boolean {
  return serialize(state.draft) !== serialize(state.committed);
}

// Flush the draft into committed (debounce fired or Done pressed). After this the
// canvas / game flush should observe the new value.
export function commit(state: DraftState): DraftState {
  return { committed: clone(state.draft), draft: clone(state.draft) };
}
