// ─── Public gallery projection + the cross-run aggregates ────────────────────
//
// Phase 1, behaviour-neutral. Mirrors `functions/src/gallery/index.ts`,
// `functions/src/gallery/popularityStore.ts`, `functions/src/gallery/tagStats.ts`
// and the publish/unpublish fan-out in `functions/src/games/index.ts`.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// ⚠ THE PROJECTION CONTRACT — the one thing in this file that is a SECURITY
//   boundary rather than a style preference
// ═══════════════════════════════════════════════════════════════════════════
//
// `publicGames` and `publicTasks` are WORLD-READABLE (`allow read: if true` in
// firestore.rules). Firestore rules gate DOCUMENTS, not fields, and they do not
// run for the Admin SDK at all — so the contract is enforced HERE, on the WRITE
// PATH, exactly as `publishGame` enforces it today by building a named literal
// instead of spreading the template.
//
// This file therefore writes a public document by ALLOWLIST (`PUBLIC_GAME_FIELDS`
// / `PUBLIC_TASK_FIELDS`) and refuses outright if a server-secret key is present
// on the object it was handed. That is stricter than today's code, and
// deliberately so: today's safety comes from ONE call site being careful, which
// is not a property of the storage layer. A future caller that spreads a `Task`
// into a `PublicTask` — the exact shape of the leak — now FAILS LOUD instead of
// publishing answer keys to the internet. For a correct caller nothing changes,
// so this is not a behaviour change; it is the same bytes with a guard rail.
//
// Two specific rules that are NOT to be "fixed":
//
//  1. `approxLocation` carries the EXACT authored point of EVERY located mission,
//     hidden-location missions INCLUDED (change: gallery-exact-hidden-location).
//     It is computed by the shared helper `publicTaskLocation(task)` — in the
//     CALLER, because this layer never sees the source `Task`. Do NOT reintroduce
//     coarsening: coarsening is what collapsed a game's nearby hidden missions
//     onto one ~1 km cell and made the creator's map wrong (see CLAUDE.md and
//     MEMORY: gallery-map-stale-data). A hidden mission's exact spot IS
//     deliberately world-visible in the gallery; the in-game puzzle is sealed by
//     the participant sanitizer (`sanitizeTaskForParticipant`), a separate
//     control this projection never feeds.
//  2. The deprecated exact `coordinates` key is NEVER written. It is not merely
//     omitted from the allowlist by accident — `publishGame` drops it on purpose
//     so that re-publishing ERASES it from a document written by the old code. A
//     caller handing one over (e.g. by carrying a legacy document forward) has it
//     silently dropped rather than refused, because that IS the repair.

import {
  DataError,
  type Cursor,
  type Page,
  type PageRequest,
  type PublicGame,
  type PublicLike,
  type PublicTask,
  type SortDir,
} from '../types';
import type {
  AggregateRepository,
  BenchmarkDoc,
  PlayerProfileDoc,
  PublicRepository,
  PublicSearchQuery,
} from '../repository';

import {
  guard,
  type FirestoreContext,
  type FsDocumentData,
  type FsDocumentReference,
  type FsDocumentSnapshot,
  type FsQuery,
  type FsQueryDocumentSnapshot,
  type FsQuerySnapshot,
} from './context';
import { assertId, colPaths, docPaths } from './paths';
import { toDocumentData } from './patch';


// ═══════════════════════════════════════════════════════════════════════════
// The I/O seam (structurally identical to repository.ts's private `Io`)
// ═══════════════════════════════════════════════════════════════════════════
//
// Restated rather than imported: `repository.ts` declares it privately AND
// imports this module, so importing it back would make a module cycle — the kind
// that survives typecheck and turns into `undefined` at runtime after bundling
// (see MEMORY: stale shared bundle → INTERNAL). Structural typing makes the two
// interchangeable at the construction site with no cast.

