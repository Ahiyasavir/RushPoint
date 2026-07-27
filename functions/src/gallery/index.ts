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
  isCoarsePublicPoint,
  applyGalleryFacets,
  type Game,
  type Task,
  type GeoPoint,
  type GameMode,
  type TaskType,
  type GalleryGameSort,
  type GalleryTaskSort,
  type PublicGame,
  type PublicTask,
  type PublicLike,
  type PublicLikeKind,
} from '@rushpoint/shared';
import { RECOMMENDED_TAGS, normalizeTags } from '@rushpoint/shared';
import { bumpPublicSignals, publicItemPath, scoreFor } from './popularityStore';
import {
  readStoredTagCounts,
  tallyTags,
  sortTagCounts,
  type TagCounts,
} from './tagStats';

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
    (Array.isArray(tags) && tags.length > 0 ? q.where('tags', 'array-contains-any', tags.slice(0, 10)) : q) as Q;

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
 * hideLocation is served EXACT now (change: gallery-exact-hidden-location).
 * `publicTaskLocation` returns the exact authored point for EVERY located task,
 * hidden included, so the gallery map pins each mission precisely and a game's
 * nearby hidden missions no longer collapse onto one coarse ~1 km cell. The
 * in-game puzzle is not weakened here: the PLAYER is sealed off from a hidden
 * task's spot by the participant sanitizer (`sanitizeTaskForParticipant`), a
 * separate control this callable never feeds. The accepted trade-off is that a
 * hidden mission's exact spot is world-visible in the gallery (this doc is
 * `allow read: if true`) — the platform owner's choice, for an accurate map.
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

/**
 * READ-PATH repair for the ONE generation `publicTaskForLibrary` cannot fix on
 * its own (change: gallery-map-legacy-coarse-repair). A `task-library-map-view`
 * era doc stores a COARSE `approxLocation` and NO `coordinates` at all — there is
 * nothing on the doc itself to recompute an exact point from, so
 * `publicTaskLocation({coordinates: undefined, ...})` returns `undefined` and the
 * caller keeps the stale ~1 km cell forever. The only remaining source of truth
 * is the private game template the task was published from.
 *
 * A doc needs this lookup exactly when: it carries NO `coordinates` (a doc that
 * has one is already handled, exactly, by `publicTaskForLibrary`'s own recompute)
 * AND its stored `approxLocation` is COARSE (`isCoarsePublicPoint` — the same
 * structural test the reader uses everywhere else, so a doc that already stores
 * an exact point, e.g. from `gallery-precise-task-location`, is correctly left
 * alone).
 */
export function needsLegacyCoarseRepair(t: PublicTask): boolean {
  if (t.coordinates !== undefined && t.coordinates !== null) return false;
  return isCoarsePublicPoint(t.approxLocation);
}

/** Distinct (ownerUid, sourceGameId) pairs this batch of tasks needs a game read for. */
export function legacyCoarseRepairKeys(
  tasks: ReadonlyArray<PublicTask>,
): Array<{ ownerUid: string; sourceGameId: string }> {
  const byKey = new Map<string, { ownerUid: string; sourceGameId: string }>();
  for (const t of tasks) {
    if (!needsLegacyCoarseRepair(t)) continue;
    if (!t.ownerUid || !t.sourceGameId) continue;
    byKey.set(`${t.ownerUid}/${t.sourceGameId}`, { ownerUid: t.ownerUid, sourceGameId: t.sourceGameId });
  }
  return [...byKey.values()];
}

/** The authored task with id `taskId` inside `game`, or undefined (game/task gone). */
function findAuthoredTask(game: Game | undefined, taskId: string): Task | undefined {
  for (const stage of game?.stages ?? []) {
    for (const task of stage.tasks ?? []) if (task.id === taskId) return task;
  }
  return undefined;
}

/**
 * Batched (ownerUid, sourceGameId) -> template `Game` reader, injected so the
 * pure resolution logic below is unit-testable without a Firestore emulator.
 */
