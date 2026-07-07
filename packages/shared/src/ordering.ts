// Ordering quiz variant (change: quiz-ordering) — pure helpers shared by the
// participant sanitizer (per-team deterministic shuffle), the submitTaskAnswer
// grader, and Builder/server validation.
//
// The authored `orderItems` array IS the answer key: the item texts are public,
// the ORDER is server-secret. So the shuffle must be deterministic per seed
// (reload-stable, no reshuffle-to-solve, no per-request randomness to diff) and
// must NEVER return the authored order (identity guard).
import type { Task } from './types';

export const ORDER_ITEMS_MIN = 3;
export const ORDER_ITEMS_MAX = 10;

/** An ordering task = a quiz task carrying a non-empty orderItems array. */
export function isOrderingTask(task: Pick<Task, 'type' | 'orderItems'>): boolean {
  return task.type === 'quiz' && Array.isArray(task.orderItems) && task.orderItems.length > 0;
}

// FNV-1a 32-bit hash of the seed string → a well-mixed PRNG seed.
function fnv1a(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — tiny deterministic PRNG (identical output on any JS engine, so
// the emulator and production shuffle the same way; no Math.random anywhere).
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically shuffle `items` by `seed` (Fisher–Yates over a copy; the
 * input is never mutated). Same seed ⇒ same permutation. Identity guard: if the
 * drawn permutation equals the input order, rotate by one so the client NEVER
 * receives the authored order (validation enforces ≥ 3 distinct items, so a
 * rotation is always a real change).
 */
export function seededShuffle(items: string[], seed: string): string[] {
  const out = items.slice();
  if (out.length < 2) return out;
  const rand = mulberry32(fnv1a(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.every((v, i) => v === items[i])) {
    out.push(out.shift() as string);
  }
  return out;
}

// Per-item normalization used by BOTH grading and duplicate detection: trim,
// lowercase, collapse internal whitespace runs to one space.
function normalizeItem(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Grade a submitted arrangement against the authored (correct) order.
 * SERVER-ONLY: `orderItems` is the answer key — never call with client data as
 * the first argument. Position-by-position, per-item case/whitespace-insensitive;
 * anything that isn't a same-length array of strings is simply wrong.
 */
export function matchesOrderedAnswer(orderItems: string[], submitted: unknown): boolean {
  if (!Array.isArray(submitted) || submitted.length !== orderItems.length) return false;
  return orderItems.every(
    (item, i) => typeof submitted[i] === 'string' && normalizeItem(submitted[i]) === normalizeItem(item),
  );
}

/**
 * Validate authored orderItems. Returns an error string, or null when valid.
 * Absent / non-array ⇒ null (simply not an ordering task). Errors: too few /
 * too many items, a non-string or empty item, or two items equal after
 * normalization (would make grading ambiguous and the shuffle distinguishable).
 */
export function validateOrderItems(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  if (items.length < ORDER_ITEMS_MIN) {
    return `An ordering question needs at least ${ORDER_ITEMS_MIN} items`;
  }
  if (items.length > ORDER_ITEMS_MAX) {
    return `An ordering question allows at most ${ORDER_ITEMS_MAX} items`;
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== 'string' || item.trim() === '') {
      return 'Every ordering item needs text';
    }
    const norm = normalizeItem(item);
    if (seen.has(norm)) {
      return `Ordering items must be distinct ("${item.trim()}" repeats)`;
    }
    seen.add(norm);
  }
  return null;
}
