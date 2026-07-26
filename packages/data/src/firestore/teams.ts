// ─── FirestoreTeamRepository — the hot path, row-shaped over a nested array ───
//
// `TeamRepository` (../repository.ts §6) is the hottest and most correctness-
// critical aggregate in RushPoint. It is also the ONE aggregate whose storage
// shape genuinely changes in the migration:
//
//   TODAY (Firestore)     …/runs/{runId}/teams/{teamId} is ONE document, and
//                         `RunTeam.stages[] -> RunStageRecord.tasks[] ->
//                         RunTaskRecord` is a NESTED ARRAY inside it. Every
//                         write in functions/src/runs/index.ts therefore
//                         deep-clones the whole `stages` array, mutates one
//                         element, and rewrites the WHOLE array.
//
//   LATER (Postgres)      `run_team` + `run_team_stages` + `run_task_records`
//                         rows, keyed by (run_id, team_id, stage_id, task_id).
//                         One task update is one single-row UPDATE.
//
// The interface was deliberately written in the SECOND shape — every nested
// write is addressed by (stageId, taskId), never by array index. This file is
// where the two shapes meet: it presents the row-shaped API and does the nested
// read-modify-rewrite internally. That translation is the entire value of this
// file, so it is concentrated in ONE place (`rewriteStages` below) and every
// public record method is a thin caller of it.
//
// Two rules make the translation safe, and they are why the rewrite must never
// leak above this file:
//
//   1. NEVER dotted-path-update an array element. `.update({'stages.0.tasks.0':
//      x})` coerces the array into a MAP and destroys a run in progress — a
//      footgun this repo has already shipped (CLAUDE.md; patch.ts; README rule
//      3). `assertNoFieldPaths` rejects such a key, but the real defence is that
//      no call site ever has to write one, because this file owns the rewrite.
//   2. READS BEFORE WRITES. Every record method here reads the team document
//      and then writes it. Inside a transaction that is `tx.get` → `tx.update`,
//      which is legal ONLY while no write has already happened in that
//      transaction body. See "Ordering inside a transaction" below.
//
// BEHAVIOUR-NEUTRAL, like the rest of Phase 1: this mirrors what
// functions/src/runs/index.ts does today, including its oddities, which are
// reproduced and commented rather than fixed. Divergences that the interface
// itself forces (there are three, all about `updatedAt`, identity fields and
// `stages` in `patchTeam`) are listed in teams.README.md.

import {
  DataError,
  type Cursor,
  type Page,
  type PageRequest,
  type Patch,
  type RunScope,
  type RunStageRecord,
  type RunTaskRecord,
  type RunTeam,
  type SortDir,
  type StageRecordPatch,
  type TaskRecordPatch,
  type TeamScope,
} from '../types';
import type { TeamRepository } from '../repository';
import type { Tx } from '../transaction';
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
import { colPaths, docPaths } from './paths';
import { applyPatchInMemory, toDocumentData, toUpdateData } from './patch';
import { unwrapTx } from './transaction';


// ═══════════════════════════════════════════════════════════════════════════
// The I/O seam (duplicated from repository.ts on purpose — see note)
// ═══════════════════════════════════════════════════════════════════════════
//
// `repository.ts` declares this exact interface (`Io`) and does NOT export it.
// Re-declaring it here rather than exporting it from there keeps this file from
// editing a module another lane owns; the two are structurally identical, so
// `repository.ts` can hand its own `io` straight to this class with no cast and
// no adapter. If `Io` is ever exported, delete this block and import it — the
// shapes must never be allowed to drift apart, because "the signature is
// identical inside and outside a transaction" is the property that makes the
// transactional surface trustworthy.

export interface TeamIo {
  readonly inTransaction: boolean;
  getDoc(ref: FsDocumentReference): Promise<FsDocumentSnapshot>;
  getQuery(query: FsQuery): Promise<FsQuerySnapshot>;
  set(ref: FsDocumentReference, data: FsDocumentData, options?: { merge?: boolean }): Promise<void>;
  update(ref: FsDocumentReference, data: FsDocumentData): Promise<void>;
  del(ref: FsDocumentReference): Promise<void>;
}

