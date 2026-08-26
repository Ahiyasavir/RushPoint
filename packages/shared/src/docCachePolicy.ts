// Pure policy for the API process's document cache (change: vps-firestore-read-offload).
//
// This module holds the DECISIONS — hit/miss, what a write invalidates, what eviction
// drops — and knows nothing about Firestore. `functions/src/docCache.ts` binds it to the
// real handle. Keeping the policy here means the whole coherence contract is testable
// without an emulator, exactly like the scoring and geo helpers.
//
// PRECONDITION FOR THE WHOLE DESIGN: the API process is the SOLE writer of the documents
// cached through this policy (firestore.rules denies client writes on runs/teams and their
// subcollections; the game template is persisted through the `updateGame` callable), and
// there is exactly ONE such process. If the API is ever scaled horizontally, two caches can
// disagree and this design must be revisited first.
//
// Two rules earn their own explanation:
//
//  1. A WRITE INVALIDATES; IT NEVER MERGES. Firestore writes carry FieldValue sentinels —
//     `taskCounts` uses increment, others use arrayUnion / serverTimestamp — so the
//     post-write document cannot be computed locally without reimplementing Firestore's
//     merge semantics, including the dotted-path and array-coercion footguns. Dropping the
//     entry costs one read next time and can never produce a wrong value.
//
//  2. MEMBERSHIP TURNS ON THE VERB. `update()` fails on a missing document, so it can never
//     change WHICH documents a collection contains — only their contents. Keeping membership
//     across updates is what makes this worth building: a real run does hundreds of team
//     progress writes (all updates) against a `listRunTeams` poll every 5s, so membership
//     stays warm and only the touched documents are re-read. `set`/`create`/`delete` may add
//     or remove a member, so they drop it.
//
// The TTL is a SAFETY NET, not the coherence mechanism. Coherence comes from invalidation.
// The TTL only bounds how long a stale entry could survive if a write ever reached Firestore
// without passing through the interceptor — turning an unbounded correctness bug into a
// bounded one.

/** What a write did, which decides whether collection membership can have changed. */
export type WriteVerb = 'set' | 'create' | 'update' | 'delete';

/** A cached document. `exists: false` records a confirmed absence. */
export interface CachedDoc<T = unknown> {
  exists: boolean;
  data?: T;
}

export type DocLookup<T = unknown> =
  | { hit: false }
  | { hit: true; entry: CachedDoc<T> };

export type MembersLookup =
  | { hit: false }
  | { hit: true; ids: string[] };

export interface DocCachePolicyOptions {
  /** Combined bound over held documents and memberships. */
  maxEntries: number;
  /** Safety-net lifetime. See the note above — this is not the coherence mechanism. */
  ttlMs: number;
  /**
   * Whether reads may be served from memory. DEFAULTS TO FALSE, deliberately.
   *
   * The whole design rests on "one process is the sole writer", and that is a property of
   * the DEPLOYMENT, not of this code. It holds on the VPS (functions/server.js, one Express
   * process, one container). It does NOT hold under the Firebase Functions emulator, which
   * runs a RuntimeWorkerPool of separate Node processes — nor would it hold on real Cloud
   * Functions, which auto-scales to many instances. In either of those a write in one
   * process cannot invalidate another process's copy, and reads go silently stale.
   *
   * So the default is the SAFE one and the fast path is opted into explicitly, by the one
   * environment whose topology has been checked. A wrong deployment then loses a
   * performance win instead of corrupting a live game.
   *
   * Write invalidation runs regardless — it is cheap and keeps the disabled path from
   * diverging.
   */
  enabled?: boolean;
}

export interface DocCachePolicy {
  getDoc<T = unknown>(path: string, nowMs: number): DocLookup<T>;
  putDoc<T = unknown>(path: string, entry: CachedDoc<T>, nowMs: number): void;
  getMembers(collectionPath: string, nowMs: number): MembersLookup;
  putMembers(collectionPath: string, ids: string[], nowMs: number): void;
  /** Apply a write: drop the document, and its parent membership unless it was an update. */
  invalidateWrite(path: string, verb: WriteVerb): void;
  /** Drop everything at or under `prefix` — used when a run finalizes. */
  dropPrefix(prefix: string): void;
  size(): number;
}

interface Held {
  storedAtMs: number;
  doc?: CachedDoc;
  ids?: string[];
}

const DOC = 'd:';
const MEMBERS = 'm:';

/** The collection a document path sits in: everything before the final segment. */
function parentCollection(docPath: string): string {
  const i = docPath.lastIndexOf('/');
  return i < 0 ? '' : docPath.slice(0, i);
}

/** The path a cache key refers to, for prefix matching. */
function pathOfKey(key: string): string {
  return key.slice(2);
}

export function createDocCachePolicy(opts: DocCachePolicyOptions): DocCachePolicy {
  // One Map for both kinds so the bound covers total memory rather than each half.
  // Map preserves insertion order, so deleting the first key evicts least-recently-used
  // provided every read re-inserts (see `touch`).
  const held = new Map<string, Held>();
  const enabled = opts.enabled === true;

  function evictIfNeeded(): void {
    while (held.size > opts.maxEntries) {
      const oldest = held.keys().next();
      if (oldest.done) return;
      held.delete(oldest.value);
    }
  }

  function live(key: string, nowMs: number): Held | undefined {
    const e = held.get(key);
    if (!e) return undefined;
    if (nowMs - e.storedAtMs >= opts.ttlMs) {
      held.delete(key);
      return undefined;
    }
    // Re-insert to move this key to the most-recently-used end.
    held.delete(key);
    held.set(key, e);
    return e;
  }

  function put(key: string, value: Held): void {
    held.delete(key);
    held.set(key, value);
    evictIfNeeded();
  }

  return {
    getDoc<T>(path: string, nowMs: number): DocLookup<T> {
      if (!enabled) return { hit: false };
      const e = live(DOC + path, nowMs);
      if (!e || !e.doc) return { hit: false };
      return { hit: true, entry: e.doc as CachedDoc<T> };
    },

    putDoc<T>(path: string, entry: CachedDoc<T>, nowMs: number): void {
      if (!enabled) return;
      put(DOC + path, { storedAtMs: nowMs, doc: entry as CachedDoc });
    },

    getMembers(collectionPath: string, nowMs: number): MembersLookup {
      if (!enabled) return { hit: false };
      const e = live(MEMBERS + collectionPath, nowMs);
      if (!e || !e.ids) return { hit: false };
      return { hit: true, ids: e.ids };
    },

    putMembers(collectionPath: string, ids: string[], nowMs: number): void {
      if (!enabled) return;
      put(MEMBERS + collectionPath, { storedAtMs: nowMs, ids: ids.slice() });
    },

    invalidateWrite(path: string, verb: WriteVerb): void {
      held.delete(DOC + path);
      // An update cannot create or remove a document, so the collection still contains
      // exactly the same ids — keep membership warm. Every other verb might have changed
      // it, and we cannot tell from here whether it did, so drop it.
      if (verb !== 'update') held.delete(MEMBERS + parentCollection(path));
    },

    dropPrefix(prefix: string): void {
      // Segment-aware: `runs/run1` must not match `runs/run10`.
      for (const key of [...held.keys()]) {
        const p = pathOfKey(key);
        if (p === prefix || p.startsWith(prefix + '/')) held.delete(key);
      }
    },

    size: () => held.size,
  };
}
