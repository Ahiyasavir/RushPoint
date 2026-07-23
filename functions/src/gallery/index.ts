// ─── Gallery callables ────────────────────────────────────────────────────────
// Public game gallery + task library search, ranked most-popular-first, plus the
// one mutation that lets a creator express what is good (change:
// gallery-popularity-ranking).

import * as functions from 'firebase-functions';
import { loggedCallable } from '../obs/log';
import { enforceRateLimit } from '../rateLimitStore';
import { db } from '../firebase';
import {
  FIRESTORE_PATHS,
  rankGalleryResults,
  publicTaskLocation,
  type PublicGame,
  type PublicTask,
  type PublicLike,
  type PublicLikeKind,
} from '@rushpoint/shared';
import { bumpPublicSignals, publicItemPath, scoreFor } from './popularityStore';

/**
 * Case-insensitive substring match of `query` against a set of text fields.
 * Undefined-safe: a missing/non-string field is simply skipped (denormalized
 * gallery docs are server-written but must never crash search if one is sparse).
 * An empty/whitespace query matches everything.
 */
export function publicTextMatch(haystacks: Array<string | undefined | null>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((h) => typeof h === 'string' && h.toLowerCase().includes(q));
}

// ─── Shared read helpers ──────────────────────────────────────────────────────

/**
 * Fetch a popularity-ordered window of a public collection.
 *
 * `orderBy('popularity')` EXCLUDES documents that lack the field, and the field
 * is new — so a game published before this change would silently disappear from
 * the gallery. That is unacceptable, hence the union with a bounded unordered
 * fallback fetch, de-duplicated by id. Legacy docs sort as zero-engagement items
 * (comparePopularity treats a missing score as 0) and self-heal the first time
 * any signal touches them, after which the fallback fetch finds nothing new.
 */
async function fetchRankedWindow<T extends { id: string }>(
  collection: string,
  tags: string[],
  fetchSize: number,
): Promise<T[]> {
  const withTags = <Q extends FirebaseFirestore.Query>(q: Q): Q =>
    (tags.length > 0 ? q.where('tags', 'array-contains-any', tags.slice(0, 10)) : q) as Q;

  const ordered = await withTags(
    db.collection(collection).orderBy('popularity', 'desc'),
  ).limit(fetchSize).get();

  const byId = new Map<string, T>();
  for (const d of ordered.docs) byId.set(d.id, d.data() as T);

  if (ordered.size < fetchSize) {
    const legacy = await withTags(db.collection(collection)).limit(fetchSize).get();
    for (const d of legacy.docs) if (!byId.has(d.id)) byId.set(d.id, d.data() as T);
  }
  return [...byId.values()];
}

/**
 * Which of `itemIds` the caller has already liked. Point reads by DETERMINISTIC
 * id (FIRESTORE_PATHS.publicLike) rather than a `where uid ==` query — no index,
 * no fan-out, and the same id shape that makes one-like-per-user structural.
 */
async function likedIdsFor(kind: PublicLikeKind, uid: string, itemIds: string[]): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const refs = itemIds.map((id) => db.doc(FIRESTORE_PATHS.publicLike(kind, id, uid)));
  const snaps = await db.getAll(...refs);
  return itemIds.filter((_, i) => snaps[i].exists);
}

