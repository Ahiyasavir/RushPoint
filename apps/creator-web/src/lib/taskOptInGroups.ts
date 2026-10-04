// The mission editor's step 3 disclosure state (change: mission-editor-value-rows; before it,
// task-editor-progressive-disclosure and builder-nondestructive-disclosure).
//
// Step 3's optional settings are ROWS now (lib/missionSettingsRows.ts): scoring, hint, opens,
// timeLimit, more. Each shows its value on the row, so nothing authored can hide behind a closed one;
// that is what the old chips' count badge tried and failed to do. This file owns only which row is
// open, and the field defaults the three task seeders must agree on.
//
// ─── The rules that must never break ─────────────────────────────────────────
// 1. EVERY row opens CLOSED. Opening is never coupled to content: when it was, a template-derived
//    game (whose seeder disagreed with blankTask about capacity) unfolded three or four sections on
//    every task the creator opened.
// 2. AT MOST ONE row is open (`openOnly`), which is what bounds step 3's height.
// 3. Opening or closing a row writes NOTHING to the task (`foldGroupAway` returns the task by the same
//    reference). Only choosing an answer inside a row writes.
//
// "Is this field authored?" still compares against the DEFAULT, not against undefined
// (lib/missionSettingsRows.ts), which is why TASK_FIELD_DEFAULTS stays here and stays in step with
// `blankTask()` and the gallery copy. Unit-tested by scripts/test-task-opt-in-groups.ts.
import type { Task } from '@rushpoint/shared';
import { SETTINGS_ROW_KEYS, type SettingsRowKey } from './missionSettingsRows';

export const OPT_IN_GROUP_KEYS = SETTINGS_ROW_KEYS;
export type OptInGroupKey = SettingsRowKey;

/**
 * The values `blankTask()` seeds. A field still equal to its default was never decided by the
 * creator. Kept in one place so the seeders and the authored-test can't disagree.
 */
export const TASK_FIELD_DEFAULTS = {
  difficulty: 5,
  pointValue: 100,
  // 1, not 3: a freshly-added task declares no station contention of its own, and 1 is the SAFE
  // assumption (a mission nobody thought about capacity for is more likely a one-at-a-time stop).
  // Mirrors `blankTask()` (lib/wizardLogic.ts) and the gallery copy (lib/libraryTask.ts).
  maxConcurrentTeams: 1,
} as const;

/** The editor's per-row open/closed map. */
export type ActiveGroups = Record<OptInGroupKey, boolean>;

/**
 * Which rows are open when the editor opens: NONE, always (rule 1). The `task` parameter is kept and
 * deliberately unused, so re-coupling opening to content would be a visible edit here.
 */
export function defaultActiveGroups(_task: Task): ActiveGroups {
  return OPT_IN_GROUP_KEYS.reduce((acc, k) => {
    acc[k] = false;
    return acc;
  }, {} as ActiveGroups);
}

/** Open this row and close every other one; if it is already open, close it (rule 2). */
export function openOnly(active: ActiveGroups, key: OptInGroupKey): ActiveGroups {
  const next = OPT_IN_GROUP_KEYS.reduce((acc, k) => { acc[k] = false; return acc; }, {} as ActiveGroups);
  next[key] = !active[key];
  return next;
}

/**
 * Close a row: a DISPLAY decision and nothing else (rule 3). Returns the task BY THE SAME REFERENCE,
 * so "closing never edits the task" is provable by identity.
 */
export function foldGroupAway(
  task: Task,
  active: ActiveGroups,
  key: OptInGroupKey,
): { task: Task; active: ActiveGroups } {
  return { task, active: { ...active, [key]: false } };
}
