// Progressive-disclosure model for the Builder STAGE editor
// (change: wave-k stage-editor-redesign).
//
// The stage header used to stack every authoring setting — partial-completion
// count, timed release, exclusive groups, chapter story — above the task cards,
// so even a one-task stage read as a dense form. Those settings now live behind a
// SINGLE "stage settings" disclosure, and a stage advertises a non-default
// setting with a small at-rest summary chip. THIS pure function decides, per
// stage:
//   • whether each control even APPLIES (never offer a dead one — grouping and
//     the completion count are meaningless with a single task; timed release is
//     meaningless on the first stage, which always opens at run start);
//   • whether each is NON-DEFAULT / "active" (badge-worthy — a folded setting
//     must still say it is configured, so the creator never loses a change);
//   • activeCount — how many settings are non-default, for the gear badge.
//
// Extracted from BuilderPage so the disclosure rules are unit-testable without
// rendering (scripts/test-stage-settings.ts). Presentation only: what a setting
// MEANS (and its server enforcement) lives in @rushpoint/shared. `groupCount`
// reads the EFFECTIVE groups so a one-member (inert) group is never counted,
// exactly as the server treats it.
import type { Stage } from '@rushpoint/shared';
import { effectiveExclusiveGroups } from '@rushpoint/shared';
import { storyFieldCount } from './wizardSections';

export interface StageSettingsState {
  /** number of tasks in the stage */
  taskCount: number;
  /** completion-rule control is meaningful (a pool of >1 task to choose from) */
  requiredApplies: boolean;
  /** requiredTaskCount is set to fewer than all tasks (non-default) */
  requiredActive: boolean;
  /** effective required value (defaults to taskCount when unset) */
  requiredValue: number;
  /** timed release is offered — every stage EXCEPT the first (which opens at start) */
  releaseApplies: boolean;
  /** a positive release delay is configured */
  releaseActive: boolean;
  /** the configured delay in minutes (0 when none / not applicable) */
  releaseMinutes: number;
  /** exclusive grouping is offered (>1 task) */
  groupsApply: boolean;
  /** at least one EFFECTIVE (>=2 member) group exists */
  groupsActive: boolean;
  /** number of EFFECTIVE groups (inert one-member groups excluded) */
  groupCount: number;
  /** the stage carries authored chapter-story content */
  storyActive: boolean;
  /** how many advanced settings are non-default — drives the gear badge */
  activeCount: number;
}

export function stageSettingsState(stage: Stage, opts: { isFirstStage: boolean }): StageSettingsState {
  const taskCount = stage.tasks.length;

  const requiredApplies = taskCount > 1;
  const requiredValue = stage.requiredTaskCount ?? taskCount;
  const requiredActive = requiredApplies && requiredValue < taskCount;

  const releaseApplies = !opts.isFirstStage;
  const releaseMinutes = typeof stage.releaseAfterMinutes === 'number' && stage.releaseAfterMinutes > 0
    ? stage.releaseAfterMinutes
    : 0;
  const releaseActive = releaseApplies && releaseMinutes > 0;

  const groupsApply = taskCount > 1;
  const groupCount = effectiveExclusiveGroups(stage).length;
  const groupsActive = groupsApply && groupCount > 0;

  const storyActive = storyFieldCount(stage.narrative) > 0;

  const activeCount = [requiredActive, releaseActive, groupsActive, storyActive].filter(Boolean).length;

  return {
    taskCount,
    requiredApplies, requiredActive, requiredValue,
    releaseApplies, releaseActive, releaseMinutes,
    groupsApply, groupsActive, groupCount,
    storyActive,
    activeCount,
  };
}

/** Fraction shown on the completion summary chip, e.g. "3/6". Language-neutral:
 *  the surrounding label + aria come from i18n, only the digits live here. */
export function requiredChipText(requiredValue: number, taskCount: number): string {
  return `${requiredValue}/${taskCount}`;
}
