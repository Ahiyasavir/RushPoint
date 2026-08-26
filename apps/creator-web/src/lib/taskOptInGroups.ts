// The task editor's modular "opt-in" field groups
// (change: task-editor-progressive-disclosure).
//
// The editor shows the core fields plus a row of CHIPS — + Add hint,
// + Set timer / points, + Prerequisites / rules. Clicking a chip
// mounts just that group; a Remove control clears it and puts the chip back.
// This replaces the five always-listed collapsible sections, which presented the
// whole product's surface on every task however simple.
//
// ─── The rules that must never break ─────────────────────────────────────────
// (revised by change: builder-nondestructive-disclosure)
//
// 1. EVERY group opens COLLAPSED. Expansion is NOT coupled to content.
// 2. A folded group still ADVERTISES what it holds, via its chip's count badge
//    (`groupSummary`). That badge — not auto-expansion — is what keeps authored
//    data discoverable, so `groupHasContent` stays load-bearing even though it no
//    longer decides what opens.
// 3. FOLDING a group writes NOTHING to the task (`foldGroupAway`). Clearing is a
//    separate, explicit act (`clearGroupPatch`).
//
// WHY RULE 1 REPLACED "a group with data renders expanded". That older rule tried
// to guarantee an authored hint could never hide behind an unclicked chip, and
// leaned on comparing against the defaults `blankTask()` ships rather than against
// undefined. It still failed in practice, because the DEFAULTS THEMSELVES
// DISAGREE: `blankTask()` (lib/wizardLogic.ts) seeds maxConcurrentTeams 3 — the
// value TASK_FIELD_DEFAULTS mirrors — while the template seeder
// (apps/creator-web/src/templates.ts `task()`) seeds 5. So every task in every
// template-derived game read as "authored" and opened its rules group, and the
// per-task difficulty/pointValue overrides those templates apply opened the timer
// group too. The editor greeted a creator with three or four unfolded sections of
// settings they never chose. Rule 2 keeps the original guarantee without that cost.
//
// "Is this field authored?" still compares against the DEFAULT rather than against
// undefined — that logic feeds the badge now instead of the expansion, and an
// undefined-test would light every badge on every task.
//
// Unit-tested by scripts/test-task-opt-in-groups.ts (in `npm test`).
import type { Task } from '@rushpoint/shared';
import { defaultExpectedDurationMinutes } from '@rushpoint/shared';

// `media` is deliberately NOT here (change: task-media-durability). A picture is part of
// describing a mission, so it is authored beside the description in the details step and
// is always visible — it is not an optional extra a creator must first discover behind a
// chip on the last step. Removing it from the registry (rather than just rendering it
// elsewhere) keeps `clearGroupPatch('media')` from being reachable through a control that
// no longer exists, and keeps this list an honest description of the UI.
export const OPT_IN_GROUP_KEYS = ['hint', 'timerPoints', 'rules'] as const;
export type OptInGroupKey = (typeof OPT_IN_GROUP_KEYS)[number];

/**
 * The values `blankTask()` seeds. A field still equal to its default was never
 * decided by the creator, so it is not "content" — see the note above.
 * Kept in one place so the reset path and the authored-test can't disagree.
 */
export const TASK_FIELD_DEFAULTS = {
  difficulty: 5,
  pointValue: 100,
  // 1, not 3: a freshly-added task declares no station contention of its own,
  // and 1 is the SAFE assumption (a mission the creator has not thought about
  // capacity for is more likely a one-at-a-time stop than a wide-open space).
  // Mirrors `blankTask()` (lib/wizardLogic.ts) — see the note above on why the
  // two must never disagree.
  maxConcurrentTeams: 1,
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
 * Which groups are mounted when the editor opens: NONE, always (rule 1 above).
 *
 * The `task` parameter is deliberately retained and deliberately unused. It keeps
 * the call site honest — the answer is a property of the editor's disclosure
 * policy, not of the task — and it means re-coupling expansion to content would
 * be a visible edit here rather than a quiet change of caller.
 */
export function defaultActiveGroups(_task: Task): Record<OptInGroupKey, boolean> {
  return OPT_IN_GROUP_KEYS.reduce((acc, k) => {
    acc[k] = false;
    return acc;
  }, {} as Record<OptInGroupKey, boolean>);
}

/** The editor's per-group open/closed map. */
export type ActiveGroups = Record<OptInGroupKey, boolean>;

/**
 * Fold a group away: a DISPLAY decision and nothing else (rule 3 above).
 *
 * Returns the task BY THE SAME REFERENCE it was given — no copy, no patch — so
 * "hiding never edits the task" is provable by identity rather than by inspecting
 * fields. The predecessor of this function ran `clearGroupPatch` first and then
 * collapsed, which meant a control the creator read as "hide this section" wiped
 * the fields underneath it and the wipe rode the Builder's autosave into
 * `updateGame`. Clearing is still available, explicitly, via `clearGroupPatch`.
 */
export function foldGroupAway(
  task: Task,
  active: ActiveGroups,
  key: OptInGroupKey,
): { task: Task; active: ActiveGroups } {
  return { task, active: { ...active, [key]: false } };
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
