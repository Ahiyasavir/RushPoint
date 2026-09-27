// Binds the pure cache policy to a real Firestore handle (change: vps-firestore-read-offload).
//
// ⚠️ PRECONDITION FOR THIS ENTIRE MODULE — read before changing anything here:
//
//   (a) The API process is the SOLE writer of the documents cached through this layer.
//       `firestore.rules` is `allow write: if false` on users/{uid}/games/{gameId}/runs/{runId},
//       its `teams` subcollection and every other run subcollection; the Builder persists the
//       game template through the `updateGame` callable rather than a direct write.
//   (b) There is exactly ONE such process. functions/server.js has no `cluster`.
//
// Both are what make a process-local cache authoritative rather than a guess. If the API is
// ever scaled horizontally, or a client is ever granted a write to these paths, two caches can
// disagree and this design must be revisited FIRST.
//
// WHY INTERCEPTION SITS HERE AND NOT AT THE CALL SITES: there are 216 write call sites across
// 18 modules and 44 transactions in functions/src. Requiring each to remember an invalidation
// call is exactly the class of convention that rots — and one missed site means a stale
// document served to a live game. Wrapping the single exported `db` handle covers every
// existing site and every future one by construction. `scripts/test-doc-cache-interception.ts`
// fails the build if a module reaches around it.
//
// WHAT IS DELIBERATELY *NOT* CACHED: reads inside a transaction. Firestore's optimistic
// concurrency depends on `tx.get()` REGISTERING the read so a conflicting write aborts the
// transaction. Answering it from memory would silently disable that — and the station
// contention path (`FieldValue.increment` on `taskCounts`) is precisely where that would
// corrupt a live run. Transaction reads always go to the driver.

import type { DocCachePolicy, WriteVerb } from '@rushpoint/shared';
import { countFirestoreOp } from './opCounter';

/** Retrieves the unwrapped reference a proxy stands for. */
const RAW = Symbol('rushpoint.rawRef');

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Hand the driver the real reference, never our proxy. */
function unwrap<T>(ref: T): T {
  return (ref as any)?.[RAW] ?? ref;
}

// ── Operation counting (change: spark-tier-location-load) ────────────────────
// Attribution rides an AsyncLocalStorage context entered by `loggedCallable`; see
// opCounter.ts. `countFirestoreOp` never throws, so these calls are safe to make inline
// without a try/catch at each site — instrumentation must never fail a live request.
//
// Counting sits HERE for the same reason invalidation does (see the header): wrapping the
// single `db` handle covers every existing call site and every future one, where asking
// 216 call sites to remember a counter call is exactly the convention that rots.
//
// NOTE this counts reads the CACHE DID NOT SERVE — it sits below `cachedGetDoc`, so a
// cache hit never reaches the driver and is correctly never counted. That is what makes
// the number a measure of real quota spend rather than of call volume.

/**
 * How many document reads a query snapshot cost. Firestore bills a MINIMUM of one read
 * for a query that matches nothing, so an empty result is charged 1 rather than 0 —
 * otherwise a run full of empty lookups would project as free.
 */
function readsInSnapshot(snap: any): number {
  const size = snap?.size;
  return typeof size === 'number' && size > 0 ? size : 1;
}

const WRITE_VERBS = new Set<string>(['set', 'create', 'update', 'delete']);

// Query-builder methods that return a NEW Query. Each must be re-wrapped or the chain
// escapes interception and its snapshots hand out raw references.
const QUERY_CHAIN = new Set<string>([
  'where', 'orderBy', 'limit', 'limitToLast', 'offset', 'select',
  'startAt', 'startAfter', 'endAt', 'endBefore', 'withConverter',
]);

