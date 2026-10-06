// Does completing the mission in hand END the team's race? (issue 46, Ahiya 2026-10-06: "ברגע שאני
// לוחץ סמן כהושלם הטיימר חייב להפסיק, לא לחכות למשימה הבאה").
//
// The race clock on a time-only phone must stand still the moment the LAST mission is sent, not when
// the server answers and the Final screen arrives. On any other mission the race really goes on (the
// walk to the next stop counts), so it keeps running. Total and fail CLOSED toward "not the last":
// a clock that wrongly freezes mid-race is worse than one that freezes a second late.
import type { RunStageRecord } from '@rushpoint/shared';

type StageLike = Pick<RunStageRecord, 'status' | 'order' | 'requiredTaskCount'> & {
  tasks: ReadonlyArray<{ status?: string }>;
};

export function completionFinishesRace(stages: ReadonlyArray<StageLike> | null | undefined): boolean {
  if (!Array.isArray(stages) || stages.length === 0) return false;
  const active = stages.filter((s) => s && s.status === 'active');
  if (active.length !== 1) return false;
  const stage = active[0];
  // A later stage still to play means this is not the finish line.
  if (stages.some((s) => s !== stage && s.status !== 'completed' && Number(s.order) > Number(stage.order))) return false;
  const tasks: ReadonlyArray<{ status?: string }> = Array.isArray(stage.tasks) ? stage.tasks : [];
  const live = tasks.filter((t) => t && t.status !== 'skipped');
  const done = live.filter((t) => t.status === 'completed').length;
  const required = typeof stage.requiredTaskCount === 'number' && stage.requiredTaskCount > 0
    ? Math.min(stage.requiredTaskCount, live.length)
    : live.length;
  if (required <= 0) return false;
  return done + 1 >= required;
}
