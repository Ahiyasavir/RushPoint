// Cross-run player profile + badges (change: player-profile-badges). Pure stat-merge
// and badge-award rules so the retention meta-layer is unit-tested without Firestore.
// The anonymous play-web uid is stable per device, so it naturally accumulates.

export interface PlayerStats {
  gamesPlayed: number;
  tasksCompleted: number;
  totalPoints: number;
}

export interface PlayerProfile extends PlayerStats {
  uid: string;
  displayName?: string;
  badges: string[]; // earned badge ids
  updatedAt?: string;
}

// Badge id → predicate over lifetime stats. Order = display order.
export const BADGES: { id: string; earned: (s: PlayerStats) => boolean }[] = [
  { id: 'first_finish', earned: (s) => s.gamesPlayed >= 1 },
  { id: 'explorer',     earned: (s) => s.tasksCompleted >= 10 },
  { id: 'pathfinder',   earned: (s) => s.tasksCompleted >= 50 },
  { id: 'veteran',      earned: (s) => s.gamesPlayed >= 5 },
  { id: 'high_scorer',  earned: (s) => s.totalPoints >= 500 },
  { id: 'legend',       earned: (s) => s.totalPoints >= 2000 },
];

/** All badge ids earned at the given lifetime stats (monotonic in every stat). */
export function evaluateBadges(stats: PlayerStats): string[] {
  return BADGES.filter((b) => b.earned(stats)).map((b) => b.id);
}

/**
 * Fold one finished run into a profile. Returns the updated profile and the badge ids
 * newly earned by this run (for a celebratory reveal). Negative inputs are floored at 0.
 */
export function mergePlayerResult(
  prev: PlayerProfile | null,
  result: { uid: string; displayName?: string; tasksCompleted: number; points: number },
): { profile: PlayerProfile; newBadges: string[] } {
  const stats: PlayerStats = {
    gamesPlayed: (prev?.gamesPlayed ?? 0) + 1,
    tasksCompleted: (prev?.tasksCompleted ?? 0) + Math.max(0, result.tasksCompleted || 0),
    totalPoints: (prev?.totalPoints ?? 0) + Math.max(0, result.points || 0),
  };
  const before = new Set(prev?.badges ?? []);
  const badges = evaluateBadges(stats);
  const newBadges = badges.filter((b) => !before.has(b));
  return {
    profile: {
      uid: result.uid,
      displayName: result.displayName ?? prev?.displayName,
      ...stats,
      badges,
    },
    newBadges,
  };
}

/** An empty profile for a uid that has never finished a run. */
export function emptyProfile(uid: string): PlayerProfile {
  return { uid, gamesPlayed: 0, tasksCompleted: 0, totalPoints: 0, badges: [] };
}
