// ─── Paths — thin helpers over FIRESTORE_PATHS, with nothing hardcoded ───────
//
// HARD REPO RULE (CLAUDE.md): "Always use `FIRESTORE_PATHS` from
// `@rushpoint/shared`; never hardcode path strings."
//
// `FIRESTORE_PATHS` names every DOCUMENT this implementation needs, but not
// every COLLECTION (there is no `gamesCol`, no `runsCol`, no `userDoc`). The
// tempting fix — writing `users/${uid}/games` here — would create a SECOND
// source of truth for the layout, which is exactly what the rule forbids: a
// later rename of the `games` segment in shared would leave this file silently
// pointing at a collection that no longer exists.
//
// So every collection path below is DERIVED from the document path that lives
// inside it, by dropping trailing segments. There is exactly one string literal
// in this file (the '/' separator), and the layout has exactly one owner.

import { COLLECTIONS, FIRESTORE_PATHS } from '@rushpoint/shared';
import { DataError } from '../types';
import type { GameScope, RunScope, TeamScope } from '../types';

const SEP = '/';

/**
 * A placeholder id used only to build a document path we immediately truncate.
 * It never reaches Firestore. Chosen to be non-empty so `FIRESTORE_PATHS` does
 * not collapse a segment.
 */
const PLACEHOLDER = '_';

/** Drop the last `n` segments of a path. Pure. */
function up(path: string, n = 1): string {
  const parts = path.split(SEP);
  if (parts.length <= n) {
    throw new DataError('failed-precondition', `cannot ascend ${n} from path ${path}`);
  }
  return parts.slice(0, parts.length - n).join(SEP);
}

/** The last segment of a path (a document or collection id). Pure. */
export function lastSegment(path: string): string {
  const parts = path.split(SEP);
  return parts[parts.length - 1] ?? '';
}

/**
 * Reject an id that would change the SHAPE of a path.
 *
 * A document id containing '/' silently addresses a different depth of the
 * tree — `teamId = 'a/b'` turns a team document into a sub-collection document
 * under another team. Ids reach this layer from access codes, uids and
 * user-authored task ids, so this is a data-driven risk, not a typo risk.
 */
export function assertId(id: string, what: string): string {
  if (typeof id !== 'string' || id.length === 0 || id.includes(SEP) || id === '.' || id === '..') {
    throw new DataError('failed-precondition', `${what}: invalid document id ${JSON.stringify(id)}`);
  }
  return id;
}


// ─── Documents ───────────────────────────────────────────────────────────────

export const docPaths = {
  /**
   * `users/{uid}`. Derived by ascending twice from the game path
   * (`users/{uid}/games/{gameId}`), because shared has no `user()` helper and
   * inventing one here would fork the layout.
   */
  user: (uid: string) => up(FIRESTORE_PATHS.game(assertId(uid, 'uid'), PLACEHOLDER), 2),

  game: (s: GameScope) =>
    FIRESTORE_PATHS.game(assertId(s.ownerUid, 'ownerUid'), assertId(s.gameId, 'gameId')),

  run: (s: RunScope) =>
    FIRESTORE_PATHS.run(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
    ),

  team: (s: TeamScope) =>
    FIRESTORE_PATHS.team(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
      assertId(s.teamId, 'teamId'),
    ),

  discoveryPoi: (s: GameScope, poiId: string) =>
    FIRESTORE_PATHS.discoveryPoi(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(poiId, 'poiId'),
    ),

  wallet: (uid: string) => FIRESTORE_PATHS.wallet(assertId(uid, 'uid')),

  walletTransaction: (uid: string, txId: string) =>
    FIRESTORE_PATHS.transaction(assertId(uid, 'uid'), assertId(txId, 'txId')),

  accessCode: (code: string) => FIRESTORE_PATHS.accessCode(assertId(code, 'accessCode')),

  auditLog: (id: string) => FIRESTORE_PATHS.auditLog(assertId(id, 'auditLogId')),

  publicGame: (gameId: string) => FIRESTORE_PATHS.publicGame(assertId(gameId, 'gameId')),
  publicTask: (taskId: string) => FIRESTORE_PATHS.publicTask(assertId(taskId, 'publicTaskId')),
  publicLike: (kind: 'game' | 'task', itemId: string, uid: string) =>
    FIRESTORE_PATHS.publicLike(kind, assertId(itemId, 'itemId'), assertId(uid, 'uid')),

  stationSecret: (taskId: string) => FIRESTORE_PATHS.stationSecret(assertId(taskId, 'taskId')),
  stationReview: (reviewId: string) => FIRESTORE_PATHS.stationReview(assertId(reviewId, 'reviewId')),

  staffInvite: (s: RunScope, inviteId: string) =>
    FIRESTORE_PATHS.staffInvite(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
      assertId(inviteId, 'inviteId'),
    ),

  runChat: (s: TeamScope) =>
    FIRESTORE_PATHS.runChat(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
      assertId(s.teamId, 'teamId'),
    ),

  runAnnouncement: (s: RunScope, id: string) =>
    FIRESTORE_PATHS.runAnnouncement(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
      assertId(id, 'announcementId'),
    ),

  runAlert: (s: RunScope, id: string) =>
    FIRESTORE_PATHS.runAlert(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
      assertId(id, 'alertId'),
    ),

  teamLocation: (s: RunScope, teamId: string) =>
    FIRESTORE_PATHS.teamLocation(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
      assertId(teamId, 'teamId'),
    ),

  feedItem: (s: RunScope, id: string) =>
    FIRESTORE_PATHS.feedItem(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
      assertId(id, 'feedItemId'),
    ),

  feedback: (s: RunScope, uid: string) =>
    FIRESTORE_PATHS.feedback(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
      assertId(uid, 'uid'),
    ),

  rateLimit: (bucket: string, uid: string) =>
    FIRESTORE_PATHS.rateLimit(bucket, assertId(uid, 'uid')),
} as const;


