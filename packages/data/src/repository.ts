// ─── The RushPoint repository ────────────────────────────────────────────────
//
// One interface, two implementations: Firestore (today) and Postgres (later).
// Organised by AGGREGATE — the unit that is loaded, written and locked together.
//
// The surface is deliberately three-layered:
//
//   1. GENERIC CRUD (this file)      ~90 operations. Get / put / patch / delete
//                                    / list a whole aggregate. Boring on purpose.
//   2. QUERY-SHAPED READS (this file) ~15 operations. Each one is a named method,
//                                    NOT a query builder — see "No query builder"
//                                    below.
//   3. ATOMIC OPERATIONS (atomic.ts) ~30 operations. Every invariant the app
//                                    actually depends on. Never composed from
//                                    layer 1 by a caller.
//   +  SWEEPS (this file)             ~5 operations. Bounded, resumable, NOT
//                                    atomic, and honest about it.
//
//
// ── No query builder ─────────────────────────────────────────────────────────
//
// There is no `.where()`, no `.orderBy()`, no filter DSL. Every read this app
// performs is a NAMED METHOD with a fixed shape. That is not a limitation, it is
// the point:
//
//   * Firestore needs a composite index per query shape; if the shapes are
//     enumerated in an interface, the index set is derivable from it.
//   * Postgres needs an index per query shape too, for the same reason.
//   * A DSL lets a caller invent a shape neither backend can serve, and the bug
//     surfaces in production as a missing-index error.
//   * A named method can carry its invariant in its name and its doc comment.
//     `listUnackedAlerts(run)` says what it is for; `.where('acknowledged','==',
//     false)` says only what it types.
//
// Adding a read means adding a method here. That is a deliberate speed bump.
//
//
// ── Reads are whole aggregates ───────────────────────────────────────────────
//
// A `get` returns the full domain object or `null`. There is no field
// projection, because projections are how a "server-secret" field
// (`Task.answers`, `Task.hint`, `smart.secretCode`) accidentally becomes a
// participant-visible field. Sanitising for an audience is the CALLER's job and
// lives in the functions layer, where it is already tested.

import type {
  AccessCode,
  AdminAlert,
  Announcement,
  AuditLogEntry,
  Cursor,
  FeedItem,
  FlashMission,
  Game,
  GameScope,
  Page,
  PageRequest,
  Patch,
  PublicGame,
  PublicLike,
  PublicTask,
  Run,
  RunFeedback,
  RunScope,
  RunTeam,
  SortDir,
  StaffInvite,
  StationSubmission,
  StageRecordPatch,
  TaskRecordPatch,
  TeamLocation,
  TeamScope,
  Wallet,
  WalletTransaction,
} from './types';
import type { RunInTransaction } from './transaction';
import type { AtomicOperations } from './atomic';


// ─── Small shared shapes ─────────────────────────────────────────────────────

/** A creator profile document at `users/{uid}`. Loose because it is a grab-bag. */
export interface CreatorProfile {
  uid: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
  lang?: string;
  createdAt: string;
  updatedAt: string;
  [k: string]: unknown;
}

/** A GPS breadcrumb in `runs/{runId}/locationTrack`. 90-day retention. */
export interface LocationTrackPoint {
  id: string;
  teamId: string;
  lat: number;
  lng: number;
  accuracy?: number;
  at: string;
}

/**
 * One team↔HQ chat thread. Today this is ONE document at
 * `runs/{runId}/chat/{teamId}` holding the message array; later it is a
 * `chat_message` table. `deviceUids` is mirrored from the team so the Firestore
 * rules can authorise a read without a `get()` — it is an artefact of that
 * backend and an implementation may ignore it.
 */
export interface ChatThread {
  teamId: string;
  deviceUids: string[];
  messages: ChatMessage[];
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  from: 'team' | 'hq';
  senderId: string;
  senderName: string;
  text: string;
  at: string;
}