/** Non-transactional I/O: operations hit the database directly. */
export const directTeamIo: TeamIo = {
  inTransaction: false,
  getDoc: (ref) => ref.get(),
  getQuery: (query) => query.get(),
  set: async (ref, data, options) => { await ref.set(data, options); },
  update: async (ref, data) => { await ref.update(data); },
  del: async (ref) => { await ref.delete(); },
};

/** Transaction-bound I/O. Writes are buffered by the driver until commit. */
export function teamTxIo(tx: FsTransaction): TeamIo {
  return {
    inTransaction: true,
    getDoc: (ref) => tx.get(ref),
    getQuery: (query) => tx.get(query),
    set: async (ref, data, options) => { tx.set(ref, data, options); },
    update: async (ref, data) => { tx.update(ref, data); },
    del: async (ref) => { tx.delete(ref); },
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// Cursors (mirrored from repository.ts — same encoding, deliberately)
// ═══════════════════════════════════════════════════════════════════════════
//
// A `Cursor` is opaque to callers, so its encoding is the implementation's
// business — but it must be ONE encoding across the whole Firestore
// implementation, or a cursor produced by `listTeams` and replayed through some
// other paged read would be silently misparsed. Plain JSON, not base64, for the
// same reason as repository.ts: `btoa` needs `lib.dom` and `Buffer` needs
// `@types/node`, and this package's real build config has neither.

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
// Nested-record helpers — pure, and the heart of the shape translation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Firestore's `in` operator caps the value list. The documented limit was 10 for
 * years and is 30 on current backends; 10 is used so this runs against every
 * deployment the project has ever targeted, including the emulator pinned in
 * this repo. Over-chunking costs an extra round trip; under-chunking throws.
 */
const MAX_IN_VALUES = 10;

/**
 * Deep-clone the stage/task tree so a mutation can never touch the object
 * returned by the driver's snapshot.
 *
 * This is byte-for-byte the clone every write path in
 * `functions/src/runs/index.ts` performs before mutating
 * (`team.stages.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t })) }))`)
 * — completeTaskForTeam, skipStage and skipTaskForTeam all open with it. Two
 * levels is exactly right: only the two arrays and their elements are replaced,
 * while leaf objects (`scoreBreakdown`) are shared, which is safe because
 * nothing mutates a leaf in place.
 *
 * It matters MORE here than there: a Firestore transaction body may re-execute,
 * and a mutation applied to a snapshot's own object would still be visible on
 * the next attempt, so attempt N+1 would compute from attempt N's half-applied
 * state. Cloning per attempt is what makes the body idempotent.
 */
function cloneStages(stages: RunStageRecord[]): RunStageRecord[] {
  return stages.map((s) => ({ ...s, tasks: (s.tasks ?? []).map((t) => ({ ...t })) }));
}

/**
 * Read `team.stages` defensively.
 *
 * A team document with no `stages` array cannot be reasoned about: today's code
 * would throw a raw `TypeError` from `.map` deep inside a transaction body. Rule
 * 8 says only `DataError` escapes this package, so the corruption is reported as
 * `failed-precondition` naming the team — the same failure, made diagnosable.
 */
function readStages(team: RunTeam, what: string, scope: TeamScope): RunStageRecord[] {
  const stages = (team as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) {
    throw new DataError(
      'failed-precondition',
      `${what}: team ${scope.teamId} has no stages array (document is corrupt)`,
      { teamId: scope.teamId, runId: scope.runId },
    );
  }
  return stages as RunStageRecord[];
}

/** Locate a stage by its KEY. Never by index — see the header. */
function findStageIndex(stages: RunStageRecord[], stageId: string): number {
  return stages.findIndex((s) => s.stageId === stageId);
}

/**
 * Locate a task by its KEY within a stage.
 *
 * PRESERVED ODDITY: `RunTaskRecord.taskIndex` exists and is an index into
 * `Stage.tasks`, but it is NOT used for lookup — not here and not in
 * functions/src today, which comments the reason at the two places it matters:
 * `team.stages` is sorted by `order` while `game.stages` keeps the Builder's
 * array order, so the two index spaces can diverge and a positional lookup
 * scores the wrong task. `taskIndex` is carried as data and is excluded from
 * `TaskRecordPatch`; it is never a lookup key.
 */
function findTaskIndex(stage: RunStageRecord, taskId: string): number {
  return (stage.tasks ?? []).findIndex((t) => t.taskId === taskId);
}

/**
 * Reject a patch that tries to change an IDENTITY field.
 *
 * `TaskRecordPatch` / `StageRecordPatch` already omit these at the type level,
 * but a patch can arrive from a JSON round trip where the type is gone. In the
 * row model these are (part of) the PRIMARY KEY, so "patching" one is really a
 * delete-plus-insert, and a Firestore implementation that quietly allowed it
 * would produce a document a SQL implementation cannot reproduce.
 *
 * `tasks` is on the stage's forbidden list for a stronger reason: allowing it
 * would let a caller replace the whole task array through a STAGE patch, which
 * is precisely the write path the row model exists to remove. Rebuilding the
 * tree is `replaceTeamStages`, which says so in its name.
 */
function assertNoIdentityFields(
  patch: Record<string, unknown> | null | undefined,
  forbidden: readonly string[],
  what: string,
): void {
  if (!patch) return;
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
      throw new DataError(
        'failed-precondition',
        `${what}: ${key} identifies the record and cannot be patched. ` +
          'Rebuild the progress tree with replaceTeamStages if the shape must change.',
        { key },
      );
    }
  }
}