/**
 * READ-PATH location resolution for one stored `publicTasks` document
 * (change: gallery-map-serve-exact). Returns the sanitized library task the
 * callable serves: the deprecated raw `coordinates` key is dropped and
 * `approxLocation` carries the point the client plots.
 *
 * Reconciles THREE generations of stored doc so every already-published mission
 * plots at its true spot with NO re-publish and NO backfill:
 *  • legacy docs (pre `task-library-map-view`) carry the EXACT `coordinates` and
 *    NO `approxLocation` — they used to not plot at all; we recompute their public
 *    point from `coordinates` via the shared rule, so they now plot exactly;
 *  • `task-library-map-view` docs carry a coarse `approxLocation` and no
 *    `coordinates` — `publicTaskLocation` returns undefined (no coordinates) and
 *    we keep the stored coarse point;
 *  • `gallery-precise-task-location` docs carry an EXACT `approxLocation` and no
 *    `coordinates` — likewise kept verbatim.
 *
 * hideLocation carve-out + its residual risk (VERIFIED from git history, so it is
 * documented rather than guessed): `publicTaskLocation` coarsens a `hideLocation`
 * task to its ~1 km cell. But NO generation of `publishGame` ever WROTE
 * `hideLocation`/`locationless` onto the `publicTasks` doc (the earliest
 * projection wrote a bare `coordinates: task.coordinates`; every later one writes
 * only `approxLocation`). So at read time that flag is always absent and a legacy
 * `coordinates`-bearing doc is served EXACT. This is safe: the exact `coordinates`
 * was ALREADY world-readable in that same doc (`allow read: if true`) before
 * `hideLocation` even existed as a Task field, and the ONLY way to produce a
 * hidden doc is a re-publish — which rewrites the doc through `publicTaskLocation`
 * (coarsening it) and erases `coordinates`. A doc that still carries `coordinates`
 * therefore predates any hidden-task exposure this callable could add; the
 * residual exposure is pre-existing raw-doc data, not introduced here.
 */
export function publicTaskForLibrary(
  raw: PublicTask & { hideLocation?: boolean; locationless?: boolean },
): PublicTask {
  const { coordinates, hideLocation, locationless, ...safe } = raw;
  const loc = publicTaskLocation({ hideLocation, locationless, coordinates });
  // undefined ⇒ locationless / unplaced / no coordinates: fall back to whatever
  // `approxLocation` the doc already stores so a new-style doc still plots.
  return loc ? { ...safe, approxLocation: loc } : safe;
}

// ─── searchGallery ───────────────────────────────────────────────────────────

// The gallery is PUBLIC content, but the callable is not a public firehose: it
// fans out to a ≤50-doc Firestore read per call and was previously reachable by
// anyone on the internet with no auth and no budget. Requiring an auth context
// (anonymous sign-in is enough — participants already have one) gives us a uid
// to meter, which is the only thing that makes a rate limit possible at all.
export const searchGallery = loggedCallable('searchGallery', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  await enforceRateLimit(context.auth.uid, 'searchGallery');

  const { query = '', tags = [], limit = 20 } = data as {
    query?: string;
    tags?: string[];
    limit?: number;
  };

  const HARD_CAP = 50;
  const wanted = Math.min(limit, HARD_CAP);
  // With a text query the in-memory filter runs AFTER the fetch, so a small
  // `limit` used to shrink the pool the filter got to search. Widen to the cap
  // and trim after ranking instead.
  const fetchSize = query.trim() ? HARD_CAP : wanted;

  const window = await fetchRankedWindow<PublicGame>('publicGames', tags, fetchSize);

  // Relevance first, popularity as the tiebreak inside a relevance tier — a more
  // popular weaker match must never outrank a stronger one. With an empty query
  // every item is an equal match and this degenerates to pure popularity order.
  const games = rankGalleryResults(window, query, (g) => ({
    id: g.id,
    title: g.title,
    extras: [g.description, ...(g.tags ?? [])],
    popularity: g.popularity,
    uses: g.playCount,
    likes: g.likeCount,
  })).slice(0, wanted);

  const likedIds = await likedIdsFor('game', context.auth.uid, games.map((g) => g.id));
  return { games, likedIds };
});


// ─── searchTaskLibrary ────────────────────────────────────────────────────────

// Same reasoning as searchGallery — and a wider blast radius (≤100 docs/call).
export const searchTaskLibrary = loggedCallable('searchTaskLibrary', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  await enforceRateLimit(context.auth.uid, 'searchTaskLibrary');

  const { query = '', tags = [], limit = 30 } = data as {
    query?: string;
    tags?: string[];
    limit?: number;
  };

  const HARD_CAP = 100;
  const wanted = Math.min(limit, HARD_CAP);
  const fetchSize = query.trim() ? HARD_CAP : wanted;

  const window = await fetchRankedWindow<PublicTask>('publicTasks', tags, fetchSize);

  const ranked = rankGalleryResults(window, query, (t) => ({
    id: t.id,
    title: t.title,
    extras: [t.description, t.sourceGameTitle, ...(t.tags ?? [])],
    popularity: t.popularity,
    uses: t.copyCount,
    likes: t.likeCount,
  })).slice(0, wanted);

  // Location contract (change: gallery-precise-task-location + gallery-map-serve-exact):
  // the gallery map shows WHERE a creator placed a task — a point of interest, not a
  // person — so an ordinary task is served its EXACT point, recomputed HERE from the
  // stored `coordinates` on every read via the same shared rule the publish path uses.
  // That reaches already-published missions through the read path (NO re-publish, NO
  // backfill). `publicTaskForLibrary` is the pure, unit-tested reconciliation; see its
  // doc for the three-generation handling and the hideLocation carve-out.
  const tasks = ranked.map((raw) => publicTaskForLibrary(raw));

  const likedIds = await likedIdsFor('task', context.auth.uid, tasks.map((t) => t.id));
  return { tasks, likedIds };
});