// A reference reached through a SNAPSHOT (`snap.ref`, `snap.docs[i].ref`) is a raw
// DocumentReference — writing through it would skip invalidation entirely. Three real call
// sites did exactly that (admin/templates.ts stamping a GAME doc, maintenance/index.ts
// clearing PII on a TEAM doc, runs/index.ts recording a player result), so snapshots are
// wrapped as well and `.ref` always comes back intercepted.
function wrapDocSnapshot(raw: any, onWrite: (path: string, verb: WriteVerb) => void): any {
  if (!raw) return raw;
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === 'ref') return wrapDocRef(target.ref, onWrite);
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function wrapQuerySnapshot(raw: any, onWrite: (path: string, verb: WriteVerb) => void): any {
  if (!raw) return raw;
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === 'docs') {
        return (target.docs as any[]).map((d) => wrapDocSnapshot(d, onWrite));
      }
      if (prop === 'forEach') {
        return (cb: (d: unknown) => void, thisArg?: unknown) =>
          (target.docs as any[]).forEach((d) => cb.call(thisArg, wrapDocSnapshot(d, onWrite)));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function wrapQuery(raw: any, onWrite: (path: string, verb: WriteVerb) => void): any {
  if (!raw) return raw;
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === RAW) return target;
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;

      if (typeof prop === 'string' && QUERY_CHAIN.has(prop)) {
        return (...args: unknown[]) => wrapQuery(value.apply(target, args), onWrite);
      }
      if (prop === 'get') {
        return async (...args: unknown[]) => {
          const snap = await value.apply(target, args);
          countFirestoreOp('read', readsInSnapshot(snap));
          return wrapQuerySnapshot(snap, onWrite);
        };
      }
      return value.bind(target);
    },
  });
}

function wrapDocRef(raw: any, onWrite: (path: string, verb: WriteVerb) => void): any {
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === RAW) return target;
      const value = Reflect.get(target, prop, target);

      if (typeof prop === 'string' && WRITE_VERBS.has(prop) && typeof value === 'function') {
        return async (...args: unknown[]) => {
          try {
            return await value.apply(target, args);
          } finally {
            // Invalidate in `finally`, not on success: invalidation is never wrong, only
            // occasionally wasteful (it costs one read). A write that threw may still have
            // landed — a partial batch, a timeout after commit — so failing toward a cold
            // read is the only safe direction.
            onWrite(target.path, prop as WriteVerb);
          }
        };
      }
      if (prop === 'get' && typeof value === 'function') {
        return async (...args: unknown[]) => {
          const snap = await value.apply(target, args);
          countFirestoreOp('read', 1);
          return wrapDocSnapshot(snap, onWrite);
        };
      }
      if (prop === 'collection' && typeof value === 'function') {
        return (...args: unknown[]) => wrapCollectionRef(value.apply(target, args), onWrite);
      }
      if (prop === 'parent' ) {
        return value ? wrapCollectionRef(value, onWrite) : value;
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function wrapCollectionRef(raw: any, onWrite: (path: string, verb: WriteVerb) => void): any {
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === RAW) return target;
      const value = Reflect.get(target, prop, target);

      if (prop === 'doc' && typeof value === 'function') {
        // Forward arguments FAITHFULLY — `collection.doc()` with NO argument auto-generates
        // an id, while `collection.doc(undefined)` is a validation error ("Path must be a
        // non-empty string"). Arity is part of the contract, so never normalise it to a
        // named parameter.
        return (...args: unknown[]) => wrapDocRef(value.apply(target, args), onWrite);
      }
      if (prop === 'add' && typeof value === 'function') {
        return async (...args: unknown[]) => {
          const ref = await value.apply(target, args);
          // `add` always creates, so the collection's membership changed.
          onWrite(`${target.path}/${ref.id}`, 'create');
          return wrapDocRef(ref, onWrite);
        };
      }
      // A CollectionReference IS a Query: `.where(...)` escapes into the query builder, and
      // its snapshots would otherwise hand out raw refs.
      if (typeof prop === 'string' && QUERY_CHAIN.has(prop) && typeof value === 'function') {
        return (...args: unknown[]) => wrapQuery(value.apply(target, args), onWrite);
      }
      if (prop === 'get' && typeof value === 'function') {
        return async (...args: unknown[]) => {
          const snap = await value.apply(target, args);
          countFirestoreOp('read', readsInSnapshot(snap));
          return wrapQuerySnapshot(snap, onWrite);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function wrapTransaction(raw: any, touched: Array<[string, WriteVerb]>): any {
  return new Proxy(raw, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;

      if (typeof prop === 'string' && WRITE_VERBS.has(prop)) {
        return (ref: any, ...rest: unknown[]) => {
          // Firestore buffers transaction writes until commit, so record now and
          // invalidate only once runTransaction settles.
          touched.push([unwrap(ref).path, prop as WriteVerb]);
          return value.call(target, unwrap(ref), ...rest);
        };
      }
      // `get` (and getAll) must reach the driver — see the note at the top of this file.
      // Because they ALWAYS reach it, they always cost quota: a transaction read is never
      // served from memory, so it is counted unconditionally.
      if (prop === 'get' || prop === 'getAll') {
        return async (...args: unknown[]) => {
          const result = await value.apply(target, args.map((a) => unwrap(a)));
          countFirestoreOp(
            'read',
            Array.isArray(result) ? Math.max(1, result.length) : readsInSnapshot(result),
          );
          return result;
        };
      }
      return (...args: unknown[]) => value.apply(target, args.map((a) => unwrap(a)));
    },
  });
}

function wrapBatch(raw: any, onWrite: (path: string, verb: WriteVerb) => void): any {
  const touched: Array<[string, WriteVerb]> = [];
  return new Proxy(raw, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;

      if (typeof prop === 'string' && WRITE_VERBS.has(prop)) {
        return (ref: any, ...rest: unknown[]) => {
          touched.push([unwrap(ref).path, prop as WriteVerb]);
          return value.call(target, unwrap(ref), ...rest);
        };
      }
      if (prop === 'commit') {
        return async (...args: unknown[]) => {
          try {
            return await value.apply(target, args);
          } finally {
            for (const [path, verb] of touched) onWrite(path, verb);
          }
        };
      }
      return value.bind(target);
    },
  });
}

