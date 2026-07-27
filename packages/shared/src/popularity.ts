// Popularity ranking for the public gallery + task library (change: gallery-popularity-ranking).
//
// ONE definition of "best first", shared by the server that stores the score on
// publicGames/publicTasks (Firestore can only order by a stored field) and by any
// client that displays or re-sorts the window it gets back. Two copies of this
// arithmetic would silently disagree, so there is exactly one.
//
// ── Why this shape ───────────────────────────────────────────────────────────
// 1. USES AND LIKES ARE NOT THE SAME CURRENCY. A like is one tap and costs
//    nothing; a "use" is a real event (a game actually launched in the physical
//    world, or a task imported into someone's builder). So they are weighted, not
//    summed raw: one use == POPULARITY_USE_WEIGHT likes.
// 2. ENGAGEMENT IS LOGARITHMIC. A raw sum makes the ranking a single-item story —
//    a 4,000-play incumbent sits 4,000 units above everything and every other
//    distinction is numerically invisible. log10 puts engagement on an
//    order-of-magnitude scale (one whole unit per 10x), which is both how people
//    reason about it and what makes a newness term commensurable.
// 3. NEW CONTENT MUST BE ABLE TO SURFACE — WITHOUT A CRON. A purely cumulative
//    score permanently entrenches whatever was published first. The two fixes are
//    (a) multiplicative decay on age, which makes every stored score go stale the
//    instant it is written and therefore REQUIRES a scheduled full-collection
//    rewrite, or (b) a monotonic bonus on the item's own CREATION time (the
//    Hacker News / Reddit "hot" shape). We take (b): the score references no
//    clock, only the item's immutable createdAt, so it is correct forever and is
//    only ever rewritten when a SIGNAL changes. Nothing decays; instead later
//    content is graded on a curve — an item published POPULARITY_TIE_DAYS after
//    another needs only a tenth of its engagement to tie.

/** Which public collection an item lives in. */
export type PublicLikeKind = 'game' | 'task';

/** A use (a launch or a copy) is worth this many likes. */
export const POPULARITY_USE_WEIGHT = 3;
/** A like is the unit of the engagement currency. */
export const POPULARITY_LIKE_WEIGHT = 1;

/**
 * Fixed platform epoch for the newness term. Deliberately a CONSTANT and not
 * "now": scores computed on different days must stay comparable forever.
 */
export const POPULARITY_EPOCH_MS = Date.UTC(2026, 0, 1);

/**
 * How many days of newness offset exactly one order of magnitude (10x) of
 * weighted engagement. Aggressive enough that a genuinely good new game reaches
 * the first screen within days; conservative enough that an empty newcomer does
 * not beat a well-loved item from last month.
 */
export const POPULARITY_TIE_DAYS = 80;

/** Score added per day of newness. Derived so POPULARITY_TIE_DAYS == +1.0. */
export const POPULARITY_DAY_BONUS = 1 / POPULARITY_TIE_DAYS;

/** Decimals kept in the stored score. Enough to order, short enough to be stable. */
export const POPULARITY_PRECISION = 6;

const DAY_MS = 86_400_000;

export interface PopularitySignals {
  /** Launches + copies (games) or copies (tasks). */
  uses?: number;
  /** Distinct users who liked the item. */
  likes?: number;
  /** Epoch ms the item was first published. */
  createdAtMs?: number;
}

/**
 * A count that reaches the ordering field must never be NaN — an unorderable
 * document is worse than a mis-ordered one. Anything not a positive finite
 * number collapses to its neutral value, 0.
 */