/** A hidden discovery POI on a game (`games/{gameId}/discoveryPois/{poiId}`). */
export interface DiscoveryPoi {
  id: string;
  gameId: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  title?: string;
  question?: string;
  answer?: string;
  points?: number;
  createdAt: string;
  [k: string]: unknown;
}

/** A trackable travelling between teams (`runs/{runId}/trackables/{id}`). */
export interface Trackable {
  id: string;
  name: string;
  /** null while it is sitting at a task; set while a team is carrying it. */
  currentHolderTeamId: string | null;
  /** null while carried; set to the task it was dropped at. */
  currentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  [k: string]: unknown;
}

/** One append-only movement record for a trackable. */
export interface TrackableLogEntry {
  teamId: string;
  teamName?: string;
  taskId?: string | null;
  action: 'pickup' | 'drop';
  at: string;
}

/** A capturable territory zone (`runs/{runId}/zones/{id}`). */
export interface Zone {
  id: string;
  name: string;
  center: import('./types').GeoPoint;
  radiusMeters: number;
  captureBonus: number;
  /** null while unclaimed. */
  ownerTeamId: string | null;
  ownerTeamName?: string;
  capturedAt?: string;
  createdAt: string;
  [k: string]: unknown;
}

/** A single-use guardian-consent token (`runs/{runId}/consentTokens/{token}`). */
export interface ConsentToken {
  token: string;
  teamId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  grantedBy?: string;
}

/** Cross-run anonymised aggregate at `benchmarks/{type}`. */
export interface BenchmarkDoc {
  type: string;
  sampleCount: number;
  totals: Record<string, number>;
  updatedAt: string;
  [k: string]: unknown;
}

/** Cross-run player history at `players/{uid}`. */
export interface PlayerProfileDoc {
  uid: string;
  runsPlayed: number;
  tasksCompleted: number;
  badges?: string[];
  updatedAt: string;
  [k: string]: unknown;
}

/** A smart-station secret at `stationSecrets/{taskId}` — never client-readable. */
export interface StationSecret {
  taskId: string;
  code: string;
  updatedAt: string;
}


// ─── 1. Creator + wallet ─────────────────────────────────────────────────────

export interface UserRepository {
  getProfile(uid: string): Promise<CreatorProfile | null>;
  putProfile(profile: CreatorProfile): Promise<void>;
  patchProfile(uid: string, patch: Patch<CreatorProfile>): Promise<void>;
  /** Hard delete — the account-deletion path. Sweeps run separately. */
  deleteProfile(uid: string): Promise<void>;
}

export interface WalletRepository {
  getWallet(uid: string): Promise<Wallet | null>;
  /** Create-or-replace. Used only on first touch; balances move via atomic.ts. */
  putWallet(wallet: Wallet): Promise<void>;
  /** Non-balance fields only (stripeCustomerId, plan metadata). */
  patchWallet(uid: string, patch: Patch<Wallet>): Promise<void>;

  appendTransaction(uid: string, tx: WalletTransaction): Promise<void>;
  /** Newest first. */
  listTransactions(uid: string, page: PageRequest): Promise<Page<WalletTransaction>>;
}


// ─── 2. Game template (an opaque aggregate — see types.ts) ───────────────────

export interface GameRepository {
  getGame(scope: GameScope): Promise<Game | null>;
  putGame(game: Game): Promise<void>;
  /**
   * `stages` may appear in the patch, and when it does it REPLACES the whole
   * array. That is the Phase-1 contract: the template is a blob (JSONB later),
   * routing loads it whole and filters in memory, and there is no per-task
   * mutation on this interface.
   */
  patchGame(scope: GameScope, patch: Patch<Game>): Promise<void>;
  /** Permanent destruction. Soft delete is a `patchGame` writing `deletedAt`. */
  deleteGame(scope: GameScope): Promise<void>;

  /** Live games (no `deletedAt`), newest first. */
  listGames(ownerUid: string, page: PageRequest): Promise<Page<Game>>;
  /** Tombstoned games (`deletedAt` present), for the Trash screen. */
  listDeletedGames(ownerUid: string, page: PageRequest): Promise<Page<Game>>;

