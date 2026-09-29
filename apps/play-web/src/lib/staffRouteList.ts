// The staff app's "send to a mission" list (change: route-team-to-mission, staff half).
//
// The staff app cannot read the game document (firestore.rules), so it cannot compute what blocks a
// mission. It lists EVERY mission of the run from the outline, marks the two states the team
// document alone proves (done, current), and leaves the rest to the server: tapping a mission asks
// `forceAssignTask({ dryRun: true })`, which answers with the exact blockers it will recompute.
// Pure and total. Pinned by scripts/test-staff-route-list.ts.

export type StaffRouteState = 'done' | 'current' | 'open' | 'unknown';

export interface StaffRouteMission { taskId: string; title: string; state: StaffRouteState; selectable: boolean }
export interface StaffRouteStage { stageId: string; title: string; missions: StaffRouteMission[] }

type OutlineStage = { id?: unknown; title?: unknown; tasks?: unknown };
type TeamLike = {
  activeTaskId?: unknown;
  stages?: unknown;
} | null | undefined;

function recordStatuses(team: TeamLike): Map<string, string> {
  const out = new Map<string, string>();
  const stages = team && Array.isArray(team.stages) ? team.stages : [];
  for (const s of stages as { tasks?: unknown }[]) {
    const tasks = s && Array.isArray(s.tasks) ? s.tasks : [];
    for (const r of tasks as { taskId?: unknown; status?: unknown }[]) {
      if (r && typeof r.taskId === 'string') out.set(r.taskId, typeof r.status === 'string' ? r.status : '');
    }
  }
  return out;
}

export function staffRouteList(outline: readonly OutlineStage[] | null | undefined, team: TeamLike): StaffRouteStage[] {
  if (!Array.isArray(outline)) return [];
  const status = recordStatuses(team);
  const active = team && typeof team.activeTaskId === 'string' ? team.activeTaskId : '';
  const stages: StaffRouteStage[] = [];
  for (const s of outline) {
    if (!s || typeof s.id !== 'string') continue;
    const tasks = Array.isArray(s.tasks) ? (s.tasks as { id?: unknown; title?: unknown }[]) : [];
    const missions: StaffRouteMission[] = [];
    for (const tk of tasks) {
      if (!tk || typeof tk.id !== 'string') continue;
      const st = status.get(tk.id);
      const state: StaffRouteState = st === undefined ? 'unknown'
        : st === 'completed' || st === 'skipped' ? 'done'
          : st === 'assigned' || tk.id === active ? 'current'
            : 'open';
      missions.push({ taskId: tk.id, title: typeof tk.title === 'string' && tk.title ? tk.title : tk.id, state, selectable: state === 'open' });
    }
    stages.push({ stageId: s.id, title: typeof s.title === 'string' ? s.title : '', missions });
  }
  return stages;
}

/** Does the team hold a mission right now (so "after this mission" is a real choice)? */
staffRouteList.teamBusy = (team: TeamLike): boolean =>
  !!team && typeof team.activeTaskId === 'string' && team.activeTaskId !== '';

/**
 * "Let them in" (located-mission-arrival, staff half): the mission a marshal may open for a team
 * without GPS, or null. Offered only when it would change something: the run gates located
 * missions on arrival (the outline says so, since staff cannot read the run), the team holds a
 * mission that HAS a place (a hidden one included), and it has not arrived there yet.
 */
export function staffLetInTarget(
  outline: { arrivalGate?: unknown; stages?: unknown } | null | undefined,
  team: TeamLike,
): string | null {
  if (!outline || outline.arrivalGate !== true || !team || typeof team.activeTaskId !== 'string') return null;
  const taskId = team.activeTaskId;
  const located = (Array.isArray(outline.stages) ? outline.stages : []).some((s: { tasks?: unknown }) =>
    (s && Array.isArray(s.tasks) ? s.tasks : []).some((tk: { id?: unknown; spot?: unknown }) => tk && tk.id === taskId && !!tk.spot));
  if (!located) return null;
  for (const s of (Array.isArray(team.stages) ? team.stages : []) as { tasks?: unknown }[]) {
    for (const r of (s && Array.isArray(s.tasks) ? s.tasks : []) as { taskId?: unknown; status?: unknown; arrivedAt?: unknown }[]) {
      if (r && r.taskId === taskId) return r.status === 'assigned' && !r.arrivedAt ? taskId : null;
    }
  }
  return null;
}