/**
 * Wrap a Firestore handle so every write routes through `policy`. Reads are untouched —
 * the read-side cache is applied explicitly at chosen call sites (see `cachedGetDoc` /
 * `cachedGetCollection`), never transparently, so a transaction read can never be served
 * from memory.
 *
 * `nowFn` is injected so the pure suite can drive the TTL without a real clock.
 */
export function wrapFirestore<T extends object>(
  raw: T,
  policy: DocCachePolicy,
  _nowFn: () => number = Date.now,
): T {
  // Every write path already funnels through here to invalidate — document verbs, batch
  // ops (replayed from `touched` at commit) and transaction writes (replayed when
  // runTransaction settles) — so counting here covers all of them with one hook.
  //
  // A retried transaction replays `touched` and will over-count slightly. That is the
  // honest direction for a quota measurement: the retry's writes were genuinely attempted.
  const onWrite = (path: string, verb: WriteVerb) => {
    countFirestoreOp('write', 1);
    policy.invalidateWrite(path, verb);
  };

  return new Proxy(raw, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);

      if (prop === 'doc' && typeof value === 'function') {
        return (...args: unknown[]) => wrapDocRef((value as any).apply(target, args), onWrite);
      }
      if (prop === 'collection' && typeof value === 'function') {
        return (...args: unknown[]) =>
          wrapCollectionRef((value as any).apply(target, args), onWrite);
      }
      if (prop === 'batch' && typeof value === 'function') {
        return () => wrapBatch((value as any).call(target), onWrite);
      }
      if (prop === 'runTransaction' && typeof value === 'function') {
        return async (fn: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) => {
          const touched: Array<[string, WriteVerb]> = [];
          try {
            return await (value as any).call(
              target,
              (tx: unknown) => fn(wrapTransaction(tx, touched)),
              ...rest,
            );
          } finally {
            // A contended transaction may have RETRIED, so `touched` can hold duplicates —
            // harmless, since invalidation is idempotent. A rejected transaction invalidates
            // too, for the same fail-toward-cold reason as the document writes above.
            for (const [path, verb] of touched) policy.invalidateWrite(path, verb);
          }
        };
      }
      if (prop === 'getAll' && typeof value === 'function') {
        // Unwrap on the way in (the driver rejects our proxies' internals) and wrap on the
        // way out — admin/templates.ts writes through a `getAll` result's `.ref`.
        return async (...refs: unknown[]) => {
          const snaps = await (value as any).apply(target, refs.map((r) => unwrap(r)));
          countFirestoreOp('read', Math.max(1, (snaps as any[])?.length ?? 1));
          return (snaps as any[]).map((sn) => wrapDocSnapshot(sn, onWrite));
        };
      }
      if (prop === 'collectionGroup' && typeof value === 'function') {
        // Not wrapping this was a real hole: `db.collectionGroup('games')` snapshots handed
        // out raw refs, and admin/templates.ts stamped counts onto a GAME document — a
        // cached path — straight past invalidation.
        return (...args: unknown[]) => wrapQuery((value as any).apply(target, args), onWrite);
      }
      if (prop === 'recursiveDelete' && typeof value === 'function') {
        // recursiveDelete never touches doc()/collection(), so nothing else would notice it.
        // Drop the whole subtree: a purged game must not keep answering reads as if it
        // still existed.
        return async (ref: any, ...rest: unknown[]) => {
          const path = unwrap(ref)?.path;
          try {
            return await (value as any).call(target, unwrap(ref), ...rest);
          } finally {
            if (typeof path === 'string' && path) policy.dropPrefix(path);
          }
        };
      }
      return typeof value === 'function' ? (value as any).bind(target) : value;
    },
  }) as T;
}

