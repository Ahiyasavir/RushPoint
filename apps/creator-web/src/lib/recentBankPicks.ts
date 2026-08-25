// The per-creator recency memory — which missions this creator was handed
// recently (change: smart-game-composer).
//
// ─── Why this is a separate module from the composer ─────────────────────────
//
// This is the ONLY stateful piece of the smart-build path, and it is kept
// strictly outside `composeGame`, which receives a VALUE and never a storage
// handle. That is what keeps "same seed ⇒ same game" true no matter what is on
// disk, and it is the same separation `lib/teamAttention.ts` and
// `lib/photoReviewQueue.ts` get by taking `now` as an argument rather than
// reading the clock. scripts/test-composer-robustness.ts §11 asserts the
// composer never imports this file.
//
// ─── Why everything here fails soft ──────────────────────────────────────────
//
// This memory exists to make three generated games feel different. It is a
// nice-to-have. Storage, meanwhile, throws for real and common reasons — Safari
// private mode, a cookies-disabled profile, an embedded webview, a filled quota.
// If any of those became an exception, a creator would press "create my game"
// and get nothing at all: a total failure of the core flow in defence of a
// nicety. So every read degrades to an empty memory, every write to a no-op, and
// composition carries on.
//
// The store is a parameter rather than a direct `localStorage` reach, so the
// throwing and malformed cases are fixtures in
// scripts/test-recent-bank-picks.ts instead of global monkey-patches.
import { RECENCY_WINDOW } from './composeGame';
import type { RecentPickState } from './composeGame';

/** The two methods this module needs. Anything shaped like this will do. */
export interface PicksStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The key PREFIX, never a key on its own — a browser holds several accounts, and
 * one creator's memory must not steer another's game. Same convention as
 * `knownGameCountKey` / `tourStorageKey` in lib/creatorOnboarding.ts.
 */
export const RECENT_PICKS_KEY_PREFIX = 'rp-smart-build-recent';

/**
 * How many keys are kept — roughly five generations at ~8 missions each.
 *
 * Deliberately equal to the composer's `RECENCY_WINDOW`: storing more than the
 * scorer looks at would be dead weight, and storing fewer would silently shorten
 * the decay the scorer thinks it has. Pinned by the test.
 */
export const RECENCY_LIMIT = RECENCY_WINDOW;

/** Per-creator key. A signed-out creator gets a stable anonymous one. */
export function recentPicksKey(uid: string | null | undefined): string {
  const clean = typeof uid === 'string' ? uid.trim() : '';
  return `${RECENT_PICKS_KEY_PREFIX}:${clean || 'anon'}`;
}

/** The ambient store, if this environment has a usable one. */
function defaultStore(): PicksStore | undefined {
  try {
    const ls = (globalThis as { localStorage?: PicksStore }).localStorage;
    return ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function' ? ls : undefined;
  } catch {
    // Merely TOUCHING localStorage throws in some locked-down profiles.
    return undefined;
  }
}

/** Only the real, non-blank strings of an unknown value, in order. */
function usableKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const k of value) {
    if (typeof k !== 'string') continue;
    const clean = k.trim();
    if (clean === '') continue;
    out.push(clean);
  }
  return out;
}

/**
 * What this creator was handed recently, newest first.
 *
 * Absent, unreadable or malformed storage all yield an EMPTY memory rather than
 * an error or a partially-typed array — a `null` slipping through would occupy a
 * recency position that belongs to a real mission.
 */
export function readRecentPicks(
  uid?: string | null,
  store: PicksStore | undefined = defaultStore(),
): RecentPickState {
  if (!store) return { recentBankKeys: [] };

  let raw: unknown;
  try {
    raw = store.getItem(recentPicksKey(uid));
  } catch {
    return { recentBankKeys: [] };
  }
  if (typeof raw !== 'string' || raw.trim() === '') return { recentBankKeys: [] };

  try {
    return { recentBankKeys: usableKeys(JSON.parse(raw)).slice(0, RECENCY_LIMIT) };
  } catch {
    return { recentBankKeys: [] };
  }
}

/**
 * Record a generation, newest first.
 *
 * A key used again MOVES to the front rather than being appended: position IS
 * the penalty, so a duplicate would leave a stale, weaker copy deciding the
 * score for a mission that was just used.
 */
export function recordRecentPicks(
  uid: string | null | undefined,
  usedKeys: string[],
  store: PicksStore | undefined = defaultStore(),
): void {
  if (!store) return;

  const fresh = usableKeys(usedKeys);
  if (fresh.length === 0) return;

  const existing = readRecentPicks(uid, store).recentBankKeys;

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const k of [...fresh, ...existing]) {
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(k);
    if (merged.length >= RECENCY_LIMIT) break;
  }

  try {
    store.setItem(recentPicksKey(uid), JSON.stringify(merged));
  } catch {
    // A full quota or a blocked store costs this creator one repeated mission.
    // It must never cost them the game they just asked for.
  }
}