const TASK_IDENTITY_FIELDS = ['taskId', 'taskIndex'] as const;
const STAGE_IDENTITY_FIELDS = ['stageId', 'order', 'tasks'] as const;


// ═══════════════════════════════════════════════════════════════════════════
// The repository
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Implements `TeamRepository` over the single team document.
 *
 * Constructed with the SAME injected context the rest of the Firestore
 * implementation uses — a `FirestoreContext` (the already-initialised `db` plus
 * the `deleteSentinel` factory) and a `TeamIo`. It imports no `firebase-admin`,
 * for the reasons context.ts documents at length.
 *
 * ── Ordering inside a transaction ──────────────────────────────────────────
 *
 * Every nested-record method is a READ followed by a WRITE. Firestore requires
 * all reads in a transaction to precede all writes, so inside a
 * `runInTransaction` body these must be called BEFORE any other write in that
 * body. That is not a quirk of this class; it is why the eventual atomic
 * operations (atomic.ts) exist at all — they bundle the read, the decision and
 * the write into one step so a caller cannot interleave them wrongly.
 */
export class FirestoreTeamRepository implements TeamRepository {
  constructor(
    protected readonly ctx: FirestoreContext,
    protected readonly io: TeamIo,
  ) {}

  /** Rebind to a different I/O seam (e.g. a transaction). */
  withIo(io: TeamIo): FirestoreTeamRepository {
    return new FirestoreTeamRepository(this.ctx, io);
  }

  /** Convenience: bind to a `Tx` handle minted by this repository's runner. */
  withTx(tx: Tx): FirestoreTeamRepository {
    return this.withIo(teamTxIo(unwrapTx(tx)));
  }


  // ── low-level helpers (mirrors of repository.ts's, which are protected) ──

  private doc(path: string): FsDocumentReference {
    return this.ctx.db.doc(path);
  }

  private teamRef(scope: TeamScope): FsDocumentReference {
    return this.doc(docPaths.team(scope));
  }

  private teamsQuery(scope: RunScope): FsQuery {
    return this.ctx.db.collection(colPaths.teams(scope));
  }

  /** Keyset-paged query. Order fields must be STORED fields. */
  private async pageQuery<T>(
    base: FsQuery,
    order: OrderSpec[],
    req: PageRequest,
    what: string,
  ): Promise<Page<T>> {
    return guard(what, async () => {
      const limit = Math.max(1, Math.floor(req.limit));
      let q = base;
      for (const o of order) q = q.orderBy(o.field, o.dir);
      const after = decodeCursor(req.cursor, what);
      if (after) q = q.startAfter(...after);
      const snap = await this.io.getQuery(q.limit(limit));

      const raw = snap.docs;
      const page: Page<T> = { items: raw.map((d) => d.data() as unknown as T) };
      // `nextCursor` is present iff the page filled — the only end-of-data
      // signal a caller may read (README rule 7).
      if (raw.length === limit) {
        const last = raw[raw.length - 1] as FsQueryDocumentSnapshot;
        const data = last.data();
        page.nextCursor = encodeCursor(order.map((o) => data[o.field] ?? null));
      }
      return page;
    });
  }

