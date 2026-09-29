// The "send this team to a mission" picker, as data (change: route-team-to-mission).
//
// Every mission of every stage, with its state for THIS team and exactly what blocks it. The
// blocker list comes from the same pure function the server recomputes (`routeBlockers`), so what
// the organizer confirms is what the server waives. Pure and total.
import { routeBlockers, type RouteBlockers, type RouteBlockerInput } from '@rushpoint/shared';

export type RouteMissionState = 'done' | 'current' | 'available' | 'blocked' | 'unavailable';

export interface RouteMission {
  taskId: string;
  title: string;
  state: RouteMissionState;
  /** A choice the organizer can make: available, or blocked only by waivable things. */
  selectable: boolean;
  blockers: RouteBlockers;
  /** Titles of the missing prerequisites, for the confirm sentence. */
  missingTitles: string[];
}

export interface RouteStage { stageId: string; title: string; missions: RouteMission[] }

export function buildRoutePicker(input: {
  stages: { id: string; title?: string; tasks?: ({ id: string; title?: string } & Record<string, unknown>)[] }[];
  team: RouteBlockerInput['team'];
  run: RouteBlockerInput['run'];
  nowMs: number;
} | null | undefined): RouteStage[] {
  if (!input || !Array.isArray(input.stages)) return [];
  const titleOf = new Map<string, string>();
  for (const s of input.stages) for (const t of s?.tasks ?? []) if (t && typeof t.id === 'string') titleOf.set(t.id, t.title ?? '');
  return input.stages.filter((s) => s && typeof s.id === 'string').map((s) => ({
    stageId: s.id,
    title: s.title ?? '',
    missions: (s.tasks ?? []).filter((t) => t && typeof t.id === 'string').map((t) => {
      const blockers = routeBlockers({ game: { stages: input.stages }, team: input.team, run: input.run, taskId: t.id, nowMs: input.nowMs });
      const hard = blockers.hard.map((b) => b.kind);
      const state: RouteMissionState = hard.includes('alreadyDone') ? 'done'
        : hard.includes('alreadyCurrent') ? 'current'
          : hard.length > 0 ? 'unavailable'
            : blockers.waivable.length > 0 ? 'blocked' : 'available';
      const missing = blockers.waivable.find((b) => b.kind === 'prerequisites');
      return {
        taskId: t.id,
        title: t.title ?? '',
        state,
        selectable: state === 'available' || state === 'blocked',
        blockers,
        missingTitles: missing && missing.kind === 'prerequisites' ? missing.missing.map((id) => titleOf.get(id) || id) : [],
      };
    }),
  }));
}
