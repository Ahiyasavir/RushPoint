// Run replay / VOD (change: run-replay-vod). Pure timeline aggregator shared by
// the getRunReplay callable and the creator Replay page. Produces a globally
// time-ordered event stream + per-team cumulative score series. Retention-safe:
// teams with no usable timing data are omitted without error. No Firestore/DOM.
import type { RunTeam } from './types';

export type ReplayEventType = 'start' | 'task' | 'finish';

export interface ReplayEvent {
  t: string;               // ISO timestamp
  teamId: string;
  teamName: string;
  type: ReplayEventType;
  label?: string;          // task id (for 'task' events)
  points?: number;         // points earned at this event
  cumulativeScore: number; // this team's running total after this event
}

export interface ScorePoint { t: string; score: number; }

export interface RunReplay {
  events: ReplayEvent[];                       // globally time-ordered
  scoreSeries: Record<string, ScorePoint[]>;   // teamId → cumulative series
  teams: { teamId: string; teamName: string }[];
}

type ReplayTeam = Pick<RunTeam, 'id' | 'displayName' | 'startedAt' | 'finishedAt' | 'stages'>;

/**
 * Build a chronological replay of a run: a start/task/finish event per team with
 * cumulative scores, all events globally sorted by time. A team without a
 * startedAt (e.g. after a PII prune) is skipped.
 */
export function buildRunTimeline(teams: ReplayTeam[]): RunReplay {
  const events: ReplayEvent[] = [];
  const scoreSeries: Record<string, ScorePoint[]> = {};
  const teamList: { teamId: string; teamName: string }[] = [];

  for (const team of teams) {
    if (!team.startedAt) continue; // pruned / never started → omit
    teamList.push({ teamId: team.id, teamName: team.displayName });

    // Gather this team's completed tasks in completion order.
    const completed: { t: string; label: string; points: number }[] = [];
    for (const stage of team.stages ?? []) {
      for (const rec of stage.tasks ?? []) {
        if (rec.status === 'completed' && rec.completedAt) {
          completed.push({ t: rec.completedAt, label: rec.taskId, points: rec.earnedScore ?? 0 });
        }
      }
    }
    completed.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

    let cumulative = 0;
    const series: ScorePoint[] = [];

    events.push({ t: team.startedAt, teamId: team.id, teamName: team.displayName, type: 'start', cumulativeScore: 0 });
    series.push({ t: team.startedAt, score: 0 });

    for (const c of completed) {
      cumulative += c.points;
      events.push({ t: c.t, teamId: team.id, teamName: team.displayName, type: 'task', label: c.label, points: c.points, cumulativeScore: cumulative });
      series.push({ t: c.t, score: cumulative });
    }

    if (team.finishedAt) {
      events.push({ t: team.finishedAt, teamId: team.id, teamName: team.displayName, type: 'finish', cumulativeScore: cumulative });
      series.push({ t: team.finishedAt, score: cumulative });
    }

    scoreSeries[team.id] = series;
  }

  // Global chronological order; ties keep insertion order (stable sort).
  events.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  return { events, scoreSeries, teams: teamList };
}
