// ─── FirestoreRepository — the behaviour-neutral Firestore implementation ────
//
// Phase 1 mirrors what `functions/src` does TODAY. Where today's code is
// surprising, this file reproduces the surprise and comments it; it does not fix
// it. Fixes belong in separate, reviewed changes — otherwise "did the migration
// break it?" becomes unanswerable.
//
// FULLY IMPLEMENTED here: users · wallets (+transactions) · games (+discovery
// POIs) · runs · accessCodes · auditLogs.
//
// EVERYTHING ELSE throws `notImplemented(<method>)`. Deliberately: a stub that
// returned `null`, `[]` or `undefined` would let a caller proceed on data that
// is not merely stale but FABRICATED — an empty team list reads as "nobody
// joined", an empty occupancy count reads as "the station is free". A throw
// naming the method is the only safe placeholder.
//
// See README.md in this directory for the implemented/stubbed table and the
// rules a Postgres implementation has to match.

import {
  DataError,
  type AccessCode,
  type AdminAlert,
  type Announcement,
  type AuditLogEntry,
  type Cursor,
  type FeedItem,
  type FlashMission,
  type Game,
  type GameScope,
  type Page,
  type PageRequest,
  type Patch,
  type PublicGame,
  type PublicLike,
  type PublicTask,
  type RateBudget,
  type Run,
  type RunFeedback,
  type RunScope,
  type RunStageRecord,
  type RunTaskRecord,
  type RunTeam,
  type SortDir,
  type StaffInvite,
  type StageRecordPatch,
  type StationStatus,
  type StationSubmission,
  type TaskRecordPatch,
  type TeamLocation,
  type TeamScope,
  type Wallet,
  type WalletTransaction,
  type WindowState,
} from '../types';
import type { Tx, TxBody, TransactionOptions, Outcome } from '../transaction';
import type {
  AggregateRepository,
  AuditRepository,
  BenchmarkDoc,
  ChatMessage,
  ChatThread,
  ConsentToken,
  CreatorProfile,
  DiscoveryPoi,
  FeedbackRepository,
  LiveOpsRepository,
  LocationTrackPoint,
  PlayerProfileDoc,
  PublicSearchQuery,
  Repository,
  RunObjectRepository,
  StaffAttemptState,
  StationSecret,
  StationRepository,
  SweepBudget,
  SweepResult,
  Trackable,
  TrackableLogEntry,
  TransactionalRepository,
  Zone,
} from '../repository';
import type {
  AtomicOperations,
  ClaimActiveTaskResult,
  ClaimTaskSlotResult,
  CompleteTeamTaskResult,
  TaskCompletionWrite,
  TaskSlotCandidate,
  SlotChooser,
} from '../atomic';

import { deletedGames, visibleGames } from '@rushpoint/shared';

import {
  FirestoreContext,
  guard,
  type FirestoreDeps,
  type FsDocumentData,
  type FsDocumentReference,
  type FsDocumentSnapshot,
  type FsQuery,
  type FsQueryDocumentSnapshot,
  type FsQuerySnapshot,
  type FsTransaction,
} from './context';
import { colPaths, docPaths, groupIds } from './paths';
import { isEmptyPatch, toDocumentData, toUpdateData } from './patch';
import { makeRunInTransaction, unwrapTx } from './transaction';


// ═══════════════════════════════════════════════════════════════════════════
// Batching — the 500-op cap, taken away from the caller
// ═══════════════════════════════════════════════════════════════════════════
//
// Mirrors `functions/src/batchUtil.ts`. A Firestore WriteBatch is hard-capped at
// 500 operations; a sweep over an unbounded sub-collection (a run's
// `teamLocations` GPS pings number in the thousands) that hand-rolls a batch
// loop throws on commit and aborts the whole operation. Every sweep in this
// implementation must go through these.

/** Firestore hard-caps a WriteBatch at 500 ops; leave margin for safety. */
export const MAX_BATCH_OPS = 450;

/** Split `items` into ordered groups of at most `size`. Pure. Throws if size < 1. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new DataError('failed-precondition', 'chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}


// ═══════════════════════════════════════════════════════════════════════════
// Cursors
// ═══════════════════════════════════════════════════════════════════════════
//
// A `Cursor` is opaque to callers by contract, so its encoding is this file's
// business alone. It carries the ORDER-KEY VALUES of the last document of the
// page, which is what `startAfter` consumes.
//
// It is plain JSON rather than base64 on purpose: `btoa` lives in `lib.dom` and
// `Buffer` needs `@types/node`, and this package's real build config
// (tsconfig.json) has NEITHER. A dependency-free package cannot afford an
// encoding that only compiles under one of its two tsconfigs.

function encodeCursor(values: unknown[]): Cursor {
  return JSON.stringify(values) as Cursor;
}

function decodeCursor(cursor: Cursor | undefined, what: string): unknown[] | null {
  if (cursor === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(cursor as unknown as string);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch (e) {
    throw new DataError('failed-precondition', `${what}: malformed cursor`, {
      cause: String((e as Error).message),
    });
  }
}

interface OrderSpec {
  field: string;
  dir: SortDir;
}


// ═══════════════════════════════════════════════════════════════════════════
// I/O — the one seam between "inside a transaction" and "outside" one
// ═══════════════════════════════════════════════════════════════════════════
//
// Every read and write in this file goes through an `Io`. Bound to the database
// it performs the operation directly; bound to a `Tx` it routes through
// `tx.get/set/update/delete`. That is what makes the transactional and
// non-transactional method surfaces literally the same code — the contract
// requires the signatures to be identical, and sharing the implementation is the
// only way to guarantee the BEHAVIOUR is too.

interface Io {
  readonly inTransaction: boolean;
  getDoc(ref: FsDocumentReference): Promise<FsDocumentSnapshot>;
  getQuery(query: FsQuery): Promise<FsQuerySnapshot>;
  set(ref: FsDocumentReference, data: FsDocumentData, options?: { merge?: boolean }): Promise<void>;
  update(ref: FsDocumentReference, data: FsDocumentData): Promise<void>;
  del(ref: FsDocumentReference): Promise<void>;
}

const directIo: Io = {
  inTransaction: false,
  getDoc: (ref) => ref.get(),
  getQuery: (query) => query.get(),
  set: async (ref, data, options) => { await ref.set(data, options); },
  update: async (ref, data) => { await ref.update(data); },
  del: async (ref) => { await ref.delete(); },
};

function txIo(tx: FsTransaction): Io {
  return {
    inTransaction: true,
    getDoc: (ref) => tx.get(ref),
    getQuery: (query) => tx.get(query),
    // Firestore's transaction writes are synchronous and buffered until commit;
    // they are wrapped in resolved promises so call sites are identical.
    set: async (ref, data, options) => { tx.set(ref, data, options); },
    update: async (ref, data) => { tx.update(ref, data); },
    del: async (ref) => { tx.delete(ref); },
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// Stubs
// ═══════════════════════════════════════════════════════════════════════════

const IMPLEMENTED_AGGREGATES =
  'users, wallets(+transactions), games(+discoveryPois), runs, accessCodes, auditLogs';

/**
 * Refuse loudly for anything outside the Phase-1 slice.
 *
 * NEVER return an empty/undefined result instead. A silent empty answer is
 * indistinguishable from a true one at the call site, so a caller would proceed
 * on fabricated data — an empty team list reads as "nobody joined", a zero
 * occupancy count reads as "this station is free". A throw naming the method is
 * the only honest placeholder.
 */