// ─── copyTask ────────────────────────────────────────────────────────────────
// Increment copyCount on a public task when a creator drags it into their game.

export const incrementTaskCopyCount = loggedCallable('incrementTaskCopyCount', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { publicTaskId } = data as { publicTaskId: string };
  if (!publicTaskId) throw new functions.https.HttpsError('invalid-argument', 'publicTaskId required');

  // Routed through the single transactional signal writer so the copy count and
  // the derived popularity score can never disagree. (Historical note: a bare
  // `require('firebase-admin')` here once threw INTERNAL at runtime — the
  // function bundle is esbuild-built, so a CommonJS require of admin isn't
  // resolvable. Everything goes through the ESM imports above.)
  const res = await bumpPublicSignals('task', publicTaskId, { uses: 1 });
  return { ok: true, applied: res.applied };
});


// ─── setPublicLike ────────────────────────────────────────────────────────────
// A creator says "this is good" about a public game or public task.
//
// This is a DESIRED-END-STATE setter, not a toggle, and that is the whole point.
// A toggle is inherently non-idempotent: a retried request flips twice, and two
// tabs racing produce an unpredictable count. "Make it liked" applied twice is
// just "liked". The delta is computed from OBSERVED state inside the transaction,
// never from the request, so a double-fire is a provable no-op.
//
// One like per user per item is enforced by the ADDRESS of the like document
// (publicLikes/{kind}_{itemId}_{uid}) — a second like from the same user resolves
// to the same path, so a duplicate record is physically impossible regardless of
// what the client sends.

export const setPublicLike = loggedCallable('setPublicLike', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  // Reuses the platform's callable rate limiter (change: callable-rate-limiting)
  // rather than inventing one. A like is a write that moves a public ranking.
  await enforceRateLimit(uid, 'setPublicLike');

  const { kind, itemId, liked } = data as { kind?: PublicLikeKind; itemId?: string; liked?: boolean };
  if (kind !== 'game' && kind !== 'task') {
    throw new functions.https.HttpsError('invalid-argument', 'kind must be "game" or "task"');
  }
  if (!itemId || typeof itemId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'itemId required');
  }
  if (typeof liked !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'liked must be a boolean');
  }

  const likeRef = db.doc(FIRESTORE_PATHS.publicLike(kind, itemId, uid));
  const itemRef = db.doc(publicItemPath(kind, itemId));
  const now = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    // Both reads before any write — Firestore transactions require it.
    const [likeSnap, itemSnap] = await Promise.all([tx.get(likeRef), tx.get(itemRef)]);
    if (!itemSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'That item is not in the public gallery');
    }
    const item = itemSnap.data() ?? {};

    const delta = liked && !likeSnap.exists ? 1 : !liked && likeSnap.exists ? -1 : 0;
    if (delta === 1) {
      const like: PublicLike = { id: likeRef.id, kind, itemId, uid, createdAt: now };
      tx.set(likeRef, like);
    } else if (delta === -1) {
      tx.delete(likeRef);
    }

    // max(0,…) so the public count can never go negative even if a like record
    // were removed out of band.
    const likeCount = Math.max(0, (Number(item.likeCount) || 0) + delta);
    const popularity = scoreFor(kind, { ...item, likeCount } as never);
    tx.update(itemRef, { likeCount, popularity });

    // Authoritative state, so the UI's optimistic guess is reconciled, not trusted.
    return { liked, likeCount, popularity };
  });
});