  getDiscoveryPoi(scope: GameScope, poiId: string): Promise<DiscoveryPoi | null>;
  putDiscoveryPoi(scope: GameScope, poi: DiscoveryPoi): Promise<void>;
  deleteDiscoveryPoi(scope: GameScope, poiId: string): Promise<void>;
  listDiscoveryPois(scope: GameScope): Promise<DiscoveryPoi[]>;
}


// ─── 3. Public gallery projection ────────────────────────────────────────────
//
// A denormalised, world-readable copy. Writes here are a PROJECTION of the
// template — never a source of truth — which is why `replacePublicTasksForGame`
// exists as one method: publishing must add the current tasks AND remove the
// ones the creator deleted, and doing that as two calls is how a stale
// world-readable document survives a republish.

export interface PublicRepository {
  getPublicGame(gameId: string): Promise<PublicGame | null>;
  putPublicGame(game: PublicGame): Promise<void>;
  deletePublicGame(gameId: string): Promise<void>;

  /** The published-task id is derived: `${sourceGameId}_${taskId}`. */
  getPublicTask(publicTaskId: string): Promise<PublicTask | null>;
  /**
   * Replace the ENTIRE published task set for one source game: every task in
   * `tasks` is written, and every existing `publicTasks` document with
   * `sourceGameId === gameId` that is NOT in `tasks` is removed.
   *
   * DELIBERATELY STRONGER THAN TODAY. `publishGame` currently writes the
   * current task set and never deletes the rows for tasks the creator removed,
   * so a deleted mission stays in the world-readable gallery forever. Modelling
   * publish as a REPLACE rather than an upsert closes that at the interface, so
   * neither implementation can reintroduce it.
   *
   * `carryForward` receives the existing row for a task being rewritten and is
   * how the counters that must survive a re-publish (`copyCount`, `likeCount`,
   * `createdAt` — newness dates from the FIRST publish) are preserved. It is
   * pure and is applied inside the write.
   */
  replacePublicTasksForGame(
    gameId: string,
    tasks: PublicTask[],
    carryForward: (next: PublicTask, prior: PublicTask | null) => PublicTask,
  ): Promise<void>;
  /** Remove every published task belonging to a game (unpublish / delete). */
  deletePublicTasksForGame(gameId: string): Promise<void>;

  /**
   * Gallery search. Ranking (`popularity`) and facet filtering happen ABOVE this
   * call in memory — see @rushpoint/shared galleryFilter/popularity. The
   * repository only serves the tag-and-order slice both backends can index.
   */
  searchPublicGames(q: PublicSearchQuery): Promise<Page<PublicGame>>;
  searchPublicTasks(q: PublicSearchQuery): Promise<Page<PublicTask>>;

  /** Read a like record. Its id is derived from (kind,itemId,uid) — see atomic.ts. */
  getPublicLike(kind: 'game' | 'task', itemId: string, uid: string): Promise<PublicLike | null>;
  /** Which of `itemIds` this user has liked — one round trip for a result page. */
  listLikedItemIds(kind: 'game' | 'task', uid: string, itemIds: string[]): Promise<string[]>;

  /** Legacy `publicTasks` repair sweep — see SweepRepository for the contract. */
  scanPublicTasks(page: PageRequest): Promise<Page<PublicTask>>;

  /**
   * The denormalised tag histogram behind the tag picker. One aggregate; the
   * write side is `bumpTagStats` (atomic.ts). Fails OPEN to `{}` — an empty
   * histogram degrades to the recommended-tag seeds, it never breaks the page.
   */
  getTagStats(): Promise<Record<string, number>>;
}

export interface PublicSearchQuery extends PageRequest {
  /** Match ANY of these tags. Empty/absent ⇒ no tag constraint. */
  tags?: string[];
  /** Ordered field. Both backends index exactly these two. */
  orderBy: 'popularity' | 'createdAt';
  dir: SortDir;
}