/**
 * Read one document, serving it from `policy` when held. Pass `bypass` to force a cold read
 * — the operator escape hatch for a document suspected of having drifted.
 */
export async function cachedGetDoc<T = unknown>(
  db: any,
  policy: DocCachePolicy,
  path: string,
  opts: { bypass?: boolean; nowMs?: number } = {},
): Promise<{ exists: boolean; data?: T }> {
  const nowMs = opts.nowMs ?? Date.now();
  if (!opts.bypass) {
    const hit = policy.getDoc<T>(path, nowMs);
    if (hit.hit) return hit.entry;
  }
  const snap = await db.doc(path).get();
  // An absent document is recorded as absent — never as an existing one — so a repeat read
  // is free without a missing doc ever reading as present.
  const entry = snap.exists
    ? { exists: true, data: snap.data() as T }
    : { exists: false };
  policy.putDoc(path, entry, nowMs);
  return entry;
}

/**
 * Read every document of a collection, assembling it from held members and re-reading only
 * the ones that were invalidated. Falls back to a full collection read when membership is
 * not held.
 */
export async function cachedGetCollection<T = unknown>(
  db: any,
  policy: DocCachePolicy,
  collectionPath: string,
  opts: { bypass?: boolean; nowMs?: number } = {},
): Promise<Array<{ id: string; data: T }>> {
  const nowMs = opts.nowMs ?? Date.now();
  const members = opts.bypass ? { hit: false as const } : policy.getMembers(collectionPath, nowMs);

  if (members.hit) {
    // Positions are held, not appended. A Firestore collection read returns documents in
    // document-id order; if the re-read ones were pushed onto the end, a team would jump
    // position in `listRunTeams` for no reason other than having just been written — the
    // rows would reorder themselves exactly when the run is busiest.
    const slots: Array<{ id: string; data: T } | null> = [];
    const missing: Array<{ id: string; slot: number }> = [];
    for (const id of members.ids) {
      const hit = policy.getDoc<T>(`${collectionPath}/${id}`, nowMs);
      if (hit.hit && hit.entry.exists && hit.entry.data !== undefined) {
        slots.push({ id, data: hit.entry.data });
      } else {
        missing.push({ id, slot: slots.length });
        slots.push(null);
      }
    }
    if (missing.length === 0) return slots.filter((r): r is { id: string; data: T } => r !== null);

    // Only the touched documents cost a read — the point of tracking membership separately.
    const snaps = await db.getAll(...missing.map((m) => db.doc(`${collectionPath}/${m.id}`)));
    // Matched by id, not by position. Firestore does return `getAll` results in the order
    // requested, but a silent reliance on that would put one team's document in another
    // team's row if it ever changed — a wrong name against a wrong score, which is exactly
    // the kind of failure nobody would read as a cache bug.
    const slotById = new Map(missing.map((m) => [m.id, m.slot]));
    for (const snap of snaps as any[]) {
      const entry = snap.exists ? { exists: true, data: snap.data() as T } : { exists: false };
      policy.putDoc(`${collectionPath}/${snap.id}`, entry, nowMs);
      const slot = slotById.get(snap.id);
      if (slot === undefined) continue;
      slots[slot] = snap.exists ? { id: snap.id, data: snap.data() as T } : null;
    }
    return slots.filter((r): r is { id: string; data: T } => r !== null);
  }

  const snap = await db.collection(collectionPath).get();
  const rows = snap.docs.map((d: any) => ({ id: d.id, data: d.data() as T }));
  for (const r of rows) {
    policy.putDoc(`${collectionPath}/${r.id}`, { exists: true, data: r.data }, nowMs);
  }
  policy.putMembers(collectionPath, rows.map((r: { id: string }) => r.id), nowMs);
  return rows;
}