export type LegacyGameFetcher = (
  keys: ReadonlyArray<{ ownerUid: string; sourceGameId: string }>,
) => Promise<Map<string, Game | undefined>>;

/**
 * Resolve the EXACT point for every doc that `needsLegacyCoarseRepair`, by
 * looking up its source game template. Returns a map of publicTask doc id ->
 * the recomputed `approxLocation` for docs that were successfully resolved;
 * a doc that is not in the returned map keeps whatever `publicTaskForLibrary`
 * already gave it (the stored coarse area) — this function never throws and
 * never removes a location, only upgrades one.
 *
 * FAIL-OPEN by construction: `getGames` failing outright, a deleted/inaccessible
 * game, or a task no longer present in it all fall through to "not resolved" —
 * never an error, never a dropped mission.
 *
 * BOUNDED COST: exactly one batched read per distinct source game across the
 * WHOLE input (via `legacyCoarseRepairKeys` + `db.getAll`-style batching in
 * `getGames`), and only for docs that actually need it — a page of
 * already-precise docs makes zero extra reads.
 *
 * CONSISTENCY: `publicTaskLocation` is reused verbatim, so a `hideLocation` task
 * resolves to its EXACT point here exactly as the write path now writes it
 * (change: gallery-exact-hidden-location) — this lookup can only ever upgrade a
 * doc to what a fresh publish would produce, never something different. It is
 * also what heals a legacy COARSE hidden pin to its precise spot ON READ, so the
 * creator's map is correct even before any re-publish or backfill.
 */
export async function resolveLegacyCoarseLocations(
  tasks: ReadonlyArray<PublicTask>,
  getGames: LegacyGameFetcher,
): Promise<Map<string, GeoPoint>> {
  const out = new Map<string, GeoPoint>();
  const targets = tasks.filter(needsLegacyCoarseRepair);
  if (targets.length === 0) return out;

  const keys = legacyCoarseRepairKeys(targets);
  if (keys.length === 0) return out;

  let games: Map<string, Game | undefined>;
  try {
    games = await getGames(keys);
  } catch {
    // Fail open: leave every target doc at its stored coarse area.
    return out;
  }

  for (const t of targets) {
    if (!t.ownerUid || !t.sourceGameId) continue;
    const game = games.get(`${t.ownerUid}/${t.sourceGameId}`);
    const taskId = t.id.startsWith(`${t.sourceGameId}_`)
      ? t.id.slice(t.sourceGameId.length + 1)
      : t.id;
    const source = findAuthoredTask(game, taskId);
    if (!source) continue; // game/task gone — fail open, keep stored coarse point.
    const loc = publicTaskLocation(source);
    if (loc) out.set(t.id, loc);
  }
  return out;
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

  // The web client sends optional facets as `undefined`, which the Firebase callable
  // SDK serializes to `null` on the wire — so a destructuring default (`tags = []`)
  // does NOT apply (defaults fire only for `undefined`). Coerce every optional here so a
  // null/omitted facet means "no filter", never a crash. (This is why fetchRankedWindow's
  // `tags.length` threw a 500 on the real gallery while the e2e — which omits the keys
  // entirely — passed.)
  const d = (data ?? {}) as {
    query?: string | null; tags?: string[] | null; limit?: number | null;
    mode?: GameMode | null; sort?: GalleryGameSort | null;
  };
  const query = typeof d.query === 'string' ? d.query : '';
  const tags = Array.isArray(d.tags) ? d.tags : [];
  const limit = typeof d.limit === 'number' ? d.limit : 20;
  const mode = d.mode ?? undefined;
  const sort = d.sort ?? undefined;

  const HARD_CAP = 50;
  const wanted = Math.min(limit, HARD_CAP);
  // With a text query OR a facet the in-memory pass runs AFTER the fetch, so a
  // small `limit` used to shrink the pool it got to work on. Widen to the cap and
  // trim after ranking+faceting instead.
  const fetchSize = query.trim() || mode || sort ? HARD_CAP : wanted;

  const window = await fetchRankedWindow<PublicGame>('publicGames', tags, fetchSize);

  // Relevance first, popularity as the tiebreak inside a relevance tier — a more
  // popular weaker match must never outrank a stronger one. With an empty query
  // every item is an equal match and this degenerates to pure popularity order.
  const ranked = rankGalleryResults(window, query, (g) => ({
    id: g.id,
    title: g.title,
    extras: [g.description, ...(g.tags ?? [])],
    popularity: g.popularity,
    uses: g.playCount,
    likes: g.likeCount,
    pinnedLast: g.pinnedLast,
  }));

  // FACET pass (change: gallery-facet-filters): mode narrows, sort re-orders — in
  // memory, after ranking, before the page slice. `tags` stays the sole DB filter.
  const games = applyGalleryFacets(ranked, { mode, sort }, 'game').slice(0, wanted);

  const likedIds = await likedIdsFor('game', context.auth.uid, games.map((g) => g.id));
  return { games, likedIds };
});