// ─── 4. Access codes ─────────────────────────────────────────────────────────

export interface AccessCodeRepository {
  getAccessCode(code: string): Promise<AccessCode | null>;
  patchAccessCode(code: string, patch: Patch<AccessCode>): Promise<void>;
  deleteAccessCode(code: string): Promise<void>;
  /** Every code pointing at one game — the soft-delete revoke/restore pair. */
  listAccessCodesForGame(scope: GameScope): Promise<AccessCode[]>;
  listAccessCodesForRun(scope: RunScope): Promise<AccessCode[]>;
}


// ─── 5. Run ──────────────────────────────────────────────────────────────────

export interface RunRepository {
  getRun(scope: RunScope): Promise<Run | null>;
  putRun(run: Run): Promise<void>;
  patchRun(scope: RunScope, patch: Patch<Run>): Promise<void>;
  deleteRun(scope: RunScope): Promise<void>;

  listRunsForGame(scope: GameScope, page: PageRequest): Promise<Page<Run>>;
  /** Every live run this owner has, for the multi-run GM overview. */
  listLiveRunsForOwner(ownerUid: string): Promise<Run[]>;
  /**
   * Finished runs older than `finishedBefore` — the 90-day PII prune's driver.
   * Crosses the whole `runs` collection group, which is why it is named.
   */
  listFinishedRunsBefore(finishedBefore: string, page: PageRequest): Promise<Page<Run>>;
}


// ─── 6. Team (the hottest aggregate in the system) ───────────────────────────
//
// `RunTeam.stages[] -> RunStageRecord.tasks[] -> RunTaskRecord` is ONE document
// in Firestore and WILL BE two tables in Postgres. Every write below is
// therefore addressed by (stageId, taskId) — never by array index — so the SQL
// implementation is a single-row UPDATE and the Firestore implementation does
// the nested read-modify-rewrite internally.
//
// See CLAUDE.md: never dotted-path-update an array element; it coerces the array
// to a map. Keeping the rewrite INSIDE this repository is what stops that
// footgun ever reaching a call site again.

export interface TeamRepository {
  getTeam(scope: TeamScope): Promise<RunTeam | null>;
  putTeam(team: RunTeam): Promise<void>;
  /**
   * Top-level team fields only. `stages` is NOT patchable here — use the record
   * methods below, or `replaceTeamStages` when you genuinely mean to rebuild the
   * whole progress tree (run build, stage skip).
   */
  patchTeam(scope: TeamScope, patch: Patch<Omit<RunTeam, 'stages'>>): Promise<void>;
  deleteTeam(scope: TeamScope): Promise<void>;

  listTeams(scope: RunScope, page: PageRequest): Promise<Page<RunTeam>>;
  /** Every team of a run, unpaged. Bounded by `Run.maxParticipants`. */
  listAllTeams(scope: RunScope): Promise<RunTeam[]>;
  /**
   * Teams whose `activeTaskId` equals `taskId` — the station-occupancy read.
   * THIS is what makes `claimTaskSlot` able to derive occupancy instead of
   * storing a counter (see atomic.ts, and CLAUDE.md on the slot-leak class of
   * bug the stored counter kept producing).
   */
  listTeamsAtTask(scope: RunScope, taskId: string): Promise<RunTeam[]>;
  /** Count only — the same index, without materialising the rows. */
  countTeamsAtTask(scope: RunScope, taskId: string): Promise<number>;
  /** Occupancy for several tasks in one round trip, for routing's candidate set. */
  countTeamsAtTasks(scope: RunScope, taskIds: string[]): Promise<Map<string, number>>;

