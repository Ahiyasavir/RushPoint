// Admin platform-user activity rollup (change: admin-user-activity-dashboard).
//
// Pure aggregation: fold one Firebase Auth account + the games/runs attributable to it
// into a single reporting row. No Firestore, no Auth SDK — the callable
// (functions/src/admin/index.ts) does all the I/O and calls this with plain facts, so
// the "how do we define games-created / runs-launched / last-active" rule is
// unit-tested independent of I/O. See design.md §D1/§D3.
//
// SCOPE: this is a CREATOR rollup, not a "platform user" rollup in the broader sense —
// anonymous participant accounts have no email, no `users/{uid}` doc, and no link to any
// creator uid, so they are filtered out before this function is ever called (see the
// callable). Do not extend this module to try to fold in player activity; there is no
// data-model relationship to fold on.

export interface AdminAuthUserFacts {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface AdminUserGameFacts {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface AdminUserRunFacts {
  id: string;
  gameId: string;
  gameTitle: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  participantCount: number;
}

export interface AdminUserGameSummary {
  id: string;
  title: string;
  createdAt: string;
  deleted: boolean;
}

export interface AdminUserRunSummary {
  id: string;
  gameId: string;
  gameTitle: string;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  participantCount: number;
}

export interface AdminUserSummary {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  gamesCreatedCount: number;
  games: AdminUserGameSummary[];
  runsLaunchedCount: number;
  runs: AdminUserRunSummary[];
  /** Max of lastSignInAt, every game's createdAt/updatedAt, every run's createdAt/finishedAt.
   *  `null` only when NONE of those timestamps exist at all. */
  lastActiveAt: string | null;
  /** Total ENGAGED milliseconds in the console, accumulated from client flushes
   *  (change: admin-engagement-and-outreach). NOT retroactive: every account that
   *  existed before that change starts at 0, so a 0 means "not measured yet", never
   *  "never visited". See ./engagement.ts for why the number is clamped. */
  engagementMs: number;
  /** Sum of participantCount across this creator's runs — how many players their games
   *  actually reached, which is the number that says whether a creator matters to the
   *  platform, as opposed to how many drafts they made. */
  participantsReached: number;
}

/** How far a creator got. Ordered: each stage implies the ones before it. */
export type ActivationStage = 'signed_up' | 'built_game' | 'launched_run' | 'completed_run';

export const ACTIVATION_STAGES: readonly ActivationStage[] = [
  'signed_up', 'built_game', 'launched_run', 'completed_run',
];

/**
 * The furthest point a creator reached.
 *
 * This exists because the very first look at real production data showed 13 of 26
 * creators had built a game and launched zero runs — the product's loudest signal, and
 * one no per user row makes visible on its own. Deriving it here (rather than eyeballing
 * two columns) is what lets the dashboard count it.
 *
 * Deliberately tolerant of drift: a run with no game still reports `launched_run`, since
 * the run is the stronger evidence and a missing template is a data problem, not a
 * reason to mis-stage a real user.
 */
export function activationStage(u: AdminUserSummary): ActivationStage {
  const runs = Array.isArray(u.runs) ? u.runs : [];
  if (runs.some((r) => r?.status === 'finished')) return 'completed_run';
  if ((u.runsLaunchedCount ?? 0) > 0 || runs.length > 0) return 'launched_run';
  if ((u.gamesCreatedCount ?? 0) > 0) return 'built_game';
  return 'signed_up';
}

export interface PlatformSummary {
  totalCreators: number;
  totalGames: number;
  totalRuns: number;
  totalParticipants: number;
  totalEngagementMs: number;
  /** Every creator bucketed into exactly one stage; the buckets sum to totalCreators. */
  funnel: Record<ActivationStage, number>;
  /** Percent of creators who ever launched a run, rounded. The single number worth
   *  watching: signing people up is easy, getting them to run a real game is the product. */
  activationRate: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Fold the whole roster into the handful of numbers worth putting at the top of a page. */
export function summarizePlatform(users: AdminUserSummary[]): PlatformSummary {
  const funnel: Record<ActivationStage, number> = {
    signed_up: 0, built_game: 0, launched_run: 0, completed_run: 0,
  };
  let totalGames = 0, totalRuns = 0, totalParticipants = 0, totalEngagementMs = 0, launched = 0;

  for (const u of users) {
    const stage = activationStage(u);
    funnel[stage]++;
    if (stage === 'launched_run' || stage === 'completed_run') launched++;
    totalGames += num(u.gamesCreatedCount);
    totalRuns += num(u.runsLaunchedCount);
    totalParticipants += num(u.participantsReached);
    totalEngagementMs += num(u.engagementMs);
  }

  return {
    totalCreators: users.length,
    totalGames,
    totalRuns,
    totalParticipants,
    totalEngagementMs,
    funnel,
    activationRate: users.length === 0 ? 0 : Math.round((launched / users.length) * 100),
  };
}

/** The later of two ISO instants (or nullable strings), ignoring unparsable/absent values.
 *  Returns null only when both inputs are null/invalid — never throws. */
function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  const va = Number.isFinite(ta);
  const vb = Number.isFinite(tb);
  if (!va && !vb) return null;
  if (!va) return b as string;
  if (!vb) return a as string;
  return ta >= tb ? (a as string) : (b as string);
}

export function buildAdminUserSummary(
  authUser: AdminAuthUserFacts,
  games: AdminUserGameFacts[],
  runs: AdminUserRunFacts[],
  /** Stored engagement total, if any. Defaults to 0 so every caller predating
   *  admin-engagement-and-outreach keeps compiling and reads as "not measured yet". */
  engagementMs = 0,
): AdminUserSummary {
  let lastActiveAt: string | null = authUser.lastSignInAt ?? null;
  const gameSummaries: AdminUserGameSummary[] = games.map((g) => {
    lastActiveAt = laterOf(lastActiveAt, g.updatedAt ?? g.createdAt);
    return { id: g.id, title: g.title, createdAt: g.createdAt, deleted: !!g.deletedAt };
  });
  const runSummaries: AdminUserRunSummary[] = runs.map((r) => {
    lastActiveAt = laterOf(lastActiveAt, r.finishedAt ?? r.createdAt);
    return {
      id: r.id,
      gameId: r.gameId,
      gameTitle: r.gameTitle,
      status: r.status,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt ?? null,
      participantCount: r.participantCount,
    };
  });

  return {
    uid: authUser.uid,
    email: authUser.email,
    displayName: authUser.displayName,
    createdAt: authUser.createdAt,
    lastSignInAt: authUser.lastSignInAt,
    gamesCreatedCount: gameSummaries.length,
    games: gameSummaries,
    runsLaunchedCount: runSummaries.length,
    runs: runSummaries,
    lastActiveAt,
    engagementMs: typeof engagementMs === 'number' && Number.isFinite(engagementMs) && engagementMs > 0
      ? engagementMs : 0,
    participantsReached: runSummaries.reduce(
      (n, r) => n + (Number.isFinite(r.participantCount) ? r.participantCount : 0), 0),
  };
}