// ─── searchTaskLibrary ────────────────────────────────────────────────────────

// Same reasoning as searchGallery — and a wider blast radius (≤100 docs/call).
export const searchTaskLibrary = loggedCallable('searchTaskLibrary', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  await enforceRateLimit(context.auth.uid, 'searchTaskLibrary');

  // Same wire-null coercion as searchGallery: the client's `undefined` facets arrive as
  // `null`, so destructuring defaults don't apply. A null/omitted facet = "no filter".
  const d = (data ?? {}) as {
    query?: string | null; tags?: string[] | null; limit?: number | null;
    type?: TaskType | null; difficulty?: number | null; hasLocation?: boolean | null;
    sort?: GalleryTaskSort | null;
  };
  const query = typeof d.query === 'string' ? d.query : '';
  const tags = Array.isArray(d.tags) ? d.tags : [];
  const limit = typeof d.limit === 'number' ? d.limit : 30;
  const type = d.type ?? undefined;
  const difficulty = d.difficulty ?? undefined;
  const hasLocation = d.hasLocation ?? undefined;
  const sort = d.sort ?? undefined;

  const HARD_CAP = 100;
  const wanted = Math.min(limit, HARD_CAP);
  const hasFacet = type !== undefined || difficulty !== undefined || hasLocation !== undefined || !!sort;
  const fetchSize = query.trim() || hasFacet ? HARD_CAP : wanted;

  const window = await fetchRankedWindow<PublicTask>('publicTasks', tags, fetchSize);

  const rankedAll = rankGalleryResults(window, query, (t) => ({
    id: t.id,
    title: t.title,
    extras: [t.description, t.sourceGameTitle, ...(t.tags ?? [])],
    popularity: t.popularity,
    uses: t.copyCount,
    likes: t.likeCount,
    pinnedLast: t.pinnedLast,
  }));

  // FACET pass (change: gallery-facet-filters): type/difficulty(≥)/hasLocation
  // narrow, sort re-orders — in memory, after ranking, before the page slice.
  // `tags` stays the sole DB filter. hasLocation reads the stored `approxLocation`
  // (a mission published as located carries one); the exact-point reconciliation
  // below only refines WHERE a located task plots, never whether it has a spot.
  const ranked = applyGalleryFacets(rankedAll, { type, difficulty, hasLocation, sort }, 'task').slice(
    0,
    wanted,
  );

  // Location contract (change: gallery-precise-task-location + gallery-map-serve-exact):
  // the gallery map shows WHERE a creator placed a task — a point of interest, not a
  // person — so an ordinary task is served its EXACT point, recomputed HERE from the
  // stored `coordinates` on every read via the same shared rule the publish path uses.
  // That reaches already-published missions through the read path (NO re-publish, NO
  // backfill). `publicTaskForLibrary` is the pure, unit-tested reconciliation; see its
  // doc for the three-generation handling and the hideLocation carve-out.
  const tasks = ranked.map((raw) => publicTaskForLibrary(raw));

  // Legacy-coarse repair (change: gallery-map-legacy-coarse-repair): a
  // `task-library-map-view` era doc has no `coordinates` to recompute from, so
  // `publicTaskForLibrary` above left it at its stale coarse `approxLocation`.
  // Batched, read-only, fail-open — see `resolveLegacyCoarseLocations`.
  const legacyFixes = await resolveLegacyCoarseLocations(ranked, async (keys) => {
    const refs = keys.map((k) => db.doc(FIRESTORE_PATHS.game(k.ownerUid, k.sourceGameId)));
    const snaps = await db.getAll(...refs);
    const byKey = new Map<string, Game | undefined>();
    keys.forEach((k, i) => {
      const snap = snaps[i];
      byKey.set(`${k.ownerUid}/${k.sourceGameId}`, snap.exists ? (snap.data() as Game) : undefined);
    });
    return byKey;
  });
  for (const t of tasks) {
    const fixed = legacyFixes.get(t.id);
    if (fixed) t.approxLocation = fixed;
  }

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


// ─── getPopularTags ────────────────────────────────────────────────────────────
// A cheap, data-driven list of quick-add tag chips for the Builder
// (change: gallery-popular-tags).
//
// Auth is required (anonymous is fine — same posture as searchGallery) so the read
// is metered by uid. It reuses the `searchGallery` rate-limit budget rather than
// inventing a new bucket: it is the same class of gallery read, and RATE_LIMITS
// (packages/shared) is owned elsewhere so a dedicated bucket cannot be added from
// here without leaving `enforceRateLimit` fail-open (which rateLimitCoverage would
// then flag). See DENORM-WIRING note below on where `bumpTagStats` must be called.
//
// Resolution order, most-authoritative first:
//   1. the denormalized `publicTagStats/global` counts (one point read — cheap);
//   2. if that doc is empty (e.g. before any publish has bumped it), a BOUNDED
//      live aggregation of the public gallery's own tags, so the feature is useful
//      immediately and self-heals;
//   3. the RECOMMENDED_TAGS seed layered UNDERNEATH, filling the tail so an empty
//      platform still returns sensible chips. Real usage always outranks the seed.

/** Bounded live tally of the tags actually present in the public gallery. */
async function liveGalleryTagCounts(): Promise<TagCounts> {
  const CAP = 300; // bounded, index-free read — tag counting doesn't need ordering
  const [games, tasks] = await Promise.all([
    db.collection('publicGames').limit(CAP).get().catch(() => null),
    db.collection('publicTasks').limit(CAP).get().catch(() => null),
  ]);
  const lists: Array<string[] | undefined> = [];
  for (const d of games?.docs ?? []) lists.push(d.data()?.tags as string[] | undefined);
  for (const d of tasks?.docs ?? []) lists.push(d.data()?.tags as string[] | undefined);
  return tallyTags(lists);
}

export const getPopularTags = loggedCallable('getPopularTags', async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  await enforceRateLimit(context.auth.uid, 'searchGallery');

  const { limit = 20 } = data as { limit?: number };
  const wanted = Math.min(Math.max(1, Math.floor(Number(limit)) || 20), 50);

  let counts = await readStoredTagCounts();
  if (Object.keys(counts).length === 0) {
    // Denormalized doc not populated yet — derive from the gallery itself.
    counts = await liveGalleryTagCounts();
  }

  const top = sortTagCounts(counts).slice(0, wanted).map((e) => e.tag);

  // Layer the seed underneath the real, data-driven tags without duplicating one.
  const seen = new Set(top.map((t) => t.toLowerCase()));
  const tags = [...top];
  for (const seed of normalizeTags(RECOMMENDED_TAGS)) {
    if (tags.length >= wanted) break;
    if (seen.has(seed.toLowerCase())) continue;
    seen.add(seed.toLowerCase());
    tags.push(seed);
  }

  return { tags };
});