  // ── nested records, addressed by key ──
  getStageRecord(scope: TeamScope, stageId: string): Promise<import('./types').RunStageRecord | null>;
  patchStageRecord(scope: TeamScope, stageId: string, patch: StageRecordPatch): Promise<void>;
  getTaskRecord(scope: TeamScope, stageId: string, taskId: string): Promise<import('./types').RunTaskRecord | null>;
  patchTaskRecord(
    scope: TeamScope,
    stageId: string,
    taskId: string,
    patch: TaskRecordPatch,
  ): Promise<void>;
  /**
   * Rebuild the whole progress tree. Reserved for run build and whole-stage
   * operations; a per-task change must use `patchTaskRecord` so the SQL
   * implementation does not rewrite rows it did not change.
   */
  replaceTeamStages(scope: TeamScope, stages: import('./types').RunStageRecord[]): Promise<void>;
}


// ─── 7. Live ops sub-collections ─────────────────────────────────────────────

export interface LiveOpsRepository {
  // announcements
  putAnnouncement(scope: RunScope, a: Announcement): Promise<void>;
  patchAnnouncement(scope: RunScope, id: string, patch: Patch<Announcement>): Promise<void>;
  listAnnouncements(scope: RunScope, page: PageRequest): Promise<Page<Announcement>>;
  listActiveAnnouncements(scope: RunScope): Promise<Announcement[]>;

  // flash missions
  putFlashMission(scope: RunScope, m: FlashMission): Promise<void>;
  patchFlashMission(scope: RunScope, id: string, patch: Patch<FlashMission>): Promise<void>;
  listActiveFlashMissions(scope: RunScope, now: string): Promise<FlashMission[]>;

  // alerts
  putAlert(scope: RunScope, a: AdminAlert): Promise<void>;
  getAlert(scope: RunScope, id: string): Promise<AdminAlert | null>;
  patchAlert(scope: RunScope, id: string, patch: Patch<AdminAlert>): Promise<void>;
  listAlerts(scope: RunScope, page: PageRequest): Promise<Page<AdminAlert>>;
  /** Powers the GM overview's per-run badge. */
  countUnackedAlerts(scope: RunScope): Promise<number>;

  // team locations (last-known ping, one doc per team — overwritten)
  putTeamLocation(scope: RunScope, loc: TeamLocation): Promise<void>;
  listTeamLocations(scope: RunScope): Promise<TeamLocation[]>;

  // location breadcrumb track (append-only, PII, 90-day prune)
  appendLocationTrackPoint(scope: RunScope, p: LocationTrackPoint): Promise<void>;
  listLocationTrack(scope: RunScope, page: PageRequest): Promise<Page<LocationTrackPoint>>;

  // photo feed
  getFeedItem(scope: RunScope, id: string): Promise<FeedItem | null>;
  putFeedItem(scope: RunScope, item: FeedItem): Promise<void>;
  /**
   * Moderator hide/restore. `reactions`/`reactedBy`/`reportedBy` are NOT
   * patchable here — they move only through `applyFeedReaction` /
   * `applyFeedReport` (atomic.ts), because a tally and its source of truth must
   * change together.
   */
  patchFeedItem(
    scope: RunScope,
    id: string,
    patch: Patch<Pick<FeedItem, 'active' | 'hiddenAt' | 'hiddenBy' | 'reportsCleared'>>,
  ): Promise<void>;
  listFeedItems(scope: RunScope, page: PageRequest): Promise<Page<FeedItem>>;

  // team↔HQ chat
  getChatThread(scope: TeamScope): Promise<ChatThread | null>;
  listChatThreads(scope: RunScope): Promise<ChatThread[]>;

  // trackable movement log (append-only)
  appendTrackableLog(
    scope: RunScope,
    trackableId: string,
    entry: TrackableLogEntry,
  ): Promise<void>;
}


// ─── 8. Staff ────────────────────────────────────────────────────────────────

export interface StaffRepository {
  putStaffInvite(scope: RunScope, invite: StaffInvite): Promise<void>;
  getStaffInvite(scope: RunScope, inviteId: string): Promise<StaffInvite | null>;
  listStaffInvites(scope: RunScope): Promise<StaffInvite[]>;
  /**
   * Resolve a PIN to its invite. A PIN is short and human-typed, so this read is
   * ALWAYS paired with `consumeStaffInvite` (atomic.ts) — never trusted alone.
   */
  findStaffInviteByPin(scope: RunScope, pin: string): Promise<StaffInvite | null>;

