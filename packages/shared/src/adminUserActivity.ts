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
  };
}
