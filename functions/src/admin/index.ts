// ─── Platform admin: user activity report (change: admin-user-activity-dashboard) ─────
//
// The first in-app admin surface (everything before this — backfills, prune sweeps,
// audit logs — is script/CLI-only). Answers "who are our users, how many games has each
// created, how many runs have they launched, when were they last active."
//
// SCOPE: "users" here means real (non-anonymous) Firebase Auth accounts — i.e. creators.
// Anonymous participant accounts (play-web, uid == teamId) have no email, no
// `users/{uid}` doc, and no data-model link to any creator uid, so they are excluded
// entirely rather than fabricated into a row. See design.md §D1.

import * as functions from 'firebase-functions';
import { loggedCallable } from '../obs/log';
import { db, auth } from '../firebase';
import { assertAdmin } from '../auth';
import { isCreatorAccount, pageVerdict } from './authRoster';
import {
  buildAdminUserSummary,
  type AdminAuthUserFacts,
  type AdminUserGameFacts,
  type AdminUserRunFacts,
  type AdminUserSummary,
  type Game,
} from '@rushpoint/shared';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;
// Hard bound on Auth pages per invocation. RushPoint mints ONE ANONYMOUS ACCOUNT PER
// PLAY-WEB SESSION (uid == teamId), so the Auth pool is dominated by participants and
// grows with every run ever played, while the creators we actually want stay few. An
// unbounded `do…while (pageToken)` therefore scans a set that grows without limit to
// find a handful of rows — fine today, a callable timeout later, precisely when the
// report is first pointed at real data. 50 pages × 1000 = 50k accounts scanned max.
const MAX_AUTH_PAGES = 50;

/** Real (non-anonymous) Firebase Auth users, paged 1000 at a time. The two bounds —
 *  stop once `wanted + 1` are found, never read past MAX_AUTH_PAGES — are decided by
 *  the pure `pageVerdict`/`isCreatorAccount` rules in ./authRoster (unit-tested there),
 *  so this function is only the I/O around them.
 *
 *  `complete` is false when the page cap cut the scan short, so the caller can report
 *  an incomplete list honestly instead of implying it saw everything. */
async function listRealAuthUsers(
  wanted: number,
): Promise<{ users: AdminAuthUserFacts[]; complete: boolean }> {
  const out: AdminAuthUserFacts[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  for (;;) {
    const page = await auth.listUsers(1000, pageToken);
    pages++;
    for (const u of page.users) {
      if (!isCreatorAccount({ email: u.email ?? null, providerCount: u.providerData.length })) {
        continue; // anonymous participant — not a "user" in this report (design.md §D1)
      }
      out.push({
        uid: u.uid,
        email: u.email ?? null,
        displayName: u.displayName ?? null,
        createdAt: u.metadata.creationTime ?? null,
        lastSignInAt: u.metadata.lastSignInTime ?? null,
      });
    }
    pageToken = page.pageToken;
    const verdict = pageVerdict({
      found: out.length, wanted, pages, maxPages: MAX_AUTH_PAGES, hasMorePages: !!pageToken,
    });
    if (verdict.stop) {
      if (!verdict.complete) {
        functions.logger.warn('listPlatformUsers: stopped at the Auth page cap', {
          pages, found: out.length, cap: MAX_AUTH_PAGES,
        });
      }
      return { users: out, complete: verdict.complete };
    }
  }
}

async function gamesFor(uid: string): Promise<AdminUserGameFacts[]> {
  const snap = await db.collection(`users/${uid}/games`).get();
  return snap.docs.map((d) => {
    const g = d.data() as Game;
    return { id: d.id, title: g.title ?? d.id, createdAt: g.createdAt, updatedAt: g.updatedAt, deletedAt: g.deletedAt };
  });
}

async function runsFor(uid: string): Promise<AdminUserRunFacts[]> {
  // Served by the existing (ownerUid ASC, status ASC) collection-group index on `runs`
  // — a leading-field equality filter is a covered prefix of that composite index, so
  // no new index is required (design.md §D2).
  const snap = await db.collectionGroup('runs').where('ownerUid', '==', uid).get();
  return snap.docs.map((d) => {
    const r = d.data() as {
      gameId?: string; status?: string; createdAt?: string; finishedAt?: string; participantCount?: number;
    };
    return {
      id: d.id,
      gameId: r.gameId ?? '',
      gameTitle: r.gameId ?? '',
      status: r.status ?? 'unknown',
      createdAt: r.createdAt ?? '',
      finishedAt: r.finishedAt,
      participantCount: r.participantCount ?? 0,
    };
  });
}

// ─── listPlatformUsers ──────────────────────────────────────────────────────────
// Admin-only. Bounded (like listAuditLogs): returns at most `limit` users (default
// 100, hard cap 300 — lower than audit logs' 500 because each row costs 2 extra
// Firestore reads, not a single doc read) and sets `truncated` when more existed.
export const listPlatformUsers = loggedCallable('listPlatformUsers', async (data, context) => {
  assertAdmin(context);
  const { limit: rawLimit } = (data ?? {}) as { limit?: number };
  const limit = Math.max(1, Math.min(rawLimit ?? DEFAULT_LIMIT, MAX_LIMIT));

  const { users: found, complete } = await listRealAuthUsers(limit);
  // `truncated` means exactly "this list is not everything" — true both when more real
  // users existed than the limit AND when the Auth page cap cut the scan short. The UI
  // notice says the same thing either way, so collapsing them keeps the client honest
  // without inventing a second, subtler state for an operator to misread; the server
  // log above distinguishes the two causes for whoever is debugging.
  const truncated = found.length > limit || !complete;
  const kept = found.slice(0, limit);

  const users: AdminUserSummary[] = await Promise.all(
    kept.map(async (authUser) => {
      const [games, runs] = await Promise.all([gamesFor(authUser.uid), runsFor(authUser.uid)]);
      // Fill in real game titles for runs whose game still exists (runsFor only has gameId).
      const titleByGameId = new Map(games.map((g) => [g.id, g.title]));
      const runsWithTitles = runs.map((r) => ({ ...r, gameTitle: titleByGameId.get(r.gameId) ?? r.gameId }));
      return buildAdminUserSummary(authUser, games, runsWithTitles);
    }),
  );

  return { users, truncated };
});