  /**
   * The two-tier PIN brute-force lockout: one counter per caller uid and one
   * run-wide counter under the reserved key `'_run'`.
   *
   * Deliberately modelled as plain read + write, NOT as an atomic step, because
   * that is what it is today and Phase 1 is behaviour-neutral. It is safe as a
   * race precisely because it fails toward MORE lockout, never less: a lost
   * update under-counts failures by one, and the invite consume itself
   * (`consumeStaffInvite`) is the real gate. Do not "fix" it into an atom
   * without re-reading the ordering in `staffSignIn` — the order of the two
   * walls relative to the PIN lookup is a deliberate anti-oracle property.
   */
  getStaffAttempts(scope: RunScope, key: string): Promise<StaffAttemptState | null>;
  putStaffAttempts(scope: RunScope, key: string, state: StaffAttemptState): Promise<void>;
}

export interface StaffAttemptState {
  count: number;
  lastFailedAtMs: number;
  updatedAt: string;
}


// ─── 9. Stations ─────────────────────────────────────────────────────────────

export interface StationRepository {
  getStationSecret(taskId: string): Promise<StationSecret | null>;
  putStationSecret(secret: StationSecret): Promise<void>;
  deleteStationSecret(taskId: string): Promise<void>;

  getSubmission(id: string): Promise<StationSubmission | null>;
  putSubmission(s: StationSubmission): Promise<void>;
  patchSubmission(id: string, patch: Patch<StationSubmission>): Promise<void>;
  /** The staff photo-review queue: pending submissions of one run, oldest first. */
  listPendingSubmissions(scope: RunScope, page: PageRequest): Promise<Page<StationSubmission>>;
  listSubmissionsForRun(scope: RunScope, page: PageRequest): Promise<Page<StationSubmission>>;
}


// ─── 10. Feedback ────────────────────────────────────────────────────────────

export interface FeedbackRepository {
  getFeedback(scope: RunScope, uid: string): Promise<RunFeedback | null>;
  listFeedback(scope: RunScope, page: PageRequest): Promise<Page<RunFeedback>>;
}


// ─── 11. Trackables, zones, consent tokens ───────────────────────────────────

export interface RunObjectRepository {
  getTrackable(scope: RunScope, id: string): Promise<Trackable | null>;
  putTrackable(scope: RunScope, t: Trackable): Promise<void>;
  listTrackables(scope: RunScope): Promise<Trackable[]>;

  getZone(scope: RunScope, id: string): Promise<Zone | null>;
  putZone(scope: RunScope, z: Zone): Promise<void>;
  deleteZone(scope: RunScope, id: string): Promise<void>;
  listZones(scope: RunScope): Promise<Zone[]>;

  getConsentToken(scope: RunScope, token: string): Promise<ConsentToken | null>;
  putConsentToken(scope: RunScope, t: ConsentToken): Promise<void>;
}


// ─── 12. Cross-run aggregates ────────────────────────────────────────────────

export interface AggregateRepository {
  getBenchmark(type: string): Promise<BenchmarkDoc | null>;
  getPlayerProfile(uid: string): Promise<PlayerProfileDoc | null>;
}


// ─── 13. Audit ───────────────────────────────────────────────────────────────
//
// Append-only by contract. There is no patch and no delete: an audit trail you
// can edit is not an audit trail. (`firestore.rules` already denies both; the
// interface makes it unrepresentable rather than merely forbidden.)

export interface AuditRepository {
  appendAuditLog(entry: AuditLogEntry): Promise<void>;
  listAuditLogsForRun(scope: RunScope, page: PageRequest): Promise<Page<AuditLogEntry>>;
  listAuditLogsForOwner(ownerUid: string, page: PageRequest): Promise<Page<AuditLogEntry>>;
}