// ─── Collections (all derived, none written out) ─────────────────────────────

export const colPaths = {
  /** `users/{uid}/games` — the parent of a game document. */
  games: (ownerUid: string) =>
    up(FIRESTORE_PATHS.game(assertId(ownerUid, 'ownerUid'), PLACEHOLDER)),

  /** `users/{uid}/games/{gameId}/runs`. */
  runs: (s: GameScope) =>
    up(FIRESTORE_PATHS.run(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      PLACEHOLDER,
    )),

  /** `…/runs/{runId}/teams`. shared exposes this one directly. */
  teams: (s: RunScope) =>
    FIRESTORE_PATHS.teamsCol(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
    ),

  discoveryPois: (s: GameScope) =>
    FIRESTORE_PATHS.discoveryPoisCol(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
    ),

  wallets: () => up(FIRESTORE_PATHS.wallet(PLACEHOLDER)),
  walletTransactions: (uid: string) =>
    up(FIRESTORE_PATHS.transaction(assertId(uid, 'uid'), PLACEHOLDER)),

  accessCodes: () => up(FIRESTORE_PATHS.accessCode(PLACEHOLDER)),
  auditLogs: () => up(FIRESTORE_PATHS.auditLog(PLACEHOLDER)),

  publicGames: () => up(FIRESTORE_PATHS.publicGame(PLACEHOLDER)),
  publicTasks: () => up(FIRESTORE_PATHS.publicTask(PLACEHOLDER)),
  publicLikes: () => FIRESTORE_PATHS.publicLikesCol(),

  staffInvites: (s: RunScope) => up(docPaths.staffInvite(s, PLACEHOLDER)),
  runChat: (s: RunScope) =>
    FIRESTORE_PATHS.runChatCol(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
    ),
  announcements: (s: RunScope) => up(docPaths.runAnnouncement(s, PLACEHOLDER)),
  alerts: (s: RunScope) => up(docPaths.runAlert(s, PLACEHOLDER)),
  teamLocations: (s: RunScope) => up(docPaths.teamLocation(s, PLACEHOLDER)),
  feedItems: (s: RunScope) =>
    FIRESTORE_PATHS.feedItemsCol(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
    ),
  feedback: (s: RunScope) =>
    FIRESTORE_PATHS.feedbackCol(
      assertId(s.ownerUid, 'ownerUid'),
      assertId(s.gameId, 'gameId'),
      assertId(s.runId, 'runId'),
    ),
  stationSecrets: () => up(docPaths.stationSecret(PLACEHOLDER)),
  stationReviews: () => up(docPaths.stationReview(PLACEHOLDER)),
} as const;


// ─── Collection-GROUP ids ────────────────────────────────────────────────────
//
// `listLiveRunsForOwner` and `listFinishedRunsBefore` cross every owner, so they
// are collection-group queries — exactly as `listLiveRuns`
// (functions/src/runs/index.ts) and the retention sweep
// (functions/src/maintenance/index.ts) already do. The group id is the
// collection's last segment, taken from COLLECTIONS so it cannot drift.

export const groupIds = {
  runs: COLLECTIONS.RUNS,
  games: COLLECTIONS.GAMES,
  teams: COLLECTIONS.TEAMS,
} as const;
