// ─── Popular-tag denormalization (change: gallery-popular-tags) ────────────────
//
// A cheap, data-driven source of "what tags are creators actually using", so the
// Builder can offer real quick-add chips instead of a hardcoded guess.
//
// Firestore cannot aggregate, so — exactly like `popularityStore` denormalizes a
// per-item `popularity` score — we denormalize a single tag→count map onto ONE
// document, `publicTagStats/global`, maintained transactionally as games publish
// and unpublish. `mergeTagCounts` is the pure arithmetic (unit-tested in
// tagStats.test.ts); `bumpTagStats` wraps it in a transaction and is BEST-EFFORT,
// mirroring `bumpPublicSignals`: a tag-stats failure must never break a publish.
//
// The read side (`readPopularTags`) is a single point read of that one doc — the
// "cheap" in the goal. `getPopularTags` (gallery/index.ts) layers a live fallback
// and the RECOMMENDED_TAGS seed on top so the feature is useful even before the
// denormalized doc is populated.

import * as functions from 'firebase-functions';
import { normalizeTags } from '@rushpoint/shared';
import { db } from '../firebase';

/** One stored tag: the lowercase key maps to this, keeping the first-seen casing. */
export interface TagCount {
  tag: string;
  n: number;
}
export type TagCounts = Record<string, TagCount>;

/** The single denormalized document every popular-tag read and write touches. */
export const TAG_STATS_DOC = 'publicTagStats/global';

/**
 * Normalize a stored/base count map: drop malformed, blank, or non-positive
 * entries, re-key by lowercase, and MERGE any two raw keys that fold to the same
 * tag (so a doc that ever stored both "Park" and "park" keys self-heals on the
 * next write). Total — never throws on junk input.
 */
function cleanBase(current: TagCounts | null | undefined): TagCounts {
  const out: TagCounts = {};
  for (const [rawKey, val] of Object.entries(current ?? {})) {
    const rawTag = val && typeof val.tag === 'string' && val.tag ? val.tag : rawKey;
    const [norm] = normalizeTags([rawTag]);
    if (!norm) continue; // blank / spoofing-only tag — discard
    const n = Number(val?.n) || 0;
    if (n <= 0) continue; // a zero/negative stored count is not a real tag
    const key = norm.toLowerCase();
    const prev = out[key];
    out[key] = { tag: prev?.tag ?? norm, n: (prev?.n ?? 0) + n };
  }
  return out;
}

/** Apply a signed delta for a list of tags (deduped/normalized within the call). */
function applyDelta(out: TagCounts, tags: string[] | null | undefined, sign: 1 | -1): void {
  for (const tag of normalizeTags(tags ?? [])) {
    const key = tag.toLowerCase();
    const prev = out[key];
    const n = (prev?.n ?? 0) + sign;
    if (n <= 0) {
      delete out[key]; // floor at 0 — an entry that hits zero disappears
    } else {
      out[key] = { tag: prev?.tag ?? tag, n };
    }
  }
}

/**
 * PURE merge/diff: take the current count map, add one publish's tags and remove
 * the ones it no longer carries, and return a NEW map. Adds increment, removes
 * decrement, counts floor at 0 (never negative), keys are lowercased + deduped,
 * and any entry that reaches 0 is dropped. Tolerates empty/undefined inputs.
 *
 * `added`/`removed` are each deduped by `normalizeTags` first, so a game that
 * carries a tag three ways ("Park"/"PARK"/"park") counts as exactly one use.
 */
export function mergeTagCounts(
  current: TagCounts,
  added: string[],
  removed: string[],
): TagCounts {
  const out = cleanBase(current);
  applyDelta(out, added, 1);
  applyDelta(out, removed, -1);
  return out;
}

/** Count occurrences across many tag lists (e.g. every public game/task). Pure. */
export function tallyTags(tagLists: Array<string[] | undefined | null>): TagCounts {
  let counts: TagCounts = {};
  for (const list of tagLists) counts = mergeTagCounts(counts, list ?? [], []);
  return counts;
}

/** Entries sorted by count desc, ties broken alphabetically (stable, locale-free). */
export function sortTagCounts(counts: TagCounts): TagCount[] {
  return Object.values(cleanBase(counts)).sort(
    (a, b) => b.n - a.n || a.tag.toLowerCase().localeCompare(b.tag.toLowerCase()),
  );
}

/**
 * Transactionally fold one publish's tag change into `publicTagStats/global`.
 * BEST-EFFORT: any failure is logged and swallowed so a publish (or unpublish, or
 * gallery removal) never fails because the popularity index could not be updated —
 * the same contract as `bumpPublicSignals`. Call with the tags a game NOW carries
 * as `addedTags` and the tags it USED to carry but no longer does as `removedTags`
 * (an unpublish/removal passes all prior tags as removed and nothing as added).
 */
export async function bumpTagStats(
  addedTags: string[],
  removedTags: string[],
): Promise<void> {
  // Nothing to do — skip the transaction (and its read) entirely.
  if ((addedTags?.length ?? 0) === 0 && (removedTags?.length ?? 0) === 0) return;
  try {
    const ref = db.doc(TAG_STATS_DOC);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = (snap.exists ? (snap.data()?.tags as TagCounts) : null) ?? {};
      const merged = mergeTagCounts(current, addedTags ?? [], removedTags ?? []);
      // Flat, non-dotted write of the whole map — no array elements, no dotted keys.
      tx.set(ref, { tags: merged, updatedAt: new Date().toISOString() });
    });
  } catch (e) {
    functions.logger.warn('tagStats.bump.failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Read the denormalized count map (empty on miss or read failure — fail open). */
export async function readStoredTagCounts(): Promise<TagCounts> {
  try {
    const snap = await db.doc(TAG_STATS_DOC).get();
    return cleanBase((snap.exists ? (snap.data()?.tags as TagCounts) : null) ?? {});
  } catch (e) {
    functions.logger.warn('tagStats.read.failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return {};
  }
}

/**
 * The `limit` most-used tags from the denormalized doc, most-popular first.
 * A single point read — the cheap path. `getPopularTags` decides what to do when
 * this is empty (live fallback + seed); this helper stays a faithful projection of
 * the stored counts so it can be reasoned about on its own.
 */
export async function readPopularTags(limit: number): Promise<string[]> {
  const counts = await readStoredTagCounts();
  const wanted = Math.max(0, Math.floor(limit) || 0);
  return sortTagCounts(counts).slice(0, wanted).map((e) => e.tag);
}