function clampCount(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

function round(n: number): number {
  const f = 10 ** POPULARITY_PRECISION;
  return Math.round(n * f) / f;
}

/**
 * The orderable popularity score. Pure and total: same inputs ⇒ same output,
 * forever, with no reference to the current time (see note 3 above).
 *
 *   log10(max(1, USE_W·uses + LIKE_W·likes))  +  DAY_BONUS · daysSinceEpoch(createdAt)
 *
 * `max(1, …)` (rather than `1 + …`) is what makes "10x engagement" worth
 * EXACTLY +1.0, which is the anchor the newness bonus is calibrated against.
 * Its only cost is that a single like is indistinguishable from zero at the log
 * level — which `comparePopularity`'s likes tiebreak resolves.
 */
export function popularityScore(signals: PopularitySignals): number {
  const uses = clampCount(signals.uses);
  const likes = clampCount(signals.likes);
  const weighted = POPULARITY_USE_WEIGHT * uses + POPULARITY_LIKE_WEIGHT * likes;
  const engagement = Math.log10(Math.max(1, weighted));

  const createdAtMs = signals.createdAtMs;
  const created = typeof createdAtMs === 'number' && Number.isFinite(createdAtMs)
    ? createdAtMs
    : POPULARITY_EPOCH_MS;
  // Clamped at the epoch so a corrupt pre-epoch timestamp scores as pure
  // engagement instead of going negative.
  const newnessDays = Math.max(0, created - POPULARITY_EPOCH_MS) / DAY_MS;

  return round(engagement + POPULARITY_DAY_BONUS * newnessDays);
}

/** The fields ranking needs from any gallery-shaped item. */
export interface RankFields {
  id: string;
  title?: string | null;
  /** Any other searchable text (description, tags, source game title …). */
  extras?: Array<string | undefined | null>;
  popularity?: number;
  uses?: number;
  likes?: number;
  /** See PublicGame.pinnedLast (change: gallery-pin-last). */
  pinnedLast?: boolean;
}

/**
 * Deterministic TOTAL order: pinnedLast last → score desc → uses desc →
 * likes desc → id asc.
 *
 * Firestore's `orderBy('popularity','desc')` is only a partial order, so equal
 * scores could shuffle between calls and break paging. The id tiebreak
 * guarantees two callers ranking the same set always produce the same sequence.
 * A missing score counts as 0, so a legacy document ranks last rather than NaN.
 *
 * `pinnedLast` is checked FIRST and outranks every other signal: a pinned item
 * sorts after every non-pinned item no matter how much popularity/uses/likes it
 * has, and two pinned items still fall through to the normal order between
 * themselves (so pinning is a floor, not a black hole).
 */
export function comparePopularity(a: RankFields, b: RankFields): number {
  const byPinned = (a.pinnedLast ? 1 : 0) - (b.pinnedLast ? 1 : 0);
  if (byPinned !== 0) return byPinned;
  const byScore = clampCount(b.popularity) - clampCount(a.popularity);
  if (byScore !== 0) return byScore;
  const byUses = clampCount(b.uses) - clampCount(a.uses);
  if (byUses !== 0) return byUses;
  const byLikes = clampCount(b.likes) - clampCount(a.likes);
  if (byLikes !== 0) return byLikes;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * How well an item matches a search query.
 *   3 title starts with the query · 2 title contains it · 1 some other field
 *   contains it · 0 no match (dropped).
 * An empty query is an equal match for everything, so ranking degenerates to
 * pure popularity order through the same code path.
 */
export function relevanceTier(fields: RankFields, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 3;
  const title = (fields.title ?? '').toLowerCase();
  if (title.startsWith(q)) return 3;
  if (title.includes(q)) return 2;
  const hit = (fields.extras ?? []).some((s) => typeof s === 'string' && s.toLowerCase().includes(q));
  return hit ? 1 : 0;
}

/**
 * Rank a fetched window: RELEVANCE FIRST, popularity only as the tiebreak inside
 * a relevance tier. Making popularity primary during a search would be a straight
 * downgrade — a creator typing "kotel" would get the most popular game that merely
 * mentions it above the game actually called "Kotel Hunt". Non-matches are dropped
 * (only when a query is present). Never mutates the input.
 */
export function rankGalleryResults<T>(
  items: T[],
  query: string,
  adapt: (item: T) => RankFields,
): T[] {
  const scored = items
    .map((item) => { const fields = adapt(item); return { item, fields, tier: relevanceTier(fields, query) }; })
    .filter((row) => row.tier > 0);
  scored.sort((a, b) => (b.tier - a.tier) || comparePopularity(a.fields, b.fields));
  return scored.map((row) => row.item);
}