  private async listAll<T>(base: FsQuery, what: string): Promise<T[]> {
    return guard(what, async () => {
      const snap = await this.io.getQuery(base);
      return snap.docs.map((d) => d.data() as unknown as T);
    });
  }

  /**
   * Load a team or refuse. Used by every write path, because `patch` means
   * "modify a document that exists" (README rule 2) — a silent create would
   * produce a `RunTeam` satisfying no domain invariant, with no stages, no run
   * membership and no devices.
   */
  private async requireTeam(scope: TeamScope, what: string): Promise<RunTeam> {
    const team = await this.getTeam(scope);
    if (!team) {
      throw new DataError('not-found', `${what}: team ${scope.teamId} not found`, {
        teamId: scope.teamId,
        runId: scope.runId,
      });
    }
    return team;
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Team document
  // ═════════════════════════════════════════════════════════════════════════

  async getTeam(scope: TeamScope): Promise<RunTeam | null> {
    return guard('getTeam', async () => {
      const snap = await this.io.getDoc(this.teamRef(scope));
      if (!snap.exists) return null;
      const data = snap.data();
      return data === undefined ? null : (data as unknown as RunTeam);
    });
  }

  /**
   * Create-or-replace the WHOLE team document, exactly as `joinRun`'s
   * `t.set(teamRef, team)` does today — including its `stages` tree.
   *
   * The path comes from the team's OWN `ownerUid`/`gameId`/`runId`/`id` rather
   * than a scope argument, matching `putGame`/`putRun`. Those four fields are
   * denormalised onto the document precisely so it is self-locating.
   */
  async putTeam(team: RunTeam): Promise<void> {
    const scope: TeamScope = {
      ownerUid: team.ownerUid,
      gameId: team.gameId,
      runId: team.runId,
      teamId: team.id,
    };
    const data = toDocumentData(team as unknown as Record<string, unknown>, 'putTeam');
    await guard('putTeam', () => this.io.set(this.teamRef(scope), data));
  }

  /**
   * Top-level team fields only.
   *
   * `stages` is refused at RUNTIME as well as in the type. It is the single most
   * dangerous field on this document: a caller patching it would be writing the
   * whole progress tree from data it read earlier and may have raced against —
   * which is exactly the lost-update class the record methods below exist to
   * prevent. `replaceTeamStages` is the deliberate, named way to rebuild it.
   */
  async patchTeam(scope: TeamScope, patch: Patch<Omit<RunTeam, 'stages'>>): Promise<void> {
    const raw = patch as Record<string, unknown> | undefined;
    if (raw && Object.prototype.hasOwnProperty.call(raw, 'stages') && raw.stages !== undefined) {
      throw new DataError(
        'failed-precondition',
        'patchTeam: `stages` is not patchable here. Use patchTaskRecord / ' +
          'patchStageRecord for one record, or replaceTeamStages to rebuild the tree.',
        { key: 'stages' },
      );
    }
    const data = toUpdateData(raw, this.ctx.deleteSentinel, 'patchTeam');
    if (data === null) return;   // empty patch ⇒ no round trip (see patch.ts)
    await guard('patchTeam', () => this.io.update(this.teamRef(scope), data));
  }

  /**
   * Deletes ONLY the team document.
   *
   * Consistent with `deleteGame`/`deleteRun`: Firestore sub-collections outlive
   * their parent document. A team has none today, but stating the boundary here
   * keeps the rule uniform and keeps a future sub-collection from silently
   * surviving a delete.
   */
  async deleteTeam(scope: TeamScope): Promise<void> {
    await guard('deleteTeam', () => this.io.del(this.teamRef(scope)));
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Team reads
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Paged teams of one run, ORDERED BY `id` ASCENDING.
   *
   * `RunTeam` has no creation timestamp — `joinRun` writes `updatedAt` and
   * nothing else time-like, and `updatedAt` is rewritten by every completion, so
   * ordering by it would make a team MOVE between pages mid-race and a keyset
   * cursor would skip or repeat rows. `id` is immutable, is stored on the
   * document AND equals the document id (`teamId == the participant's uid`), so
   * this ordering is byte-for-byte Firestore's own implicit `__name__` order —
   * i.e. the order `listRunTeams` and `startTeams` already see today when they
   * read the collection unordered. It is also a stored field, which the cursor
   * encoding requires.
   */
  async listTeams(scope: RunScope, page: PageRequest): Promise<Page<RunTeam>> {
    return this.pageQuery<RunTeam>(
      this.teamsQuery(scope),
      [{ field: 'id', dir: 'asc' }],
      page,
      'listTeams',
    );
  }

  /**
   * Every team of a run, unpaged — the read `listRunTeams`, `startTeams`,
   * `finalizeRun`, `refreshLeaderboard` and the recap all perform today
   * (`db.collection(teamsCol(...)).get()`).
   *
   * Unpaged is safe BY CONSTRUCTION rather than by hope: `Run.maxParticipants` is
   * a hard ceiling fixed at launch (free run 5, credit = package size, Pro 50)
   * and `joinRun` enforces it inside a transaction, so this collection cannot
   * grow without bound.
   */
  async listAllTeams(scope: RunScope): Promise<RunTeam[]> {
    return this.listAll<RunTeam>(this.teamsQuery(scope), 'listAllTeams');
  }

  /**
   * Teams whose `activeTaskId` mirror equals `taskId` — the station-occupancy
   * read. Mirrors `setRunTaskStatus`'s holder query in functions/src/index.ts
   * (`.where('activeTaskId','==',taskId)`), the only such query today.
   *
   * PRESERVED ODDITY worth knowing before this backs `claimTaskSlot`: there are
   * TWO records of "this team is on that task" — the `activeTaskId` mirror on
   * the team document and the task record's `status === 'assigned'` — and they
   * can disagree (a stale mirror pointing at nothing is explicitly handled in
   * `skipTaskForTeam`, and `completeTaskForTeam` accepts EITHER as proof of a
   * held slot: `team.activeTaskId === taskId || taskRec.status === 'assigned'`).
   * This read consults only the MIRROR, because it is the only one Firestore can
   * index — a nested array element is not queryable. So occupancy derived from
   * it can under-count a team whose mirror was cleared while its record still
   * says `assigned`. That is today's behaviour, reproduced deliberately; in the
   * row model the same question becomes a WHERE over `run_task_records` and the
   * two sources collapse into one.
   */
  async listTeamsAtTask(scope: RunScope, taskId: string): Promise<RunTeam[]> {
    return this.listAll<RunTeam>(
      this.teamsQuery(scope).where('activeTaskId', '==', taskId),
      'listTeamsAtTask',
    );
  }

  /**
   * Occupancy of ONE task, without materialising the team documents.
   *
   * Outside a transaction this uses the `count()` aggregate — a team document
   * carries its entire `stages` tree, so counting by fetching rows is the
   * expensive way to answer a question routing asks per candidate.
   *
   * INSIDE a transaction it counts materialised documents instead. That is not a
   * fallback for convenience: an aggregate query issued through the driver's
   * query handle is NOT part of the transaction's read set, so its result would
   * not be protected by the transaction's consistency check — a count that reads
   * outside the transaction it is deciding inside of is exactly how a station
   * cap gets overshot under contention. Paying for the documents buys a read
   * that actually participates in the commit.
   */
  async countTeamsAtTask(scope: RunScope, taskId: string): Promise<number> {
    const q = this.teamsQuery(scope).where('activeTaskId', '==', taskId);
    return guard('countTeamsAtTask', async () => {
      if (this.io.inTransaction) {
        const snap = await this.io.getQuery(q);
        return snap.size;
      }
      const agg = await q.count().get();
      return agg.data().count;
    });
  }

  /**
   * Occupancy for several tasks in one round trip — routing's candidate set.
   *
   * EVERY requested id is present in the result, with 0 where nobody holds the
   * task. An absent key would be indistinguishable from "unknown", and a caller
   * reading `undefined` as free is how a full station gets handed out again. A 0
   * here is a real derived answer, not a stub.
   *
   * Duplicates are collapsed and the ids are chunked to Firestore's `in` limit.
   * An empty request performs no query at all.
   */
  async countTeamsAtTasks(scope: RunScope, taskIds: string[]): Promise<Map<string, number>> {
    const wanted = Array.from(new Set(taskIds ?? []));
    const out = new Map<string, number>();
    for (const id of wanted) out.set(id, 0);
    if (wanted.length === 0) return out;

    return guard('countTeamsAtTasks', async () => {
      for (let i = 0; i < wanted.length; i += MAX_IN_VALUES) {
        const group = wanted.slice(i, i + MAX_IN_VALUES);
        const snap = await this.io.getQuery(
          this.teamsQuery(scope).where('activeTaskId', 'in', group),
        );
        for (const d of snap.docs) {
          const held = (d.data() as { activeTaskId?: unknown }).activeTaskId;
          if (typeof held !== 'string') continue;
          // Only ids we asked about are tallied; `in` cannot return anything
          // else, but the guard keeps a future widening of the query honest.
          if (out.has(held)) out.set(held, (out.get(held) ?? 0) + 1);
        }
      }
      return out;
    });
  }


  // ═════════════════════════════════════════════════════════════════════════
  // The nested-array ⇄ row translation
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Read the team, hand `mutate` a FRESH DEEP CLONE of its stage tree, and write
   * the whole array back. The single seam through which every nested write in
   * this file passes, and the place the whole design tension is resolved.
   *
   * Four properties, each of which is load-bearing:
   *
   *  1. WHOLE-ARRAY REWRITE, NEVER A DOTTED PATH. The write is
   *     `.update({ stages })`. `.update({'stages.0.tasks.0': x})` would coerce
   *     the array into a map and destroy the run (CLAUDE.md; patch.ts). Under
   *     SQL this same call becomes one `UPDATE run_task_records SET … WHERE
   *     run_id = ? AND team_id = ? AND task_id = ?` — the CALLERS below do not
   *     change, which is the entire point of addressing records by key.
   *
   *  2. THE CLONE IS PER ATTEMPT. A Firestore transaction body may re-execute
   *     (../transaction.ts). Mutating the snapshot's own object would leave
   *     attempt N's changes visible to attempt N+1, which would then compute
   *     from half-applied state. `cloneStages` runs INSIDE the callback, so
   *     every attempt starts from what it actually read.
   *
   *  3. SIDE-EFFECT DATA LEAVES BY RETURN VALUE, NEVER BY CLOSURE.
   *     This is the migration-safe form of an idiom worth understanding, because
   *     it appears three times in functions/src/runs/index.ts today
   *     (`completeTaskForTeam`, `skipStage`, `skipTaskForTeam`):
   *
   *         let skippedHeldTaskIds: string[] = [];        // outside the txn
   *         await db.runTransaction(async (tx) => {
   *           skippedHeldTaskIds = [];                    // ← FIRST statement
   *           …push ids of tasks that were auto-skipped while still 'assigned'…
   *         });
   *         for (const id of skippedHeldTaskIds) await releaseTask(id, …);
   *
   *     WHY THE RESET EXISTS: the body re-executes on contention, and each
   *     attempt re-derives the same ids. Without the reset at the TOP of the
   *     body, attempt 2 APPENDS to attempt 1's list and the post-commit loop
   *     releases every station slot twice — the station-slot-leak/double-release
   *     class of bug this repo has shipped before (a counter drained below the
   *     real occupancy hands a full station out again).
   *
   *     WHY IT BECOMES UNNECESSARY (BUT STAYS HARMLESS) UNDER SQL: a Postgres
   *     transaction body runs ONCE, so there is no second append to guard
   *     against. The reset is then dead code — not wrong, just inert. Rather
   *     than depend on that, this helper removes the hazard structurally: the
   *     mutator RETURNS its side-effect data and this method returns it onward,
   *     so there is no outer accumulator to reset and no way to write the
   *     accumulating version. That also matches the transaction contract, where
   *     the return value is the only channel out of a body that may re-run.
   *
   *  4. `updatedAt` IS NOT TOUCHED. See teams.README.md — a repository never
   *     invents a timestamp (README rule 1), and none of these signatures take a
   *     `now`. The caller stamps it.
   */
  async rewriteStages<R>(
    scope: TeamScope,
    what: string,
    mutate: (stages: RunStageRecord[], team: RunTeam) => R,
  ): Promise<R> {
    const team = await this.requireTeam(scope, what);
    const stages = cloneStages(readStages(team, what, scope));
    const result = mutate(stages, team);
    await guard(what, () => this.io.update(this.teamRef(scope), { stages }));
    return result;
  }

  /**
   * Rebuild the WHOLE progress tree.
   *
   * Reserved for run build (`joinRun`'s `buildInitialStages`) and whole-tree
   * operations (`startTeams` stamping `startedAt` on stage 0, `skipStage`). A
   * per-task change must go through `patchTaskRecord` instead, so the SQL
   * implementation does not rewrite rows it did not change — under Firestore
   * both cost exactly one document write, so nothing here signals which is
   * cheaper; the interface does.
   *
   * Unlike the record patches this does NOT read first: it is a blind overwrite
   * by definition, so it costs one write and is legal after other writes inside
   * a transaction.
   */
  async replaceTeamStages(scope: TeamScope, stages: RunStageRecord[]): Promise<void> {
    if (!Array.isArray(stages)) {
      throw new DataError(
        'failed-precondition',
        'replaceTeamStages: stages must be an array',
      );
    }
    await guard('replaceTeamStages', () =>
      this.io.update(this.teamRef(scope), { stages }));
  }


  // ── stage records ───────────────────────────────────────────────────────

  /**
   * One stage record, by key.
   *
   * `null` means "this team has no stage with that id". A MISSING TEAM also
   * yields `null` — a `get` on this interface reports absence rather than
   * throwing, and the two absences are not distinguished (call `getTeam` when
   * that difference matters). The write paths take the opposite stance: they
   * refuse a missing team with `not-found`, per README rule 2.
   */
  async getStageRecord(scope: TeamScope, stageId: string): Promise<RunStageRecord | null> {
    const team = await this.getTeam(scope);
    if (!team) return null;
    const stages = readStages(team, 'getStageRecord', scope);
    return stages.find((s) => s.stageId === stageId) ?? null;
  }

  /**
   * Patch ONE stage record in place (status, startedAt, completedAt,
   * requiredTaskCount, earnedScore).
   *
   * `requiredTaskCount` is the interesting one: `skipTaskForTeam` lowers THAT
   * TEAM's stored requirement so a skip cannot strand it, and it must land on
   * the team's stage record and never on the game template — which later runs
   * replay and the Builder rewrites wholesale (CLAUDE.md). Addressing the record
   * by (teamId, stageId) makes writing it to the template unrepresentable here.
   */
  async patchStageRecord(
    scope: TeamScope,
    stageId: string,
    patch: StageRecordPatch,
  ): Promise<void> {
    const what = 'patchStageRecord';
    const raw = patch as Record<string, unknown> | undefined;
    assertNoIdentityFields(raw, STAGE_IDENTITY_FIELDS, what);
    // An empty patch writes nothing — and, unlike a top-level patch, must not
    // even READ, because a pointless read inside a transaction still enlarges
    // that transaction's read set and so its contention surface.
    if (isNoOpPatch(raw)) return;

    await this.rewriteStages(scope, what, (stages) => {
      const si = findStageIndex(stages, stageId);
      if (si < 0) {
        throw new DataError(
          'not-found',
          `${what}: stage ${stageId} not found on team ${scope.teamId}`,
          { stageId, teamId: scope.teamId },
        );
      }
      // Three-valued patch semantics come from patch.ts — DELETE removes the
      // key, `null` stores a real null, absent leaves it alone — so they are
      // identical to a top-level `.update()` patch. Reimplementing them here is
      // how the two would drift.
      stages[si] = applyPatchInMemory(stages[si], raw, what);
    });
  }


  // ── task records ────────────────────────────────────────────────────────

  /**
   * One task record, by (stageId, taskId). `null` for a missing team, a missing
   * stage or a missing task — see `getStageRecord` on why a read does not
   * distinguish them.
   */
  async getTaskRecord(
    scope: TeamScope,
    stageId: string,
    taskId: string,
  ): Promise<RunTaskRecord | null> {
    const team = await this.getTeam(scope);
    if (!team) return null;
    const stages = readStages(team, 'getTaskRecord', scope);
    const stage = stages.find((s) => s.stageId === stageId);
    if (!stage) return null;
    return (stage.tasks ?? []).find((t) => t.taskId === taskId) ?? null;
  }

  /**
   * Patch ONE task record in place — the hottest write in the system, and the
   * one that becomes a single-row UPDATE.
   *
   * The row-shaped signature is not cosmetic. Everything a completion stamps
   * (`status`, `completedAt`, `actualMinutes`, `earnedScore`, `scoreBreakdown`,
   * `excludedMs`, `expectedDurationMinutesAtCompletion`, `surveyResponse`,
   * `arrivedAt`) is a field OF THIS RECORD, and today each one is written by
   * rewriting the entire `stages` array of the entire team. Addressing the
   * record by key means the SQL implementation touches one row, while this
   * implementation keeps doing the array rewrite that Firestore requires — and
   * no call site has to know which.
   *
   * MISSING RECORD ⇒ `not-found`, never a silent no-op. Today's grading path
   * DOES no-op when a task cannot be located (`if (stageIdx < 0) return
   * {completed:false}`), but that is a POLICY decision the callable makes about
   * a duplicate/racing submission, and it makes it with the whole team state in
   * hand. At this layer "the record you named does not exist" is a fact, and
   * swallowing it would let a mis-keyed write look like a successful one. The
   * callable keeps its no-op by asking first (`getTaskRecord`) or by using the
   * atomic completion operation, which owns that policy.
   */
  async patchTaskRecord(
    scope: TeamScope,
    stageId: string,
    taskId: string,
    patch: TaskRecordPatch,
  ): Promise<void> {
    const what = 'patchTaskRecord';
    const raw = patch as Record<string, unknown> | undefined;
    assertNoIdentityFields(raw, TASK_IDENTITY_FIELDS, what);
    if (isNoOpPatch(raw)) return;

    await this.rewriteStages(scope, what, (stages) => {
      const si = findStageIndex(stages, stageId);
      if (si < 0) {
        throw new DataError(
          'not-found',
          `${what}: stage ${stageId} not found on team ${scope.teamId}`,
          { stageId, teamId: scope.teamId },
        );
      }
      const ti = findTaskIndex(stages[si], taskId);
      if (ti < 0) {
        throw new DataError(
          'not-found',
          `${what}: task ${taskId} not found in stage ${stageId} of team ${scope.teamId}`,
          { stageId, taskId, teamId: scope.teamId },
        );
      }
      stages[si].tasks[ti] = applyPatchInMemory(stages[si].tasks[ti], raw, what);
    });
  }
}


/**
 * True when a patch would write nothing.
 *
 * Deliberately NOT `isEmptyPatch` from patch.ts by another name — it is the same
 * predicate, but it is applied here for a second reason: a no-op nested patch
 * must skip the READ as well as the write, because inside a transaction an
 * unnecessary read still joins the read set and so widens the window in which a
 * conflicting commit forces a retry. On the hottest document in the system that
 * is a real cost, not a micro-optimisation.
 */
function isNoOpPatch(patch: Record<string, unknown> | null | undefined): boolean {
  if (!patch) return true;
  for (const k of Object.keys(patch)) {
    if (patch[k] !== undefined) return false;
  }
  return true;
}


// Compile-time proof that this class really is the whole team surface. If a
// method is added to `TeamRepository` and not here, THIS line fails rather than
// a call site.
const _satisfiesTeamRepository: new (
  ctx: FirestoreContext,
  io: TeamIo,
) => TeamRepository = FirestoreTeamRepository;
void _satisfiesTeamRepository;


/**
 * Convenience factory for standalone use (scripts, tests, a caller that wants
 * only the team surface). The composed `FirestoreRepository` constructs this
 * class directly with its own context and I/O instead.
 */
export function createFirestoreTeamRepository(
  deps: FirestoreDeps | FirestoreContext,
): FirestoreTeamRepository {
  const ctx = deps instanceof FirestoreContext ? deps : new FirestoreContext(deps);
  return new FirestoreTeamRepository(ctx, directTeamIo);
}