export interface FsIo {
  readonly inTransaction: boolean;
  getDoc(ref: FsDocumentReference): Promise<FsDocumentSnapshot>;
  getQuery(query: FsQuery): Promise<FsQuerySnapshot>;
  set(ref: FsDocumentReference, data: FsDocumentData, options?: { merge?: boolean }): Promise<void>;
  update(ref: FsDocumentReference, data: FsDocumentData): Promise<void>;
  del(ref: FsDocumentReference): Promise<void>;
}


// ═══════════════════════════════════════════════════════════════════════════
// Batching — the 500-op cap, taken away from the caller
// ═══════════════════════════════════════════════════════════════════════════
//
// Mirrors `functions/src/batchUtil.ts` (and `repository.ts`, which exports the
// same pair; duplicated here for the module-cycle reason above). A Firestore
// WriteBatch is hard-capped at 500 ops, and a publish fan-out is bounded only by
// how many tasks a creator authored — a hand-rolled batch loop throws on commit
// and, being atomic, then writes NOTHING.

/** Firestore hard-caps a WriteBatch at 500 ops; leave margin for safety. */
const MAX_BATCH_OPS = 450;

/** Split `items` into ordered groups of at most `size`. Pure. */
function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new DataError('failed-precondition', 'chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}


// ═══════════════════════════════════════════════════════════════════════════
// Document paths with no owner in shared today
// ═══════════════════════════════════════════════════════════════════════════
//
// `FIRESTORE_PATHS` owns publicGames / publicTasks / publicLikes (and `paths.ts`
// derives their collections). These three are written as string literals in
// `functions/src` and appear nowhere in shared. Mirrored VERBATIM here, in one
// block, so the debt is visible instead of scattered inline.
//
// ⚠ TODO for whoever extends shared: move them into `FIRESTORE_PATHS` and let
// `paths.ts` derive them, then delete this block.

/** `publicTagStats/global` — the ONE denormalised tag histogram (tagStats.ts). */
const TAG_STATS_DOC = 'publicTagStats/global';
/** `benchmarks/{taskType}` — anonymised cross-run aggregate (runs/index.ts). */
const benchmarkDoc = (type: string) => `benchmarks/${assertId(type, 'benchmarkType')}`;
/** `players/{uid}` — cross-run player history, CF-write-only (runs/index.ts). */
const playerDoc = (uid: string) => `players/${assertId(uid, 'playerUid')}`;


// ═══════════════════════════════════════════════════════════════════════════
// The world-readable field allowlists
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every field `publishGame` writes into `publicGames/{gameId}`. Anything else on
 * the object handed over is DROPPED — a public document may only ever contain
 * fields somebody deliberately published.
 */
const PUBLIC_GAME_FIELDS: ReadonlyArray<keyof PublicGame> = [
  'id',
  'ownerUid',
  'ownerDisplayName',
  'title',
  'description',
  'mode',
  'scoringPreset',
  'tags',
  'coverImage',
  'approxLocation',
  'playCount',
  'stageCount',
  'taskCount',
  'estimatedTotalMinutes',
  'requirement',
  'allowInstantPlay',
  'instructions',
  'likeCount',
  'popularity',
  'createdAt',
  'updatedAt',
];

/**
 * Every field `publishGame` writes into `publicTasks/{sourceGameId}_{taskId}`.
 *
 * `coordinates` is ABSENT ON PURPOSE — see rule 2 in the header. So is anything
 * from the authored `Task` that is not on this list.
 */
const PUBLIC_TASK_FIELDS: ReadonlyArray<keyof PublicTask> = [
  'id',
  'sourceGameId',
  'sourceGameTitle',
  'ownerUid',
  'ownerDisplayName',
  'title',
  'description',
  'type',
  'approxLocation',
  'difficulty',
  'estimatedMinutes',
  'pointValue',
  'tags',
  'copyCount',
  'likeCount',
  'popularity',
  'createdAt',
];

/**
 * Keys whose PRESENCE on an object bound for a world-readable document is a bug,
 * not a value to drop quietly.
 *
 * These are the server-secret task fields the participant sanitizer strips
 * (`answers`, `numericAnswer`, `steps[].answer`, `hint`, `smart.secretCode`) and
 * the game-level secrets (`stages` — which contains every answer key —
 * `integrationWebhookUrl`, `safeZone`). The allowlist above would already drop
 * them, but silence is the wrong response: an object carrying an answer key into
 * the gallery means a caller spread a template where it should have projected,
 * and that caller must find out.
 */
const REFUSED_PUBLIC_KEYS: readonly string[] = [
  // task-level
  'answers',
  'numericAnswer',
  'steps',
  'hint',
  'secretCode',
  'smart',
  // game-level
  'stages',
  'integrationWebhookUrl',
  'safeZone',
];


// ═══════════════════════════════════════════════════════════════════════════
// Helpers — MECHANICALLY DUPLICATED from repository.ts, deliberately
// ═══════════════════════════════════════════════════════════════════════════
//
// Same module-cycle reason as `FsIo`: `repository.ts` keeps them `protected`.
// Byte-for-byte the same decisions, cursor encoding included (plain JSON —
// `btoa` needs `lib.dom`, `Buffer` needs `@types/node`, and this package's real
// build config has neither).

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

/**
 * Refuse a server-secret key, then copy ONLY the allowlisted fields.
 *
 * `undefined` values are omitted (the driver is configured with
 * `ignoreUndefinedProperties`, but a test double or a future driver would reject
 * them — `toDocumentData` makes the same choice for the same reason).
 */
function projectPublic<T extends object>(
  value: T,
  allow: ReadonlyArray<keyof T>,
  what: string,
): Record<string, unknown> {
  const src = value as unknown as Record<string, unknown>;
  for (const key of REFUSED_PUBLIC_KEYS) {
    if (src[key] !== undefined) {
      throw new DataError(
        'failed-precondition',
        `${what}: refusing to write ${JSON.stringify(key)} into a WORLD-READABLE document. ` +
          'publicGames/publicTasks are `allow read: if true`; server-secret fields ' +
          '(answers / numericAnswer / steps[].answer / hint / secretCode, and the whole ' +
          'game template) must never appear in the projection. Build the public document ' +
          'from named fields, as publishGame does — never by spreading a Game or Task.',
        { key },
      );
    }
  }
  const out: Record<string, unknown> = {};
  for (const key of allow) {
    const v = src[key as string];
    if (v === undefined) continue;
    out[key as string] = v;
  }
  return out;
}


// ═══════════════════════════════════════════════════════════════════════════
// The store
// ═══════════════════════════════════════════════════════════════════════════

export class FirestoreGalleryStore implements PublicRepository, AggregateRepository {
  constructor(
    protected readonly ctx: FirestoreContext,
    protected readonly io: FsIo,
  ) {}

  // ── low-level helpers (see the block comment above) ──────────────────────

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

  protected async writeDoc(path: string, data: Record<string, unknown>, what: string): Promise<void> {
    await guard(what, () => this.io.set(this.doc(path), toDocumentData(data, what)));
  }

  // NOTE there is no `patchDoc` here: `PublicRepository` has no patch method.
  // A world-readable document is REPLACED whole from a fresh projection, never
  // field-patched — a patch would leave whatever an older projection wrote.

  protected async deleteDoc(path: string, what: string): Promise<void> {
    await guard(what, () => this.io.del(this.doc(path)));
  }

  protected async pageQuery<T>(
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
      if (raw.length === limit) {
        const last = raw[raw.length - 1] as FsQueryDocumentSnapshot;
        const data = last.data();
        page.nextCursor = encodeCursor(order.map((o) => data[o.field] ?? null));
      }
      return page;
    });
  }


  // ═════════════════════════════════════════════════════════════════════════
  // publicGames
  // ═════════════════════════════════════════════════════════════════════════

  async getPublicGame(gameId: string): Promise<PublicGame | null> {
    return this.readDoc<PublicGame>(docPaths.publicGame(gameId), 'getPublicGame');
  }

  /**
   * Whole-document create-or-replace of the world-readable game card, through the
   * allowlist. `publishGame` `set`s it whole too — which is exactly why the
   * caller must carry `likeCount`/`createdAt` forward from the prior document
   * (re-publishing a game must not reset its accumulated ranking signals, and
   * the newness term of `popularity` has to date from the FIRST publication or
   * re-publishing becomes a way to refresh your own ranking).
   *
   * `popularity` is a stored, derived field — Firestore can only order by a
   * stored field. It must be recomputed from the counters ON THIS OBJECT
   * (`scoreFor('game', publicGame)`); this layer does not compute it, because a
   * repository that silently rewrote a ranking would be a second owner of it.
   */
  async putPublicGame(game: PublicGame): Promise<void> {
    if (!game?.id) {
      throw new DataError(
        'failed-precondition',
        'putPublicGame: PublicGame.id is required (ids come from the caller)',
      );
    }
    await this.writeDoc(
      docPaths.publicGame(game.id),
      projectPublic(game, PUBLIC_GAME_FIELDS, 'putPublicGame'),
      'putPublicGame',
    );
  }

  async deletePublicGame(gameId: string): Promise<void> {
    await this.deleteDoc(docPaths.publicGame(gameId), 'deletePublicGame');
  }


  // ═════════════════════════════════════════════════════════════════════════
  // publicTasks
  // ═════════════════════════════════════════════════════════════════════════

  async getPublicTask(publicTaskId: string): Promise<PublicTask | null> {
    return this.readDoc<PublicTask>(docPaths.publicTask(publicTaskId), 'getPublicTask');
  }

  /**
   * REPLACE the entire published task set of one source game.
   *
   * Stronger than today on purpose (see the interface doc): `publishGame` writes
   * the current tasks and never deletes the rows for tasks the creator removed,
   * so a deleted mission stays in the world-readable gallery forever. Modelling
   * publish as a REPLACE closes that where neither backend can reintroduce it.
   *
   * `carryForward(next, prior)` is applied INSIDE the write, before the
   * allowlist, and is how `copyCount` / `likeCount` / `createdAt` survive a
   * re-publish. `prior` is `null` for a task published for the first time.
   *
   * NOT ATOMIC, and honest about it: the prior set is discovered by a query
   * (`sourceGameId ==`) whose size is bounded only by how many tasks the creator
   * authored, so this cannot be one transaction and cannot run inside one.
   * Writes commit in `MAX_BATCH_OPS` chunks — today's single `batch.commit()`
   * would throw at >500 tasks and then publish nothing at all.
   */
  async replacePublicTasksForGame(
    gameId: string,
    tasks: PublicTask[],
    carryForward: (next: PublicTask, prior: PublicTask | null) => PublicTask,
  ): Promise<void> {
    this.assertNotInTransaction('replacePublicTasksForGame');
    return guard('replacePublicTasksForGame', async () => {
      const priorSnap = await this.io.getQuery(
        this.ctx.db.collection(colPaths.publicTasks()).where('sourceGameId', '==', gameId),
      );
      const prior = new Map<string, PublicTask>();
      for (const d of priorSnap.docs) prior.set(d.id, d.data() as unknown as PublicTask);

      const writes: Array<{ ref: FsDocumentReference; data: Record<string, unknown> }> = [];
      const keep = new Set<string>();
      for (const task of tasks) {
        if (!task?.id) {
          throw new DataError(
            'failed-precondition',
            'replacePublicTasksForGame: every PublicTask needs an id ' +
              '(the published id is derived by the caller: `${sourceGameId}_${taskId}`)',
          );
        }
        keep.add(task.id);
        const merged = carryForward(task, prior.get(task.id) ?? null);
        writes.push({
          ref: this.doc(docPaths.publicTask(task.id)),
          data: projectPublic(merged, PUBLIC_TASK_FIELDS, 'replacePublicTasksForGame'),
        });
      }

      const deletes: FsDocumentReference[] = [];
      for (const d of priorSnap.docs) if (!keep.has(d.id)) deletes.push(d.ref);

      // Writes first, deletes after: if a chunk fails mid-way the gallery is left
      // holding a SUPERSET of the truth (a stale extra card) rather than a
      // MISSING mission — the strictly less wrong of the two partial states.
      for (const group of chunk(writes, MAX_BATCH_OPS)) {
        const batch = this.ctx.db.batch();
        for (const w of group) batch.set(w.ref, toDocumentData(w.data, 'replacePublicTasksForGame'));
        await batch.commit();
      }
      for (const group of chunk(deletes, MAX_BATCH_OPS)) {
        const batch = this.ctx.db.batch();
        for (const ref of group) batch.delete(ref);
        await batch.commit();
      }
    });
  }

  /**
   * Remove every published task of a game — the unpublish / delete-game path
   * (`publishGame` with `visibility:'private'`, and `purgeGameTree`).
   *
   * NOTE for the caller: today's unpublish reads the tags off these documents
   * BEFORE deleting them, so the denormalised tag histogram can be decremented
   * (`bumpTagStats([], priorTags)`). This method only deletes; read the tasks
   * first (or capture them from `replacePublicTasksForGame`'s input) if the
   * histogram matters — the alternative would be a repository method that
   * silently owned the histogram too.
   */
  async deletePublicTasksForGame(gameId: string): Promise<void> {
    this.assertNotInTransaction('deletePublicTasksForGame');
    return guard('deletePublicTasksForGame', async () => {
      const snap = await this.io.getQuery(
        this.ctx.db.collection(colPaths.publicTasks()).where('sourceGameId', '==', gameId),
      );
      for (const group of chunk(snap.docs.map((d) => d.ref), MAX_BATCH_OPS)) {
        const batch = this.ctx.db.batch();
        for (const ref of group) batch.delete(ref);
        await batch.commit();
      }
    });
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Gallery search — the tag-and-order slice, and nothing more
  // ═════════════════════════════════════════════════════════════════════════
  //
  // Relevance ranking, facet filtering (`mode`/`type`/`difficulty`/`hasLocation`)
  // and the read-path location reconciliation all happen ABOVE this call, in
  // memory — `rankGalleryResults` / `applyGalleryFacets` / `publicTaskForLibrary`
  // (@rushpoint/shared + functions/src/gallery). That is not a simplification:
  // Firestore cannot express any of them, so a repository that pretended to would
  // be promising a Postgres implementation something the interface never said.
  //
  // ⚠ PRESERVED-BEHAVIOUR GAP, FLAGGED. `searchGallery`/`searchTaskLibrary` do
  // NOT issue just this one query: `fetchRankedWindow` unions the
  // popularity-ordered window with a BOUNDED UNORDERED fallback fetch, deduped by
  // id, because `orderBy('popularity')` EXCLUDES documents that lack the field —
  // and the field is new, so a game published before it would silently vanish
  // from the gallery. That union cannot be expressed in this method's shape (one
  // named query, one order, one page), so it stays the CALLER's composition:
  // `orderBy:'createdAt'` is the second shape, and every document has a
  // `createdAt`. Do not quietly drop the union — quietly dropping it is exactly
  // "the gallery lost every legacy game and nothing errored".
  //
  // ⚠ INDEX NOTE. `(tags array-contains, popularity desc)` exists for BOTH
  // collections and `(tags, createdAt desc)` exists for `publicTasks`. For
  // `publicGames` the second stored index is `(tags, updatedAt desc)`, NOT
  // `createdAt` — so `searchPublicGames({ tags, orderBy: 'createdAt' })` needs a
  // NEW composite index before use. The emulator auto-indexes, so a missing one
  // is invisible in dev and fails only in production.

  async searchPublicGames(q: PublicSearchQuery): Promise<Page<PublicGame>> {
    return this.pageQuery<PublicGame>(
      this.withTags(this.ctx.db.collection(colPaths.publicGames()), q.tags),
      [{ field: q.orderBy, dir: q.dir }],
      q,
      'searchPublicGames',
    );
  }

  async searchPublicTasks(q: PublicSearchQuery): Promise<Page<PublicTask>> {
    return this.pageQuery<PublicTask>(
      this.withTags(this.ctx.db.collection(colPaths.publicTasks()), q.tags),
      [{ field: q.orderBy, dir: q.dir }],
      q,
      'searchPublicTasks',
    );
  }

  /**
   * Match ANY of `tags`; absent/empty ⇒ no tag constraint.
   *
   * `.slice(0, 10)` is Firestore's hard limit on `array-contains-any` disjuncts —
   * mirrored VERBATIM from `fetchRankedWindow`. An 11th tag is silently ignored
   * there and here; refusing it would break a caller that works today.
   */
  protected withTags(base: FsQuery, tags: string[] | undefined): FsQuery {
    if (!tags || tags.length === 0) return base;
    return base.where('tags', 'array-contains-any', tags.slice(0, 10));
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Likes
  // ═════════════════════════════════════════════════════════════════════════
  //
  // One like per (kind, item, user) is a property of the ADDRESS
  // (`publicLikes/{kind}_{itemId}_{uid}`), not of a check — a second like from
  // the same user resolves to the same document, whatever the client sends. The
  // mutation is `togglePublicLike` (atomic.ts), because the like record and the
  // denormalised `likeCount`/`popularity` must move together.

  async getPublicLike(
    kind: 'game' | 'task',
    itemId: string,
    uid: string,
  ): Promise<PublicLike | null> {
    return this.readDoc<PublicLike>(
      docPaths.publicLike(kind, itemId, uid),
      'getPublicLike',
    );
  }

  /**
   * Which of `itemIds` this user has liked — POINT READS by deterministic id, not
   * a `where('uid','==',…)` query. That is today's choice in `likedIdsFor`: no
   * index, no fan-out, and it reuses the id shape that makes one-like-per-user
   * structural.
   *
   * Today's version batches them with `db.getAll(...)`. `getAll` is not on the
   * structural driver (context.ts is the SMALLEST subset this package uses), so
   * these are N parallel point reads: the same N document reads, one round trip
   * each instead of one shared. Bounded by the caller's result page.
   */
  async listLikedItemIds(
    kind: 'game' | 'task',
    uid: string,
    itemIds: string[],
  ): Promise<string[]> {
    if (itemIds.length === 0) return [];
    return guard('listLikedItemIds', async () => {
      const snaps = await Promise.all(
        itemIds.map((id) => this.io.getDoc(this.doc(docPaths.publicLike(kind, id, uid)))),
      );
      return itemIds.filter((_, i) => snaps[i].exists);
    });
  }


  // ═════════════════════════════════════════════════════════════════════════
  // The legacy-repair scan
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Page the WHOLE `publicTasks` collection by document id.
   *
   * SCAN, DON'T QUERY — verbatim from `backfillPublicTaskCoordinates`. There is
   * no "field exists" filter in Firestore, and the `orderBy(field)` trick that
   * approximates one would need a dedicated index for a job that runs a handful
   * of times, ever. Paging by `__name__` costs one read per public task, needs no
   * index, and — the load-bearing part — it also SEES documents whose
   * `coordinates` value is malformed, which a field-ordered query would skip.
   *
   * The cursor therefore carries the last document ID, not a stored field value,
   * which is why this does not go through `pageQuery`.
   */
  async scanPublicTasks(page: PageRequest): Promise<Page<PublicTask>> {
    return guard('scanPublicTasks', async () => {
      const limit = Math.max(1, Math.floor(page.limit));
      let q: FsQuery = this.ctx.db.collection(colPaths.publicTasks()).orderBy('__name__');
      const after = decodeCursor(page.cursor, 'scanPublicTasks');
      if (after) q = q.startAfter(...after);
      const snap = await this.io.getQuery(q.limit(limit));

      const raw = snap.docs;
      const out: Page<PublicTask> = { items: raw.map((d) => d.data() as unknown as PublicTask) };
      if (raw.length === limit) {
        out.nextCursor = encodeCursor([raw[raw.length - 1]!.id]);
      }
      return out;
    });
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Tag histogram
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * The denormalised tag histogram behind the tag picker — ONE point read of
   * `publicTagStats/global` (Firestore cannot aggregate, so the counts are
   * maintained transactionally by `bumpTagStats` in atomic.ts).
   *
   * FAILS OPEN to `{}` — including on a read error, matching
   * `readStoredTagCounts`. An empty histogram degrades to the recommended-tag
   * seeds; it never breaks the page. This is the one method in the file allowed
   * to swallow, and it does so because the STORED value is advisory: there is no
   * caller decision that an empty histogram makes wrong.
   *
   * SHAPE TRANSLATION: the document stores
   * `{ tags: { <lowercased key>: { tag, n } }, updatedAt }`, while the interface
   * asks for `Record<string, number>`. The projection keeps the first-seen CASING
   * as the key (that is what a picker renders) and drops malformed or
   * non-positive entries, mirroring `cleanBase`. Both stored generations are
   * tolerated: `{tag,n}` and a bare number.
   */
  async getTagStats(): Promise<Record<string, number>> {
    let stored: unknown;
    try {
      const snap = await this.io.getDoc(this.doc(TAG_STATS_DOC));
      if (!snap.exists) return {};
      stored = (snap.data() ?? {})['tags'];
    } catch {
      return {}; // fail open — see above
    }
    if (!stored || typeof stored !== 'object') return {};

    const out: Record<string, number> = {};
    for (const [rawKey, val] of Object.entries(stored as Record<string, unknown>)) {
      const entry = (val && typeof val === 'object' ? val : null) as
        { tag?: unknown; n?: unknown } | null;
      const tag = typeof entry?.tag === 'string' && entry.tag ? entry.tag : rawKey;
      const n = Number(entry ? entry.n : val) || 0;
      if (!tag || n <= 0) continue;
      // Two raw keys can fold to the same tag (a doc that once stored both "Park"
      // and "park"); sum them rather than letting the last one win.
      out[tag] = (out[tag] ?? 0) + n;
    }
    return out;
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Cross-run aggregates (read side only)
  // ═════════════════════════════════════════════════════════════════════════
  //
  // Both are written by `finalizeRun`'s fan-out under a transactional claim
  // (`benchmarkContributed` / `profileRecorded`) so a duplicate trigger delivery
  // cannot double-count. Those merges are `mergeBenchmark` / `recordPlayerResult`
  // in atomic.ts; these are the plain reads.

  /**
   * `benchmarks/{taskType}` — anonymised, cross-tenant, no per-run identifiers.
   * `null` for a task type nothing has finished yet; the caller decides what an
   * absent benchmark means (today's merge treats it as the first sample).
   */
  async getBenchmark(type: string): Promise<BenchmarkDoc | null> {
    return this.readDoc<BenchmarkDoc>(benchmarkDoc(type), 'getBenchmark');
  }

  /** `players/{uid}` — cross-run history + badges. CF-write-only. */
  async getPlayerProfile(uid: string): Promise<PlayerProfileDoc | null> {
    return this.readDoc<PlayerProfileDoc>(playerDoc(uid), 'getPlayerProfile');
  }


  // ── guards ───────────────────────────────────────────────────────────────

  /**
   * A publish fan-out is bounded only by how many tasks a creator authored, so it
   * is a SWEEP, not an atom: it discovers its own work set with a query and
   * commits in chunks. A transaction is finite and small (transaction.ts rule 5),
   * and a re-executed body would re-run the whole fan-out — so refuse rather than
   * appear to work.
   */
  protected assertNotInTransaction(method: string): void {
    if (this.io.inTransaction) {
      throw new DataError(
        'failed-precondition',
        `${method}: this fan-out is unbounded and may not run inside a transaction`,
        { method },
      );
    }
  }
}

// Compile-time proof that this class really is the whole gallery surface. If a
// method is added to either interface and not to the class, THIS line fails
// rather than a call site in repository.ts.
const _satisfiesGallery: new (
  ctx: FirestoreContext,
  io: FsIo,
) => PublicRepository & AggregateRepository = FirestoreGalleryStore;
void _satisfiesGallery;
