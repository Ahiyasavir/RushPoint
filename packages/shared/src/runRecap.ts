// Run recap (change: run-recap). Pure aggregation + montage-grid layout shared by
// the getRunRecap callable and the play-web recap screen / branded collage.
// No Firestore, no DOM.
import type { RunTeam, Run } from './types';

/** Query-param key for the public recap page: `?recap=<accessCode>`. */
export const RECAP_ROUTE_PARAM = 'recap';

export interface RunRecapStanding {
  rank: number;
  teamId: string;
  teamName: string;
  score: number;
  totalSeconds?: number;
}
export interface RunRecapPhoto {
  teamId: string;
  teamName: string;
  photoUrl: string;
}
export interface RunRecapStats {
  teamCount: number;
  photoCount: number;
  winnerName?: string;
}
export interface RunRecap {
  standings: RunRecapStanding[];
  photos: RunRecapPhoto[];
  stats: RunRecapStats;
}

type RecapTeam = Pick<RunTeam, 'id' | 'displayName' | 'stages' | 'score'>;
type RecapRun = Pick<Run, 'leaderboard'>;

/**
 * Aggregate a finalized run into a recap: standings (reusing the shared
 * leaderboard ordering when present), every team's approved/correct photo, and
 * headline stats. Rejected/pending photos and cleared photoUrls (post-prune) are
 * excluded; standings are always returned (a pruned run just yields no photos).
 *
 * `hiddenTaskIds` (wave-g #2) is the set of task ids whose location is hidden
 * (`hideLocation`); their photos are excluded so a staged/published recap can't
 * leak a hidden-spot photo to teams still hunting — mirroring the live-feed
 * `shouldFeedTask` exclusion. The caller (in `functions/`, where the game doc is
 * loaded) resolves the set via `shouldFeedTask`; this stays pure. Omitted ⇒ no
 * filter (back-compat).
 */
export function buildRunRecap(
  teams: RecapTeam[],
  run: RecapRun,
  hiddenTaskIds?: ReadonlySet<string>,
): RunRecap {
  const rankings = run.leaderboard?.rankings;
  const standings: RunRecapStanding[] = rankings && rankings.length > 0
    ? rankings.map((r) => ({
        rank: r.rank,
        teamId: r.teamId,
        teamName: r.teamName,
        score: r.score,
        totalSeconds: r.durationSeconds ?? (r.totalMinutes != null ? r.totalMinutes * 60 : undefined),
      }))
    : [...teams]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .map((t, i) => ({ rank: i + 1, teamId: t.id, teamName: t.displayName, score: t.score ?? 0 }));

  const nameById = new Map(teams.map((t) => [t.id, t.displayName]));

  const photos: RunRecapPhoto[] = [];
  for (const t of teams) {
    for (const stage of t.stages ?? []) {
      for (const rec of stage.tasks ?? []) {
        if (hiddenTaskIds?.has(rec.taskId)) continue; // hidden-location photo: never in recap
        const ok = rec.verificationOutcome === 'approved' || rec.verificationOutcome === 'correct';
        if (ok && rec.photoUrl) {
          photos.push({ teamId: t.id, teamName: nameById.get(t.id) ?? t.displayName, photoUrl: rec.photoUrl });
        }
      }
    }
  }

  return {
    standings,
    photos,
    stats: {
      teamCount: teams.length,
      photoCount: photos.length,
      winnerName: standings[0]?.teamName,
    },
  };
}

export interface MontageCell { x: number; y: number; w: number; h: number; }
export interface MontageGrid {
  cols: number;
  rows: number;
  shown: number;   // photos actually placed (≤ max)
  capped: boolean; // true when n exceeded the cap
  cells: MontageCell[];
}

/**
 * A balanced, in-bounds, non-overlapping grid that tiles N photos into a W×H
 * canvas. Caps at `max` cells (overflow reported via `capped`). Near-square:
 * cols = ceil(√shown), rows = ceil(shown/cols).
 */
export function computeMontageGrid(n: number, W: number, H: number, max = 25): MontageGrid {
  const shown = Math.max(0, Math.min(Math.floor(n), max));
  if (shown === 0) return { cols: 0, rows: 0, shown: 0, capped: n > max, cells: [] };

  const cols = Math.ceil(Math.sqrt(shown));
  const rows = Math.ceil(shown / cols);
  const cellW = W / cols;
  const cellH = H / rows;

  const cells: MontageCell[] = [];
  for (let i = 0; i < shown; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    cells.push({ x: col * cellW, y: row * cellH, w: cellW, h: cellH });
  }
  return { cols, rows, shown, capped: n > max, cells };
}
