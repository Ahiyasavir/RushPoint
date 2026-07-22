// Progressive-disclosure model for the Task Builder (change: task-builder-ui).
//
// The task editor used to be one long flat form: every optional block (hint,
// prerequisites, media, presence/hidden-location rules, advanced scoring) was
// laid out at full size all the time, so a simple task cost as much vertical
// space as the most complex one. Each of those blocks is now a collapsible
// section, and THESE pure functions decide, for a given task:
//   • sectionApplies      — is the section even offered? (never hide a field that
//                           matters for this task type, never show a dead one)
//   • defaultOpenSections — does it start expanded? (only when it already holds
//                           authored content, so nothing an author wrote is ever
//                           hidden behind a closed header)
//   • sectionSummary      — the "n" badge the collapsed header shows, so the
//                           at-rest form still tells you what is configured.
// Extracted from the component so the rules are unit-testable without rendering
// (scripts/test-wizard-sections.ts).
import type { Stage, Task } from '@rushpoint/shared';
import { normalizeTriggerMode } from '@rushpoint/shared';

export const SECTION_KEYS = ['hint', 'unlock', 'media', 'rules', 'advanced'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

const filled = (s: string | undefined | null): boolean => typeof s === 'string' && s.trim() !== '';

// A task is "located" when its trigger needs real coordinates — only those can
// hide their pin behind a clue.
function isLocated(task: Task): boolean {
  const m = normalizeTriggerMode(task);
  return m === 'radius' || m === 'exact';
}

// Answer-style tasks are the ones that can be gated on physical presence.
function isAnswerTask(task: Task): boolean {
  return task.type === 'quiz' || task.type === 'numeric' || task.type === 'survey';
}

/**
 * Is `key` offered for this task at all? `siblingCount` is the number of tasks in
 * the SAME stage (including this one) — prerequisites are meaningless in a
 * one-task stage.
 */
export function sectionApplies(key: SectionKey, task: Task, siblingCount: number): boolean {
  switch (key) {
    case 'unlock': return siblingCount > 1;
    case 'rules': return isAnswerTask(task) || isLocated(task);
    case 'hint':
    case 'media':
    case 'advanced':
    default:
      return true;
  }
}

/**
 * Which sections start expanded when the editor opens. The rule is uniform: a
 * section opens only when it already carries authored content, so at rest a
 * fresh task shows nothing but its core fields.
 */
export function defaultOpenSections(task: Task): Record<SectionKey, boolean> {
  return {
    hint: filled(task.hint),
    unlock: (task.unlockAfterTaskIds?.length ?? 0) > 0,
    media: (task.media?.length ?? 0) > 0,
    rules: !!task.requirePresence || !!task.hideLocation,
    // ONE rule, two consumers (change: builder-first-task-flow): the section
    // opens exactly when its badge would show a count, so a configured expiry or
    // a carried release instant can never be invisible at rest.
    advanced: sectionSummary('advanced', task) > 0,
  };
}

// The advanced section's OPTIONAL settings: the fields a fresh blankTask() does
// NOT carry. `pointValue`, `estimatedMinutes` and `maxConcurrentTeams` are
// excluded because every task ships with them, so counting them would badge the
// whole game (which is the same as no badge at all); `geofenceRadiusMeters` is
// excluded because selecting a located trigger mode auto seeds it, making it a
// default rather than a decision.
function advancedSettingCount(task: Task): number {
  const minutes = (v: number | undefined): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
  return (minutes(task.expiresAfterMinutes) ? 1 : 0)
    + (minutes(task.releaseAfterMinutes) ? 1 : 0)
    + (filled(task.releaseAt) ? 1 : 0);
}

/**
 * How many things are configured inside a section — rendered as a small badge on
 * the collapsed header so folding a section never hides the fact that it is set.
 * 0 means "nothing configured", i.e. no badge.
 */
export function sectionSummary(key: SectionKey, task: Task): number {
  switch (key) {
    case 'hint': return filled(task.hint) ? 1 : 0;
    case 'unlock': return task.unlockAfterTaskIds?.length ?? 0;
    case 'media': return task.media?.length ?? 0;
    case 'rules': return (task.requirePresence ? 1 : 0) + (task.hideLocation ? 1 : 0);
    case 'advanced': return advancedSettingCount(task);
    default:
      return 0;
  }
}

// ── Stage story (narrative chapters) ─────────────────────────────────────────
// The story editor is a compact inline disclosure too. Five authored fields:
// intro title / intro body EN / intro body HE / outro body EN / outro body HE.
type Narrative = Stage['narrative'];

export function storyFieldCount(n: Narrative): number {
  if (!n) return 0;
  return [n.intro?.title, n.intro?.body, n.intro?.bodyHe, n.outro?.body, n.outro?.bodyHe]
    .filter(filled).length;
}

export function storyHasContent(n: Narrative): boolean {
  return storyFieldCount(n) > 0;
}
