// Builder header stage/mission breadcrumb (change: builder-clarity-mission-hierarchy).
//
// The Builder never labelled its own hierarchy on screen — a creator inferred
// which stage was open, and which mission they were editing, purely from
// rail-vs-canvas layout position. This derives the "Stage {n}: {name}" /
// "Stage {n}: {name} -> Mission {m}: {name}" numbers and names from state the
// Builder already holds (the selected stage id + the wizard's open task id) —
// no new Firestore read, no new store field, matching how
// lib/runConsoleSignals.ts and similar view-model helpers are structured
// elsewhere. The actual "Stage"/"Mission" English/Hebrew wording lives in
// i18n.ts (`builder.breadcrumbStage` / `builder.breadcrumbMission`) and is
// interpolated by the caller — this file only picks the numbers and names.
export interface BreadcrumbTask {
  id: string;
  title?: string;
}

export interface BreadcrumbStage {
  id: string;
  title?: string;
  tasks: BreadcrumbTask[];
}

export interface BuilderBreadcrumbMission {
  /** 1-based position of the mission within its stage's task list. */
  number: number;
  /** The mission's title, or the untitled-mission placeholder. */
  name: string;
}

export interface BuilderBreadcrumbState {
  /** 1-based position of the stage within the game's stage list. */
  stageNumber: number;
  /** The stage's title, or the untitled-stage placeholder. */
  stageName: string;
  /** Present only while a mission of THIS stage is open in the wizard. */
  mission: BuilderBreadcrumbMission | null;
}

/**
 * Pure derivation of the Builder header breadcrumb. Returns `null` only when
 * `stageId` names no stage in `stages` (e.g. a brand new, still-empty game) —
 * the caller renders nothing in that case. An untitled stage or mission falls
 * back to the caller-supplied placeholder text rather than an empty segment.
 */
export function builderBreadcrumbState(
  stages: BreadcrumbStage[],
  stageId: string | null | undefined,
  openTaskId: string | null | undefined,
  placeholders: { untitledStage: string; untitledMission: string },
): BuilderBreadcrumbState | null {
  const stageIndex = stages.findIndex((s) => s.id === stageId);
  if (stageIndex < 0) return null;
  const stage = stages[stageIndex];
  const stageName = stage.title?.trim() || placeholders.untitledStage;

  let mission: BuilderBreadcrumbMission | null = null;
  if (openTaskId) {
    const taskIndex = stage.tasks.findIndex((t) => t.id === openTaskId);
    if (taskIndex >= 0) {
      mission = {
        number: taskIndex + 1,
        name: stage.tasks[taskIndex].title?.trim() || placeholders.untitledMission,
      };
    }
  }

  return { stageNumber: stageIndex + 1, stageName, mission };
}