// ─── 14. Sweeps — bounded, resumable, and NOT atomic ─────────────────────────
//
// Every one of these can touch an unbounded number of documents, so none of them
// can be a transaction and none of them may be run inside one. They are
// explicitly PAGED and RESUMABLE: a sweep returns how much it did and a cursor,
// and the operator script (or the scheduler) drives it to completion.
//
// This mirrors the existing `chunk` / `deleteDocsInChunks` discipline
// (functions/src/batchUtil.ts, MAX_BATCH_OPS = 450) — a Firestore WriteBatch is
// capped at 500 ops, and hand-rolled batch loops are how that cap gets hit in
// production. The interface takes the cap away from the caller.

export interface SweepResult {
  /** Documents actually written/deleted by this call. */
  affected: number;
  /** Absent when the sweep is finished. */
  nextCursor?: Cursor;
}

export interface SweepBudget {
  /** Hard ceiling on documents this call may touch. Implementations MUST honour it. */
  maxDocs: number;
  cursor?: Cursor;
}

export interface SweepRepository {
  /** Delete a run's PII sub-collections (locationTrack, teamLocations, feedItems, chat, feedback). */
  sweepRunPii(scope: RunScope, budget: SweepBudget): Promise<SweepResult>;
  /** Delete an entire run subtree (teams + every sub-collection + the run doc). */
  sweepRunSubtree(scope: RunScope, budget: SweepBudget): Promise<SweepResult>;
  /** Delete an entire game subtree (runs + publicTasks + codes are handled by the caller). */
  sweepGameSubtree(scope: GameScope, budget: SweepBudget): Promise<SweepResult>;
  /** Delete every document under a creator (account deletion). */
  sweepUserSubtree(uid: string, budget: SweepBudget): Promise<SweepResult>;
  /**
   * Rewrite legacy `publicTasks` documents to the current projection contract.
   * `repair` is PURE and is applied per document; returning `null` skips it.
   */
  sweepPublicTaskProjection(
    budget: SweepBudget,
    repair: (task: PublicTask) => Patch<PublicTask> | null,
  ): Promise<SweepResult>;
}


// ─── The whole thing ─────────────────────────────────────────────────────────

/**
 * The read/write surface available BOTH inside and outside a transaction.
 *
 * Note what is missing: `SweepRepository` (unbounded — see rule 5 in
 * transaction.ts) and every paged `list*` whose backing query Firestore cannot
 * run transactionally. Those live on `Repository` only. This split is not
 * cosmetic: it is the type system refusing to let someone page a collection
 * inside a transaction body that may re-execute.
 */
export interface TransactionalRepository extends
  UserRepository,
  WalletRepository,
  GameRepository,
  PublicRepository,
  AccessCodeRepository,
  RunRepository,
  TeamRepository,
  LiveOpsRepository,
  StaffRepository,
  StationRepository,
  FeedbackRepository,
  RunObjectRepository,
  AggregateRepository,
  AuditRepository,
  AtomicOperations {}

/**
 * The full repository. Implementations expose this; callers depend on it and on
 * nothing below it.
 */
export interface Repository extends TransactionalRepository, SweepRepository {
  /**
   * Run several operations atomically. READ THE CONTRACT in transaction.ts
   * before using it — in particular, the body may execute more than once.
   *
   * The `tx` handed to the body is used by passing it as the FIRST argument to
   * `withTx`, which returns a `TransactionalRepository` bound to it:
   *
   *   await repo.runInTransaction(async (tx) => {
   *     const r = repo.withTx(tx);
   *     const run = await r.getRun(scope);
   *     if (!run) throw new DataError('not-found', 'run');
   *     await r.patchRun(scope, { status: 'finished', finishedAt: nowIso });
   *     return run.accessCode;              // ← the only channel out
   *   });
   */
  runInTransaction: RunInTransaction;

  /** Bind the repository surface to a transaction. See `runInTransaction`. */
  withTx(tx: import('./transaction').Tx): TransactionalRepository;
}
