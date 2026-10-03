// What the "send team back" picker offers (change: send-team-back).
//
// The picker must offer EXACTLY what `returnTeamTo` accepts (packages/shared/src/teamRewind.ts),
// so an organizer is never shown a choice the server then refuses:
//   * only stages the team has reached (a locked stage is not a place to go BACK to);
//   * a mission is selectable when it was completed or skipped;
//   * a whole stage is selectable when it is completed, or when it is the active stage and
//     something in it was skipped (otherwise returning to it would change nothing).
// Pure and total: src/lib/__tests__/sendBackTargets.test.ts.

export type SendBackMissionStatus = 'done' | 'skipped' | 'current' | 'open';

export interface SendBackMission {
  taskId: string;
  title: string;
  status: SendBackMissionStatus;
  selectable: boolean;
}

export interface SendBackStage {
  stageId: string;
  title: string;
  stageSelectable: boolean;
  missions: SendBackMission[];
}

type TeamStageLike = { stageId?: unknown; status?: unknown; tasks?: unknown };
type GameStageLike = { id?: unknown; title?: unknown; tasks?: unknown };

function missionStatus(status: unknown): SendBackMissionStatus {
  if (status === 'completed') return 'done';
  if (status === 'skipped') return 'skipped';
  if (status === 'assigned') return 'current';
  return 'open';
}

export function sendBackTargets(
  teamStages: readonly TeamStageLike[] | null | undefined,
  gameStages: readonly GameStageLike[] | null | undefined,
): SendBackStage[] {
  if (!Array.isArray(teamStages)) return [];
  const games = Array.isArray(gameStages) ? gameStages : [];
  const out: SendBackStage[] = [];
  for (const s of teamStages) {
    if (!s || typeof s.stageId !== 'string') continue;
    if (s.status !== 'completed' && s.status !== 'active') continue;
    const g = games.find((x) => x?.id === s.stageId);
    const titleOf = (id: string): string => {
      const tasks = Array.isArray(g?.tasks) ? (g!.tasks as { id?: unknown; title?: unknown }[]) : [];
      const t = tasks.find((x) => x?.id === id);
      return typeof t?.title === 'string' && t.title ? t.title : id;
    };
    const recs = Array.isArray(s.tasks) ? (s.tasks as { taskId?: unknown; status?: unknown; closedByOrganizer?: unknown }[]) : [];
    const missions: SendBackMission[] = recs
      .filter((r) => typeof r?.taskId === 'string')
      .map((r) => {
        const status = missionStatus(r.status);
        // run-gate-integrity: a mission the organizers CLOSED cannot be reopened (returnTeamTo refuses it),
        // so it is not offered.
        const closed = r.closedByOrganizer === true;
        return { taskId: r.taskId as string, title: titleOf(r.taskId as string), status, selectable: !closed && (status === 'done' || status === 'skipped') };
      });
    out.push({
      stageId: s.stageId,
      title: typeof g?.title === 'string' && g.title ? g.title : s.stageId,
      stageSelectable: s.status === 'completed' || missions.some((m) => m.status === 'skipped'),
      missions,
    });
  }
  return out;
}
