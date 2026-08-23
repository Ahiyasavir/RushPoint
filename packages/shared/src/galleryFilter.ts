// Gallery FACET filters (change: gallery-facet-filters).
//
// The gallery callables (`searchGallery`, `searchTaskLibrary`) DB-filter by `tags`
// only — Firestore permits one array-contains per query, so adding equality facets
// (mode / type / difficulty / hasLocation) at the DB layer would demand a composite
// index per combination. Instead those facets are applied IN MEMORY, on the
// popularity-ranked window the callable already fetched, BEFORE it slices to the
// requested page. This is that pure, total pass.
//
// Semantics (intentional, and pinned by galleryFilter.test.ts):
//  • POSITIVE filter (mode / type / difficulty / hasLocation:true) EXCLUDES an item
//    whose faceted field is missing or malformed — a filter narrows, never widens.
//  • `difficulty` is AT-LEAST: `difficulty: N` keeps tasks with `difficulty >= N`.
//  • `hasLocation` tests for a USABLE approxLocation — finite lat/lng within range and
//    not the (0,0) null-island (`isValidCoord` + a 0,0 guard). `false` keeps the rest.
//  • EMPTY facets = IDENTITY: same items, input order preserved, NO re-sort. Sorting
//    happens only when `sort` is set, and every sort is a STABLE descending sort.
//  • TOTAL: never throws. A null/non-object item, a missing field, an unknown sort —
//    all are tolerated (a positive filter drops the bad item; sort leaves it in place).

import { isValidCoord } from './geo';
import type { GameMode, TaskType, GeoPoint } from './types';

export type GalleryGameSort = 'popular' | 'newest' | 'plays';
export type GalleryTaskSort = 'popular' | 'newest' | 'copies';

export interface GalleryGameFacets {
  mode?: GameMode;
  sort?: GalleryGameSort;
}

export interface GalleryTaskFacets {
  type?: TaskType;
  /** AT-LEAST: keeps tasks whose difficulty is >= this value. */
  difficulty?: number;
  /** true ⇒ only tasks with a usable approxLocation; false ⇒ only those without. */
  hasLocation?: boolean;
  sort?: GalleryTaskSort;
}

/**
 * Union view carrying both vocabularies. NOT an intersection: `GameFacets & TaskFacets`
 * would collapse `sort` to the INTERSECTION of the two sort unions ('popular'|'newest'),
 * silently dropping 'plays'/'copies'. `applyGalleryFacets` reads only the keys for `kind`.
 */
export interface GalleryFacets {
  mode?: GameMode;
  type?: TaskType;
  difficulty?: number;
  hasLocation?: boolean;
  sort?: GalleryGameSort | GalleryTaskSort;
}

/** A safe record view of an unknown item — never throws on null/non-objects. */
function rec(item: unknown): Record<string, unknown> {
  return item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
}

/** A usable public location: finite, in-range, and not the (0,0) null-island. */
function hasUsableLocation(loc: unknown): boolean {
  if (!loc || typeof loc !== 'object') return false;
  const p = loc as Partial<GeoPoint>;
  if (!isValidCoord(p.lat, p.lng)) return false;
  return !(p.lat === 0 && p.lng === 0);
}

/** Descending numeric compare that treats a non-finite value as -Infinity (sorts last). */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

/**
 * STABLE sort by `key(item)` descending. Array.prototype.sort is not guaranteed
 * stable across every engine for large inputs, so we decorate with the original
 * index and break ties by it — equal keys keep input order.
 */
function stableSortDesc<T>(items: T[], key: (item: T) => number): T[] {
  return items
    .map((item, i) => ({ item, i, k: key(item) }))
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((d) => d.item);
}

/** ISO date string → epoch ms, or -Infinity when absent/unparseable. */
function timeKey(r: Record<string, unknown>): number {
  const raw = r.createdAt ?? r.updatedAt;
  if (typeof raw !== 'string') return Number.NEGATIVE_INFINITY;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

function filterGames<T>(items: T[], facets: GalleryFacets): T[] {
  let out = items;
  if (facets.mode !== undefined) {
    out = out.filter((item) => rec(item).mode === facets.mode);
  }
  switch (facets.sort) {
    case 'popular':
      out = stableSortDesc(out, (item) => num(rec(item).popularity));
      break;
    case 'plays':
      out = stableSortDesc(out, (item) => num(rec(item).playCount));
      break;
    case 'newest':
      out = stableSortDesc(out, (item) => timeKey(rec(item)));
      break;
    default:
      break; // no sort ⇒ preserve input order
  }
  return out;
}

function filterTasks<T>(items: T[], facets: GalleryFacets): T[] {
  let out = items;
  if (facets.type !== undefined) {
    out = out.filter((item) => rec(item).type === facets.type);
  }
  if (facets.difficulty !== undefined && Number.isFinite(Number(facets.difficulty))) {
    const min = Number(facets.difficulty);
    out = out.filter((item) => {
      const d = Number(rec(item).difficulty);
      return Number.isFinite(d) && d >= min;
    });
  }
  if (facets.hasLocation !== undefined) {
    out = out.filter((item) => hasUsableLocation(rec(item).approxLocation) === facets.hasLocation);
  }
  switch (facets.sort) {
    case 'popular':
      out = stableSortDesc(out, (item) => num(rec(item).popularity));
      break;
    case 'copies':
      out = stableSortDesc(out, (item) => num(rec(item).copyCount));
      break;
    case 'newest':
      out = stableSortDesc(out, (item) => timeKey(rec(item)));
      break;
    default:
      break;
  }
  return out;
}

/**
 * Apply the in-memory facet filters + optional re-sort to a ranked gallery window.
 * Pure, total, never throws. `kind` selects the facet vocabulary; a facets object
 * may carry both game and task keys (only the ones for `kind` are read).
 */
export function applyGalleryFacets<T>(
  items: T[],
  facets: GalleryFacets | undefined | null,
  kind: 'game' | 'task',
): T[] {
  const list = Array.isArray(items) ? items : [];
  const f = facets && typeof facets === 'object' ? facets : {};
  return kind === 'game' ? filterGames(list, f) : filterTasks(list, f);
}