function notImplemented(method: string): never {
  throw new DataError(
    'failed-precondition',
    `FirestoreRepository.${method}() is not implemented. ` +
      `Phase 1 implements: ${IMPLEMENTED_AGGREGATES}.`,
    { method },
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// The bound repository (works identically inside and outside a transaction)
// ═══════════════════════════════════════════════════════════════════════════

class BoundFirestoreRepository implements TransactionalRepository {
  constructor(
    protected readonly ctx: FirestoreContext,
    protected readonly io: Io,
  ) {}

  // ── low-level helpers ───────────────────────────────────────────────────

  protected doc(path: string): FsDocumentReference {
    return this.ctx.db.doc(path);
  }

  protected async readDoc<T>(path: string, what: string): Promise<T | null> {
    return guard(what, async () => {
      const snap = await this.io.getDoc(this.doc(path));
      if (!snap.exists) return null;
      const data = snap.data();
      return (data === undefined ? null : (data as unknown as T));
    });
  }

  /** Whole-document create-or-replace. `put*` semantics. */
  protected async writeDoc(path: string, value: object, what: string): Promise<void> {
    const data = toDocumentData(value as Record<string, unknown>, what);
    await guard(what, () => this.io.set(this.doc(path), data));
  }

  /**
   * Three-valued patch. See patch.ts for why this is `.update()` and why an
   * empty patch is a no-op rather than an empty update (which would still throw
   * NOT_FOUND on a missing document).
   */
  protected async patchDoc(
    path: string,
    patch: Record<string, unknown> | undefined,
    what: string,
  ): Promise<void> {
    const data = toUpdateData(patch, this.ctx.deleteSentinel, what);
    if (data === null) return;
    await guard(what, () => this.io.update(this.doc(path), data));
  }

  protected async deleteDoc(path: string, what: string): Promise<void> {
    await guard(what, () => this.io.del(this.doc(path)));
  }

  /** Keyset-paged query. Order fields must be stored fields; ids are not synthesised. */
  protected async pageQuery<T>(
    base: FsQuery,
    order: OrderSpec[],
    req: PageRequest,
    what: string,
    postFilter?: (item: T) => boolean,
  ): Promise<Page<T>> {
    return guard(what, async () => {
      const limit = Math.max(1, Math.floor(req.limit));
      let q = base;
      for (const o of order) q = q.orderBy(o.field, o.dir);
      const after = decodeCursor(req.cursor, what);
      if (after) q = q.startAfter(...after);
      const snap = await this.io.getQuery(q.limit(limit));

      const raw = snap.docs;
      const items = raw.map((d) => d.data() as unknown as T);
      const filtered = postFilter ? items.filter(postFilter) : items;

      // The cursor comes from the last RAW document, not the last SURVIVING one:
      // a post-filtered page can legitimately be shorter than `limit` (or empty)
      // while more pages remain, and resuming from a filtered-out document would
      // skip everything between it and the next survivor.
      const page: Page<T> = { items: filtered };
      if (raw.length === limit) {
        const last = raw[raw.length - 1] as FsQueryDocumentSnapshot;
        const data = last.data();
        page.nextCursor = encodeCursor(order.map((o) => data[o.field] ?? null));
      }
      return page;
    });
  }

  protected async listAll<T>(base: FsQuery, what: string): Promise<T[]> {
    return guard(what, async () => {
      const snap = await this.io.getQuery(base);
      return snap.docs.map((d) => d.data() as unknown as T);
    });
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 1. Users
  // ═════════════════════════════════════════════════════════════════════════

  async getProfile(uid: string): Promise<CreatorProfile | null> {
    return this.readDoc<CreatorProfile>(docPaths.user(uid), 'getProfile');
  }

  async putProfile(profile: CreatorProfile): Promise<void> {
    await this.writeDoc(docPaths.user(profile.uid), profile, 'putProfile');
  }

  async patchProfile(uid: string, patch: Patch<CreatorProfile>): Promise<void> {
    await this.patchDoc(docPaths.user(uid), patch as Record<string, unknown>, 'patchProfile');
  }

  /**
   * Deletes ONLY the `users/{uid}` document. Its sub-collections (games, and
   * everything below them) survive a document delete in Firestore and are the
   * job of `sweepUserSubtree` — which is why account deletion is a caller-driven
   * sequence, exactly as `deleteMyAccount` performs it today.
   */
  async deleteProfile(uid: string): Promise<void> {
    await this.deleteDoc(docPaths.user(uid), 'deleteProfile');
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 2. Wallets
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * NOTE the behavioural boundary: today's `getWallet` CALLABLE creates a fresh
   * wallet when none exists (`freshWallet(uid)` in functions/src/payments). That
   * is a policy — what an empty wallet looks like — and it stays in the callable
   * layer. The repository reports the truth: `null` means no document.
   */
  async getWallet(uid: string): Promise<Wallet | null> {
    return this.readDoc<Wallet>(docPaths.wallet(uid), 'getWallet');
  }

  async putWallet(wallet: Wallet): Promise<void> {
    await this.writeDoc(docPaths.wallet(wallet.uid), wallet, 'putWallet');
  }

  async patchWallet(uid: string, patch: Patch<Wallet>): Promise<void> {
    await this.patchDoc(docPaths.wallet(uid), patch as Record<string, unknown>, 'patchWallet');
  }

  /**
   * The transaction's `id` is the DOCUMENT id.
   *
   * Today's payments code mints it with `collection('transactions').doc()` and
   * copies the generated id into the row. Here the id is caller-supplied
   * (types.ts rule 2 / README rule 2): a Firestore transaction body may
   * re-execute, and an id minted inside it would orphan the previous attempt's
   * ledger row — an unauditable balance change, which is the one thing a ledger
   * exists to prevent.
   */
  async appendTransaction(uid: string, tx: WalletTransaction): Promise<void> {
    if (!tx?.id) {
      throw new DataError(
        'failed-precondition',
        'appendTransaction: WalletTransaction.id is required (ids come from the caller)',
      );
    }
    await this.writeDoc(docPaths.walletTransaction(uid, tx.id), tx, 'appendTransaction');
  }

  async listTransactions(uid: string, page: PageRequest): Promise<Page<WalletTransaction>> {
    return this.pageQuery<WalletTransaction>(
      this.ctx.db.collection(colPaths.walletTransactions(uid)),
      [{ field: 'createdAt', dir: 'desc' }],
      page,
      'listTransactions',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 3. Games
  // ═════════════════════════════════════════════════════════════════════════

  async getGame(scope: GameScope): Promise<Game | null> {
    return this.readDoc<Game>(docPaths.game(scope), 'getGame');
  }

  async putGame(game: Game): Promise<void> {
    await this.writeDoc(
      docPaths.game({ ownerUid: game.ownerUid, gameId: game.id }),
      game,
      'putGame',
    );
  }

  /**
   * `stages` in the patch REPLACES the whole array (Phase-1 blob contract). That
   * is also the only safe way to write it: a dotted-path update into an array
   * element (`stages.0.tasks.0`) coerces the array into a map and breaks the run
   * — a footgun this repo has already shipped once (CLAUDE.md).
   */
  async patchGame(scope: GameScope, patch: Patch<Game>): Promise<void> {
    await this.patchDoc(docPaths.game(scope), patch as Record<string, unknown>, 'patchGame');
  }

  /**
   * Deletes ONLY the game document.
   *
   * Firestore sub-collections outlive their parent document, so the runs subtree
   * survives this call — matching `purgeGameTree`, which explicitly deletes the
   * subtree, the `publicGames`/`publicTasks` projection, the access codes and
   * the Storage objects before removing the document. Those are five systems and
   * the caller orchestrates them (`sweepGameSubtree`, `deletePublicTasksForGame`,
   * `deleteAccessCode`); this method is the last step, not the whole thing.
   */
  async deleteGame(scope: GameScope): Promise<void> {
    await this.deleteDoc(docPaths.game(scope), 'deleteGame');
  }

  /**
   * Live games, newest first, WITH THE TOMBSTONE FILTER IN MEMORY.
   *
   * That is deliberate and matches `listGames` in functions/src/games/index.ts:
   * Firestore's `where('deletedAt','==',null)` does NOT match documents that
   * LACK the field, and absence is the normal state for every game ever created
   * before soft delete existed. A server-side filter would silently hide every
   * one of them until a backfill wrote `deletedAt: null` onto all of them.
   *
   * Consequence a caller must expect: a page may contain FEWER than `limit`
   * items (even zero) while `nextCursor` is still present. `nextCursor` is the
   * only end-of-data signal; `items.length` is not.
   */
  async listGames(ownerUid: string, page: PageRequest): Promise<Page<Game>> {
    const res = await this.pageQuery<Game>(
      this.ctx.db.collection(colPaths.games(ownerUid)),
      [{ field: 'updatedAt', dir: 'desc' }],
      page,
      'listGames',
    );
    return { ...res, items: visibleGames(res.items) };
  }

  /** Tombstoned games (the Trash screen). Same in-memory filter, inverted. */
  async listDeletedGames(ownerUid: string, page: PageRequest): Promise<Page<Game>> {
    const res = await this.pageQuery<Game>(
      this.ctx.db.collection(colPaths.games(ownerUid)),
      [{ field: 'updatedAt', dir: 'desc' }],
      page,
      'listDeletedGames',
    );
    return { ...res, items: deletedGames(res.items) };
  }

  async getDiscoveryPoi(scope: GameScope, poiId: string): Promise<DiscoveryPoi | null> {
    return this.readDoc<DiscoveryPoi>(docPaths.discoveryPoi(scope, poiId), 'getDiscoveryPoi');
  }

  async putDiscoveryPoi(scope: GameScope, poi: DiscoveryPoi): Promise<void> {
    await this.writeDoc(docPaths.discoveryPoi(scope, poi.id), poi, 'putDiscoveryPoi');
  }

  async deleteDiscoveryPoi(scope: GameScope, poiId: string): Promise<void> {
    await this.deleteDoc(docPaths.discoveryPoi(scope, poiId), 'deleteDiscoveryPoi');
  }

  /** Unpaged: a game's POI set is authored by hand and bounded by the Builder. */
  async listDiscoveryPois(scope: GameScope): Promise<DiscoveryPoi[]> {
    return this.listAll<DiscoveryPoi>(
      this.ctx.db.collection(colPaths.discoveryPois(scope)),
      'listDiscoveryPois',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 4. Access codes
  // ═════════════════════════════════════════════════════════════════════════

  async getAccessCode(code: string): Promise<AccessCode | null> {
    return this.readDoc<AccessCode>(docPaths.accessCode(code), 'getAccessCode');
  }

  async patchAccessCode(code: string, patch: Patch<AccessCode>): Promise<void> {
    await this.patchDoc(
      docPaths.accessCode(code),
      patch as Record<string, unknown>,
      'patchAccessCode',
    );
  }

  async deleteAccessCode(code: string): Promise<void> {
    await this.deleteDoc(docPaths.accessCode(code), 'deleteAccessCode');
  }

  /**
   * Needs the (ownerUid, gameId) composite index — the same one
   * `gameAccessCodes` in functions/src/games/index.ts already relies on.
   * Unpaged, matching today: a game's codes are one per run.
   */
  async listAccessCodesForGame(scope: GameScope): Promise<AccessCode[]> {
    return this.listAll<AccessCode>(
      this.ctx.db
        .collection(colPaths.accessCodes())
        .where('ownerUid', '==', scope.ownerUid)
        .where('gameId', '==', scope.gameId),
      'listAccessCodesForGame',
    );
  }

  async listAccessCodesForRun(scope: RunScope): Promise<AccessCode[]> {
    return this.listAll<AccessCode>(
      this.ctx.db
        .collection(colPaths.accessCodes())
        .where('ownerUid', '==', scope.ownerUid)
        .where('gameId', '==', scope.gameId)
        .where('runId', '==', scope.runId),
      'listAccessCodesForRun',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 5. Runs
  // ═════════════════════════════════════════════════════════════════════════

  async getRun(scope: RunScope): Promise<Run | null> {
    return this.readDoc<Run>(docPaths.run(scope), 'getRun');
  }

  async putRun(run: Run): Promise<void> {
    await this.writeDoc(
      docPaths.run({ ownerUid: run.ownerUid, gameId: run.gameId, runId: run.id }),
      run,
      'putRun',
    );
  }

  /**
   * `taskStatusOverrides` is a whole-map replace when present, never a dotted
   * update: task ids are opaque, user-influenced strings and are not safe as
   * field paths (patch.ts rejects them outright).
   */
  async patchRun(scope: RunScope, patch: Patch<Run>): Promise<void> {
    await this.patchDoc(docPaths.run(scope), patch as Record<string, unknown>, 'patchRun');
  }

  /** Document only — the teams and live-ops sub-collections are `sweepRunSubtree`. */
  async deleteRun(scope: RunScope): Promise<void> {
    await this.deleteDoc(docPaths.run(scope), 'deleteRun');
  }

  async listRunsForGame(scope: GameScope, page: PageRequest): Promise<Page<Run>> {
    return this.pageQuery<Run>(
      this.ctx.db.collection(colPaths.runs(scope)),
      [{ field: 'createdAt', dir: 'desc' }],
      page,
      'listRunsForGame',
    );
  }

  /**
   * Collection-GROUP query across every game of this owner, exactly as
   * `listLiveRuns` does today.
   *
   * PRESERVED ODDITY: it does NOT exclude runs whose GAME is tombstoned. Today's
   * callable filters those out afterwards, by loading each game document — a
   * collection-group query cannot reach the parent game to filter on it. That
   * enrichment stays in the caller, so this method returns the raw set.
   */
  async listLiveRunsForOwner(ownerUid: string): Promise<Run[]> {
    return this.listAll<Run>(
      this.ctx.db
        .collectionGroup(groupIds.runs)
        .where('ownerUid', '==', ownerUid)
        .where('status', '==', 'live'),
      'listLiveRunsForOwner',
    );
  }

  /**
   * Finished runs older than `finishedBefore`, oldest first.
   *
   * This is query A of the retention sweep (functions/src/maintenance/index.ts)
   * and needs the same `runs` collection-group composite index. The `orderBy`
   * is explicit here because a keyset cursor needs a deterministic order;
   * Firestore already orders implicitly by the inequality field, so this changes
   * nothing but names it.
   *
   * NOT INCLUDED: the sweep's query B (abandoned/stale runs by `createdAt`).
   * That is a different named shape and the interface does not have it yet — a
   * caller driving the full prune composes both, and adding B silently here
   * would widen what a Postgres implementation must promise.
   */
  async listFinishedRunsBefore(finishedBefore: string, page: PageRequest): Promise<Page<Run>> {
    return this.pageQuery<Run>(
      this.ctx.db
        .collectionGroup(groupIds.runs)
        .where('status', '==', 'finished')
        .where('finishedAt', '<', finishedBefore),
      [{ field: 'finishedAt', dir: 'asc' }],
      page,
      'listFinishedRunsBefore',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 13. Audit — append-only, by contract and by rules
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Append one audit row at `auditLogs/{entry.id}`.
   *
   * TWO DELIBERATE DIFFERENCES FROM `writeAuditLog` (functions/src/obs/audit.ts),
   * both forced by this package's rules rather than by taste:
   *
   *   1. It mints the id with `.add()`. Here the id is caller-supplied (rule 2).
   *   2. It stamps `timestamp: new Date().toISOString()` itself, and normalises
   *      `teamName`/`previousValue`/`newValue` to `null` and `reason` to `''`.
   *      Here the entry is stored EXACTLY as handed over (rule 1: never invent a
   *      timestamp). The normalisation is presentation policy and belongs with
   *      the caller that already owns `AuditEntry`.
   *
   * BEST-EFFORT IS THE CALLER'S JOB, not this method's: `auditBestEffort` wraps
   * the write in a try/catch so a failed audit never aborts the user's action.
   * That wrapper stays where it is — swallowing the error here would also
   * swallow a misconfiguration.
   */
  async appendAuditLog(entry: AuditLogEntry): Promise<void> {
    if (!entry?.id) {
      throw new DataError(
        'failed-precondition',
        'appendAuditLog: AuditLogEntry.id is required (ids come from the caller)',
      );
    }
    await this.writeDoc(docPaths.auditLog(entry.id), entry, 'appendAuditLog');
  }

  /** Needs a (runId, timestamp) composite index — a NEW query shape, see README. */
  async listAuditLogsForRun(scope: RunScope, page: PageRequest): Promise<Page<AuditLogEntry>> {
    return this.pageQuery<AuditLogEntry>(
      this.ctx.db.collection(colPaths.auditLogs()).where('runId', '==', scope.runId),
      [{ field: 'timestamp', dir: 'desc' }],
      page,
      'listAuditLogsForRun',
    );
  }

  /** Needs an (ownerUid, timestamp) composite index — also a NEW shape. */
  async listAuditLogsForOwner(ownerUid: string, page: PageRequest): Promise<Page<AuditLogEntry>> {
    return this.pageQuery<AuditLogEntry>(
      this.ctx.db.collection(colPaths.auditLogs()).where('ownerUid', '==', ownerUid),
      [{ field: 'timestamp', dir: 'desc' }],
      page,
      'listAuditLogsForOwner',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // NOT IMPLEMENTED — Phase 1 scope boundary. Every one of these THROWS.
  // ═════════════════════════════════════════════════════════════════════════

  // ── 3. Public gallery projection ────────────────────────────────────────
  async getPublicGame(_gameId: string): Promise<PublicGame | null> {
    return notImplemented('getPublicGame');
  }
  async putPublicGame(_game: PublicGame): Promise<void> {
    return notImplemented('putPublicGame');
  }
  async deletePublicGame(_gameId: string): Promise<void> {
    return notImplemented('deletePublicGame');
  }
  async getPublicTask(_publicTaskId: string): Promise<PublicTask | null> {
    return notImplemented('getPublicTask');
  }
  async replacePublicTasksForGame(
    _gameId: string,
    _tasks: PublicTask[],
    _carryForward: (next: PublicTask, prior: PublicTask | null) => PublicTask,
  ): Promise<void> {
    return notImplemented('replacePublicTasksForGame');
  }
  async deletePublicTasksForGame(_gameId: string): Promise<void> {
    return notImplemented('deletePublicTasksForGame');
  }
  async searchPublicGames(_q: PublicSearchQuery): Promise<Page<PublicGame>> {
    return notImplemented('searchPublicGames');
  }
  async searchPublicTasks(_q: PublicSearchQuery): Promise<Page<PublicTask>> {
    return notImplemented('searchPublicTasks');
  }
  async getPublicLike(
    _kind: 'game' | 'task',
    _itemId: string,
    _uid: string,
  ): Promise<PublicLike | null> {
    return notImplemented('getPublicLike');
  }
  async listLikedItemIds(
    _kind: 'game' | 'task',
    _uid: string,
    _itemIds: string[],
  ): Promise<string[]> {
    return notImplemented('listLikedItemIds');
  }
  async scanPublicTasks(_page: PageRequest): Promise<Page<PublicTask>> {
    return notImplemented('scanPublicTasks');
  }
  async getTagStats(): Promise<Record<string, number>> {
    return notImplemented('getTagStats');
  }

  // ── 6. Teams ────────────────────────────────────────────────────────────
  async getTeam(_scope: TeamScope): Promise<RunTeam | null> {
    return notImplemented('getTeam');
  }
  async putTeam(_team: RunTeam): Promise<void> {
    return notImplemented('putTeam');
  }
  async patchTeam(_scope: TeamScope, _patch: Patch<Omit<RunTeam, 'stages'>>): Promise<void> {
    return notImplemented('patchTeam');
  }
  async deleteTeam(_scope: TeamScope): Promise<void> {
    return notImplemented('deleteTeam');
  }
  async listTeams(_scope: RunScope, _page: PageRequest): Promise<Page<RunTeam>> {
    return notImplemented('listTeams');
  }
  async listAllTeams(_scope: RunScope): Promise<RunTeam[]> {
    return notImplemented('listAllTeams');
  }
  async listTeamsAtTask(_scope: RunScope, _taskId: string): Promise<RunTeam[]> {
    return notImplemented('listTeamsAtTask');
  }
  async countTeamsAtTask(_scope: RunScope, _taskId: string): Promise<number> {
    return notImplemented('countTeamsAtTask');
  }
  async countTeamsAtTasks(_scope: RunScope, _taskIds: string[]): Promise<Map<string, number>> {
    return notImplemented('countTeamsAtTasks');
  }
  async getStageRecord(_scope: TeamScope, _stageId: string): Promise<RunStageRecord | null> {
    return notImplemented('getStageRecord');
  }
  async patchStageRecord(
    _scope: TeamScope,
    _stageId: string,
    _patch: StageRecordPatch,
  ): Promise<void> {
    return notImplemented('patchStageRecord');
  }
  async getTaskRecord(
    _scope: TeamScope,
    _stageId: string,
    _taskId: string,
  ): Promise<RunTaskRecord | null> {
    return notImplemented('getTaskRecord');
  }
  async patchTaskRecord(
    _scope: TeamScope,
    _stageId: string,
    _taskId: string,
    _patch: TaskRecordPatch,
  ): Promise<void> {
    return notImplemented('patchTaskRecord');
  }
  async replaceTeamStages(_scope: TeamScope, _stages: RunStageRecord[]): Promise<void> {
    return notImplemented('replaceTeamStages');
  }

  // ── 7. Live ops ─────────────────────────────────────────────────────────
  async putAnnouncement(_scope: RunScope, _a: Announcement): Promise<void> {
    return notImplemented('putAnnouncement');
  }
  async patchAnnouncement(
    _scope: RunScope,
    _id: string,
    _patch: Patch<Announcement>,
  ): Promise<void> {
    return notImplemented('patchAnnouncement');
  }
  async listAnnouncements(_scope: RunScope, _page: PageRequest): Promise<Page<Announcement>> {
    return notImplemented('listAnnouncements');
  }
  async listActiveAnnouncements(_scope: RunScope): Promise<Announcement[]> {
    return notImplemented('listActiveAnnouncements');
  }
  async putFlashMission(_scope: RunScope, _m: FlashMission): Promise<void> {
    return notImplemented('putFlashMission');
  }
  async patchFlashMission(
    _scope: RunScope,
    _id: string,
    _patch: Patch<FlashMission>,
  ): Promise<void> {
    return notImplemented('patchFlashMission');
  }
  async listActiveFlashMissions(_scope: RunScope, _now: string): Promise<FlashMission[]> {
    return notImplemented('listActiveFlashMissions');
  }
  async putAlert(_scope: RunScope, _a: AdminAlert): Promise<void> {
    return notImplemented('putAlert');
  }
  async getAlert(_scope: RunScope, _id: string): Promise<AdminAlert | null> {
    return notImplemented('getAlert');
  }
  async patchAlert(_scope: RunScope, _id: string, _patch: Patch<AdminAlert>): Promise<void> {
    return notImplemented('patchAlert');
  }
  async listAlerts(_scope: RunScope, _page: PageRequest): Promise<Page<AdminAlert>> {
    return notImplemented('listAlerts');
  }
  async countUnackedAlerts(_scope: RunScope): Promise<number> {
    return notImplemented('countUnackedAlerts');
  }
  async putTeamLocation(_scope: RunScope, _loc: TeamLocation): Promise<void> {
    return notImplemented('putTeamLocation');
  }
  async listTeamLocations(_scope: RunScope): Promise<TeamLocation[]> {
    return notImplemented('listTeamLocations');
  }
  async appendLocationTrackPoint(_scope: RunScope, _p: LocationTrackPoint): Promise<void> {
    return notImplemented('appendLocationTrackPoint');
  }
  async listLocationTrack(
    _scope: RunScope,
    _page: PageRequest,
  ): Promise<Page<LocationTrackPoint>> {
    return notImplemented('listLocationTrack');
  }
  async getFeedItem(_scope: RunScope, _id: string): Promise<FeedItem | null> {
    return notImplemented('getFeedItem');
  }
  async putFeedItem(_scope: RunScope, _item: FeedItem): Promise<void> {
    return notImplemented('putFeedItem');
  }
  async patchFeedItem(
    _scope: RunScope,
    _id: string,
    _patch: Patch<Pick<FeedItem, 'active' | 'hiddenAt' | 'hiddenBy' | 'reportsCleared'>>,
  ): Promise<void> {
    return notImplemented('patchFeedItem');
  }
  async listFeedItems(_scope: RunScope, _page: PageRequest): Promise<Page<FeedItem>> {
    return notImplemented('listFeedItems');
  }
  async getChatThread(_scope: TeamScope): Promise<ChatThread | null> {
    return notImplemented('getChatThread');
  }
  async listChatThreads(_scope: RunScope): Promise<ChatThread[]> {
    return notImplemented('listChatThreads');
  }
  async appendTrackableLog(
    _scope: RunScope,
    _trackableId: string,
    _entry: TrackableLogEntry,
  ): Promise<void> {
    return notImplemented('appendTrackableLog');
  }

  // ── 8. Staff ────────────────────────────────────────────────────────────
  async putStaffInvite(_scope: RunScope, _invite: StaffInvite): Promise<void> {
    return notImplemented('putStaffInvite');
  }
  async getStaffInvite(_scope: RunScope, _inviteId: string): Promise<StaffInvite | null> {
    return notImplemented('getStaffInvite');
  }
  async listStaffInvites(_scope: RunScope): Promise<StaffInvite[]> {
    return notImplemented('listStaffInvites');
  }
  async findStaffInviteByPin(_scope: RunScope, _pin: string): Promise<StaffInvite | null> {
    return notImplemented('findStaffInviteByPin');
  }
  async getStaffAttempts(_scope: RunScope, _key: string): Promise<StaffAttemptState | null> {
    return notImplemented('getStaffAttempts');
  }
  async putStaffAttempts(
    _scope: RunScope,
    _key: string,
    _state: StaffAttemptState,
  ): Promise<void> {
    return notImplemented('putStaffAttempts');
  }

  // ── 9. Stations ─────────────────────────────────────────────────────────
  async getStationSecret(_taskId: string): Promise<StationSecret | null> {
    return notImplemented('getStationSecret');
  }
  async putStationSecret(_secret: StationSecret): Promise<void> {
    return notImplemented('putStationSecret');
  }
  async deleteStationSecret(_taskId: string): Promise<void> {
    return notImplemented('deleteStationSecret');
  }
  async getSubmission(_id: string): Promise<StationSubmission | null> {
    return notImplemented('getSubmission');
  }
  async putSubmission(_s: StationSubmission): Promise<void> {
    return notImplemented('putSubmission');
  }
  async patchSubmission(_id: string, _patch: Patch<StationSubmission>): Promise<void> {
    return notImplemented('patchSubmission');
  }
  async listPendingSubmissions(
    _scope: RunScope,
    _page: PageRequest,
  ): Promise<Page<StationSubmission>> {
    return notImplemented('listPendingSubmissions');
  }
  async listSubmissionsForRun(
    _scope: RunScope,
    _page: PageRequest,
  ): Promise<Page<StationSubmission>> {
    return notImplemented('listSubmissionsForRun');
  }

  // ── 10. Feedback ────────────────────────────────────────────────────────
  async getFeedback(_scope: RunScope, _uid: string): Promise<RunFeedback | null> {
    return notImplemented('getFeedback');
  }
  async listFeedback(_scope: RunScope, _page: PageRequest): Promise<Page<RunFeedback>> {
    return notImplemented('listFeedback');
  }

  // ── 11. Run objects ─────────────────────────────────────────────────────
  async getTrackable(_scope: RunScope, _id: string): Promise<Trackable | null> {
    return notImplemented('getTrackable');
  }
  async putTrackable(_scope: RunScope, _t: Trackable): Promise<void> {
    return notImplemented('putTrackable');
  }
  async listTrackables(_scope: RunScope): Promise<Trackable[]> {
    return notImplemented('listTrackables');
  }
  async getZone(_scope: RunScope, _id: string): Promise<Zone | null> {
    return notImplemented('getZone');
  }
  async putZone(_scope: RunScope, _z: Zone): Promise<void> {
    return notImplemented('putZone');
  }
  async deleteZone(_scope: RunScope, _id: string): Promise<void> {
    return notImplemented('deleteZone');
  }
  async listZones(_scope: RunScope): Promise<Zone[]> {
    return notImplemented('listZones');
  }
  async getConsentToken(_scope: RunScope, _token: string): Promise<ConsentToken | null> {
    return notImplemented('getConsentToken');
  }
  async putConsentToken(_scope: RunScope, _t: ConsentToken): Promise<void> {
    return notImplemented('putConsentToken');
  }

  // ── 12. Cross-run aggregates ────────────────────────────────────────────
  async getBenchmark(_type: string): Promise<BenchmarkDoc | null> {
    return notImplemented('getBenchmark');
  }
  async getPlayerProfile(_uid: string): Promise<PlayerProfileDoc | null> {
    return notImplemented('getPlayerProfile');
  }

  // ── atomic.ts — every invariant-bearing operation ───────────────────────
  //
  // These are the operations the whole migration is shaped around, and each one
  // is a real design job (derived occupancy instead of `Run.taskCounts`, the
  // merged reserve+claim, the nested read-modify-rewrite of `RunTeam.stages`).
  // Phase 1 lands the plumbing they will run on; implementing them half-way
  // would be worse than not having them, because a subtly wrong atom is
  // invisible until it races in production.

  async claimTaskSlot(
    _scope: TeamScope,
    _args: {
      stageId: string;
      candidates: TaskSlotCandidate[];
      choose: SlotChooser;
      now: string;
    },
  ): Promise<ClaimTaskSlotResult> {
    return notImplemented('claimTaskSlot');
  }
  async releaseTaskSlot(
    _scope: TeamScope,
    _args: { taskId: string; now: string },
  ): Promise<{ released: boolean }> {
    return notImplemented('releaseTaskSlot');
  }
  async claimActiveTask(
    _scope: TeamScope,
    _args: { stageId: string; taskId: string; now: string },
  ): Promise<ClaimActiveTaskResult> {
    return notImplemented('claimActiveTask');
  }
  async completeTeamTask(
    _scope: TeamScope,
    _args: {
      stageId: string;
      taskId: string;
      write: TaskCompletionWrite;
      foldTaskIds?: string[];
      stagePatch?: Patch<Omit<RunStageRecord, 'stageId' | 'order' | 'tasks'>>;
      teamPatch?: Patch<Omit<RunTeam, 'stages' | 'score'>>;
      scoreDelta: number;
      requireRunLive: boolean;
      now: string;
    },
  ): Promise<CompleteTeamTaskResult> {
    return notImplemented('completeTeamTask');
  }
  async skipTeamTask(
    _scope: TeamScope,
    _args: {
      stageId: string;
      taskId: string;
      requiredTaskCount?: number;
      foldTaskIds?: string[];
      stagePatch?: Patch<Omit<RunStageRecord, 'stageId' | 'order' | 'tasks'>>;
      now: string;
    },
  ): Promise<Outcome<
    { releasedTaskIds: string[]; stageCompleted: boolean; teamFinished: boolean },
    'not-skippable'
  >> {
    return notImplemented('skipTeamTask');
  }
  async joinRunWithCapacity(
    _scope: RunScope,
    _args: { team: RunTeam; participantCap: number; deviceCap: number; now: string },
  ): Promise<Outcome<
    { teamId: string; alreadyJoined: boolean; participantCount: number },
    'run-full' | 'device-limit' | 'run-finished'
  >> {
    return notImplemented('joinRunWithCapacity');
  }
  async attachDevice(
    _scope: TeamScope,
    _args: {
      uid: string;
      displayName: string;
      teamDeviceCap: number;
      runDeviceCap: number;
      now: string;
    },
  ): Promise<Outcome<
    { alreadyAttached: boolean; controllerUid: string; deviceCount: number },
    'team-full' | 'run-device-limit' | 'run-finished'
  >> {
    return notImplemented('attachDevice');
  }
  async setController(
    _scope: TeamScope,
    _args: { mode: 'transfer' | 'claim'; byUid: string; toUid: string; now: string },
  ): Promise<Outcome<{ controllerUid: string }, 'not-controller' | 'not-attached'>> {
    return notImplemented('setController');
  }
  async launchRunBilled(
    _args: {
      run: Run;
      accessCode: AccessCode;
      debit?: { uid: string; kind: 'free_run' | 'credit'; ledger: WalletTransaction };
      now: string;
    },
  ): Promise<Outcome<
    { runId: string; accessCode: string },
    'insufficient-credits' | 'code-taken' | 'test-run-already-live'
  >> {
    return notImplemented('launchRunBilled');
  }
  async consumeStaffInvite(
    _scope: RunScope,
    _args: { inviteId: string; byUid: string; now: string },
  ): Promise<Outcome<{ invite: StaffInvite }, 'already-used' | 'not-found'>> {
    return notImplemented('consumeStaffInvite');
  }
  async consumeConsentToken(
    _scope: RunScope,
    _args: { token: string; guardianName: string | null; now: string },
  ): Promise<Outcome<{ teamId: string }, 'already-used' | 'not-found' | 'expired'>> {
    return notImplemented('consumeConsentToken');
  }
  async claimOnceFlag(
    _target: { kind: 'run'; scope: RunScope } | { kind: 'team'; scope: TeamScope },
    _args: { flag: string; now: string },
  ): Promise<{ claimed: boolean }> {
    return notImplemented('claimOnceFlag');
  }
  async chargeHint(
    _scope: TeamScope,
    _args: { taskId: string; penalty: number; now: string },
  ): Promise<{ alreadyCharged: boolean; charged: number }> {
    return notImplemented('chargeHint');
  }
  async chargeWrongAnswer(
    _scope: TeamScope,
    _args: {
      taskId: string;
      submissionHash: string;
      computeCost: (prior: { attempts: number; charged: number }) => {
        points: number;
        lockoutMs: number;
      };
      now: string;
      nowMs: number;
    },
  ): Promise<{
    replay: boolean;
    charged: number;
    attempts: number;
    lockoutMs: number;
    lastFailureAt: number;
  }> {
    return notImplemented('chargeWrongAnswer');
  }
  async adjustTeamPenalty(
    _scope: TeamScope,
    _args: { delta: number; clamp: (next: number) => number; now: string },
  ): Promise<{ previousBonusPenalty: number; bonusPenalty: number }> {
    return notImplemented('adjustTeamPenalty');
  }
  async setTaskStatusOverride(
    _scope: RunScope,
    _args: {
      taskId: string;
      status: StationStatus;
      expectedFrom?: StationStatus;
      now: string;
    },
  ): Promise<Outcome<{ from: StationStatus; to: StationStatus }, 'conflict'>> {
    return notImplemented('setTaskStatusOverride');
  }
  async refreshLeaderboardIfNotFrozen(
    _scope: RunScope,
    _args: {
      rankings: import('../types').LeaderboardEntry[];
      minIntervalMs: number;
      now: string;
      nowMs: number;
    },
  ): Promise<{ written: boolean; skipped?: 'frozen' | 'throttled' }> {
    return notImplemented('refreshLeaderboardIfNotFrozen');
  }
  async appendChatMessage(
    _scope: TeamScope,
    _args: {
      message: ChatMessage;
      threadSeed: Omit<ChatThread, 'messages' | 'updatedAt'>;
      maxMessages: number;
      now: string;
    },
  ): Promise<{ messageCount: number; trimmed: number }> {
    return notImplemented('appendChatMessage');
  }
  async applyFeedReaction(
    _scope: RunScope,
    _args: { itemId: string; uid: string; emoji: string | null; now: string },
  ): Promise<Outcome<{ reactions: Record<string, number> }, 'not-found' | 'hidden'>> {
    return notImplemented('applyFeedReaction');
  }
  async applyFeedReport(
    _scope: RunScope,
    _args: {
      itemId: string;
      reporterKey: string;
      reason: string;
      autoHideAtCount: number;
      now: string;
    },
  ): Promise<Outcome<{ reportCount: number; hidden: boolean }, 'not-found'>> {
    return notImplemented('applyFeedReport');
  }
  async captureZone(
    _scope: TeamScope,
    _args: { zoneId: string; withinZone: (zone: Zone) => boolean; now: string },
  ): Promise<Outcome<
    { zone: Zone; bonusAwarded: number },
    'not-found' | 'already-held' | 'out-of-range'
  >> {
    return notImplemented('captureZone');
  }
  async transferTrackable(
    _scope: RunScope,
    _args: {
      trackableId: string;
      action: 'pickup' | 'drop';
      teamId: string;
      teamName?: string;
      taskId?: string | null;
      now: string;
    },
  ): Promise<Outcome<{ trackable: Trackable }, 'not-found' | 'held-by-other' | 'not-carrying'>> {
    return notImplemented('transferTrackable');
  }
  async setStationSecret(
    _args: { taskId: string; code: string | null; now: string },
  ): Promise<void> {
    return notImplemented('setStationSecret');
  }
  async submitFeedbackOnce(
    _scope: RunScope,
    _args: { feedback: RunFeedback },
  ): Promise<{ stored: boolean; already: boolean }> {
    return notImplemented('submitFeedbackOnce');
  }
  async togglePublicLike(
    _args: {
      kind: 'game' | 'task';
      itemId: string;
      uid: string;
      liked: boolean;
      recompute: (signals: { likeCount: number; uses: number; createdAt: string }) => number;
      now: string;
    },
  ): Promise<Outcome<{ likeCount: number; popularity: number; changed: boolean }, 'not-found'>> {
    return notImplemented('togglePublicLike');
  }
  async bumpPublicSignals(
    _args: {
      kind: 'game' | 'task';
      itemId: string;
      uses?: number;
      recompute: (signals: { likeCount: number; uses: number; createdAt: string }) => number;
      now: string;
    },
  ): Promise<Outcome<{ uses: number; popularity: number }, 'not-found'>> {
    return notImplemented('bumpPublicSignals');
  }
  async bumpTagStats(_args: { added: string[]; removed: string[]; now: string }): Promise<void> {
    return notImplemented('bumpTagStats');
  }
  async mergeBenchmark<S>(
    _args: {
      type: string;
      sample: S;
      merge: (prev: BenchmarkDoc | null, sample: S) => BenchmarkDoc;
      now: string;
    },
  ): Promise<void> {
    return notImplemented('mergeBenchmark');
  }
  async recordPlayerResult<R>(
    _args: {
      uid: string;
      teamScope: TeamScope;
      result: R;
      merge: (prev: PlayerProfileDoc | null, r: R) => PlayerProfileDoc;
      now: string;
    },
  ): Promise<{ recorded: boolean }> {
    return notImplemented('recordPlayerResult');
  }
  async creditWallet(
    _args: {
      uid: string;
      idempotencyKey: string;
      credits?: number;
      bonusFreeRuns?: number;
      walletPatch?: Patch<Omit<Wallet, 'eventCredits' | 'bonusFreeRuns'>>;
      ledger: WalletTransaction;
      now: string;
    },
  ): Promise<{ duplicate: boolean; eventCredits: number }> {
    return notImplemented('creditWallet');
  }
  async claimReferral(
    _args: {
      inviteeUid: string;
      inviterUid: string;
      bonusFreeRuns: number;
      maxPerReferrer: number;
      inviteeLedger: WalletTransaction;
      inviterLedger: WalletTransaction;
      now: string;
    },
  ): Promise<Outcome<
    { inviterReferralCount: number },
    'already-claimed' | 'self-referral' | 'referrer-cap-reached' | 'inviter-not-found'
  >> {
    return notImplemented('claimReferral');
  }
  async rateLimitStep(
    _args: {
      bucket: string;
      uid: string;
      budget: RateBudget;
      step: (state: WindowState | null, budget: RateBudget, nowMs: number) => {
        allowed: boolean;
        nextState: WindowState;
        retryAfterMs: number;
      };
      nowMs: number;
    },
  ): Promise<{ allowed: boolean; retryAfterMs: number }> {
    return notImplemented('rateLimitStep');
  }
}

// Compile-time proof that the bound surface really is the full transactional
// interface — including every atomic operation. If a method is added to
// `AtomicOperations` and not to this class, THIS line fails, not a call site.
const _boundSatisfiesTransactional: new (
  ctx: FirestoreContext,
  io: Io,
) => TransactionalRepository & AtomicOperations & AuditRepository &
  AggregateRepository & FeedbackRepository & LiveOpsRepository &
  RunObjectRepository & StationRepository = BoundFirestoreRepository;
void _boundSatisfiesTransactional;


// ═══════════════════════════════════════════════════════════════════════════
// The repository
// ═══════════════════════════════════════════════════════════════════════════

export class FirestoreRepository extends BoundFirestoreRepository implements Repository {
  private readonly runner: <T>(body: TxBody<T>, options?: TransactionOptions) => Promise<T>;

  constructor(deps: FirestoreDeps | FirestoreContext) {
    const ctx = deps instanceof FirestoreContext ? deps : new FirestoreContext(deps);
    super(ctx, directIo);
    this.runner = makeRunInTransaction(ctx.db);
  }

  /** See ../transaction.ts. The body MAY execute more than once. */
  runInTransaction = <T>(body: TxBody<T>, options?: TransactionOptions): Promise<T> =>
    this.runner(body, options);

  /**
   * Bind the whole read/write surface to a transaction.
   *
   * The returned object is the SAME class as `this`, differing only in its `Io`
   * — which is what makes "the signature is identical inside and outside a
   * transaction" true by construction rather than by discipline.
   */
  withTx(tx: Tx): TransactionalRepository {
    return new BoundFirestoreRepository(this.ctx, txIo(unwrapTx(tx)));
  }


  // ── 14. Sweeps — bounded, resumable, NOT atomic ─────────────────────────
  //
  // Stubbed for Phase 1. When implemented they MUST:
  //   * honour `budget.maxDocs` as a hard ceiling and return a `nextCursor`
  //     whenever they stopped early;
  //   * commit deletes in `chunk(refs, MAX_BATCH_OPS)` groups — a WriteBatch is
  //     capped at 500 ops and a run's `teamLocations` alone runs into the
  //     thousands (functions/src/batchUtil.ts);
  //   * never be called inside `runInTransaction` (rule 5: a transaction is
  //     finite and small).

  async sweepRunPii(_scope: RunScope, _budget: SweepBudget): Promise<SweepResult> {
    return notImplemented('sweepRunPii');
  }
  async sweepRunSubtree(_scope: RunScope, _budget: SweepBudget): Promise<SweepResult> {
    return notImplemented('sweepRunSubtree');
  }
  async sweepGameSubtree(_scope: GameScope, _budget: SweepBudget): Promise<SweepResult> {
    return notImplemented('sweepGameSubtree');
  }
  async sweepUserSubtree(_uid: string, _budget: SweepBudget): Promise<SweepResult> {
    return notImplemented('sweepUserSubtree');
  }
  async sweepPublicTaskProjection(
    _budget: SweepBudget,
    _repair: (task: PublicTask) => Patch<PublicTask> | null,
  ): Promise<SweepResult> {
    return notImplemented('sweepPublicTaskProjection');
  }
}

/** Convenience factory. `createFirestoreRepository({ db, deleteSentinel })`. */
export function createFirestoreRepository(deps: FirestoreDeps): Repository {
  return new FirestoreRepository(deps);
}
