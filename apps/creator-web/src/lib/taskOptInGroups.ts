// The task editor's modular "opt-in" field groups
// (change: task-editor-progressive-disclosure).
//
// The editor shows the core fields plus a row of CHIPS — + Add hint,
// + Set timer / points, + Attach media, + Prerequisites / rules. Clicking a chip
// mounts just that group; a Remove control clears it and puts the chip back.
// This replaces the five always-listed collapsible sections, which presented the
// whole product's surface on every task however simple.
//
// ─── The rule that must never break ──────────────────────────────────────────
// A group that ALREADY HAS DATA renders EXPANDED, never behind a chip. A creator
// editing an existing task must never have to guess which chip is hiding their
// hint. `groupHasContent` is therefore a data-visibility guarantee, and
// `defaultActiveGroups` is defined in terms of it so the two can't drift.
//
// That is also why "is this field authored?" compares against the DEFAULT for the
// fields a `blankTask()` ships (difficulty, points, station capacity) rather than
// against undefined: every task carries those, so an undefined-test would report
// every group as authored, open all four on load, and the chips would never
// appear at all — the redesign would silently undo itself.
//
// Unit-tested by scripts/test-task-opt-in-groups.ts (in `npm test`).
import type { Task } from '@rushpoint/shared';
import { defaultExpectedDurationMinutes } from '@rushpoint/shared';

export const OPT_IN_GROUP_KEYS = ['hint', 'timerPoints', 'media', 'rules'] as const;
export type OptInGroupKey = (typeof OPT_IN_GROUP_KEYS)[number];

/**
 * The values `blankTask()` seeds. A field still equal to its default was never
 * decided by the creator, so it is not "content" — see the note above.
 * Kept in one place so the reset path and the authored-test can't disagree.
 */
export const TASK_FIELD_DEFAULTS = {
  difficulty: 5,
  pointValue: 100,
  maxConcurrentTeams: 3,
} as const;

const filled = (s: string | undefined | null): boolean => typeof s === 'string' && s.trim() !== '';
const positive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Does this group already hold something the creator authored?
 *
 * `estimatedMinutes` is deliberately absent: it is DERIVED and seeded on every
 * task (wizardLogic.blankTask), so treating it as authorship would open the timer
 * group for every task ever made.
 */
export function groupHasContent(key: OptInGroupKey, task: Task): boolean {
  switch (key) {
    case 'hint':
      return filled(task.hint);
    case 'media':
      return (task.media?.length ?? 0) > 0;
    case 'timerPoints':
      return !!task.pausesTimer
        || positive(task.expiresAfterMinutes)
        // Compared against the TYPE-DERIVED default, not against zero. This field
        // is the one whose default is computed per interaction rather than being a
        // constant in TASK_FIELD_DEFAULTS, so a plain `positive()` test reported
        // every task as having authored timing and forced this group open on load —
        // which is exactly the "Step 3 opens with things I never set" complaint.
        // Same doctrine as the note at the top of this file, applied to a derived
        // default instead of a literal one.
        || (positive(task.expectedDurationMinutes)
          && task.expectedDurationMinutes !== defaultExpectedDurationMinutes(task))
        // A carried release instant has no editor at all — it is authored by
        // import/duplicate/seed only — so it MUST surface where it is at least
        // explained, or it is invisible state.
        || positive(task.releaseAfterMinutes)
        || filled(task.releaseAt)
        || (typeof task.difficulty === 'number' && task.difficulty !== TASK_FIELD_DEFAULTS.difficulty)
        || (typeof task.pointValue === 'number' && task.pointValue !== TASK_FIELD_DEFAULTS.pointValue);
    case 'rules':
      return (task.unlockAfterTaskIds?.length ?? 0) > 0
        || !!task.requirePresence
        || (task.tags?.length ?? 0) > 0
        || (typeof task.maxConcurrentTeams === 'number'
          && task.maxConcurrentTeams !== TASK_FIELD_DEFAULTS.maxConcurrentTeams);
    default:
      return false;
  }
}

/**
 * Which groups are mounted when the editor opens. ONE rule, expressed once: a
 * group is open exactly when it has content.
 */
export function defaultActiveGroups(task: Task): Record<OptInGroupKey, boolean> {
  return OPT_IN_GROUP_KEYS.reduce((acc, k) => {
    acc[k] = groupHasContent(k, task);
    return acc;
  }, {} as Record<OptInGroupKey, boolean>);
}

/**
 * Is the group offered at all? All four always are: even in a one-task stage the
 * rules group still carries station capacity, the presence gate and tags — only
 * the PREREQUISITE control inside it is withheld (it has no siblings to point
 * at), which the group's own body decides.
 */
export function groupApplies(_key: OptInGroupKey, _task: Task, _siblingCount: number): boolean {
  return true;
}

/** How many things are configured in a group — the small badge on its chip. */
export function groupSummary(key: OptInGroupKey, task: Task): number {
  switch (key) {
    case 'hint':
      return filled(task.hint) ? 1 : 0;
    case 'media':
      return task.media?.length ?? 0;
    case 'timerPoints':
      return (task.pausesTimer ? 1 : 0)
        + (positive(task.expiresAfterMinutes) ? 1 : 0)
        + (positive(task.expectedDurationMinutes) ? 1 : 0)
        + (positive(task.releaseAfterMinutes) || filled(task.releaseAt) ? 1 : 0)
        + (typeof task.difficulty === 'number' && task.difficulty !== TASK_FIELD_DEFAULTS.difficulty ? 1 : 0)
        + (typeof task.pointValue === 'number' && task.pointValue !== TASK_FIELD_DEFAULTS.pointValue ? 1 : 0);
    case 'rules':
      return (task.unlockAfterTaskIds?.length ?? 0)
        + (task.requirePresence ? 1 : 0)
        + (task.tags?.length ?? 0)
        + (typeof task.maxConcurrentTeams === 'number'
          && task.maxConcurrentTeams !== TASK_FIELD_DEFAULTS.maxConcurrentTeams ? 1 : 0);
    default:
      return 0;
  }
}

/**
 * The Remove (×) action: clear everything the group owns.
 *
 * Required fields RESET to their defaults rather than going `undefined` — a Task
 * is not valid without a difficulty, a point value or a capacity, and a control
 * that can write `undefined` into a required number is a crash waiting to be
 * scheduled. Genuinely optional fields do go `undefined`, which is also what
 * keeps a game that never touched them byte-identical.
 */
export function clearGroupPatch(key: OptInGroupKey): Partial<Task> {
  switch (key) {
    case 'hint':
      return {
        hint: undefined, hintPenalty: undefined,
        hintAutoRevealMinutes: undefined, hintAutoRevealAttempts: undefined,
      };
    case 'media':
      return { media: [] };
    case 'timerPoints':
      return {
        difficulty: TASK_FIELD_DEFAULTS.difficulty,
        pointValue: TASK_FIELD_DEFAULTS.pointValue,
        expiresAfterMinutes: undefined,
        expectedDurationMinutes: undefined,
        pausesTimer: undefined,
      };
    case 'rules':
      return {
        maxConcurrentTeams: TASK_FIELD_DEFAULTS.maxConcurrentTeams,
        unlockAfterTaskIds: undefined,
        requirePresence: undefined,
        tags: [],
      };
    default:
      return {};
  }
}
