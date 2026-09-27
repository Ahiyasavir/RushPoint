// Which bank missions have already been offered for ONE mission
// (change: mission-regenerate).
//
// ─── Why this is a separate module from the algorithm ────────────────────────
//
// This is the only stateful piece of the regenerate path, and it is kept
// strictly outside `lib/regenerateMission.ts`, which receives the offered keys
// as a VALUE and never a storage handle. That is what keeps "same seed ⇒ same
// pick" true no matter what is on disk — the same separation `recentBankPicks`
// has from the composer, and for the same reason.
//
// ─── Why everything here fails soft ──────────────────────────────────────────
//
// This memory exists to make a second press feel different from the first. It is
// a nicety. Storage, meanwhile, throws for real and common reasons — Safari
// private mode, a cookies-disabled profile, an embedded webview, a filled quota.
// If any of those became an exception, a creator would press regenerate and get
// nothing at all: a total failure of the feature in defence of a nicety. So every
// read degrades to an empty history, every write to a no-op, and the regeneration
// carries on with a slightly worse memory.
//
// The store is a parameter rather than a direct `localStorage` reach, so the
// throwing and malformed cases are fixtures in scripts/test-regenerate-history.ts
// instead of global monkey-patches.

/** The two methods this module needs. Anything shaped like this will do. */
export interface PicksStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The key PREFIX, never a key on its own.
 *
 * Scoped by creator AND game AND mission: two accounts share a browser, one
 * creator has many games, and — the point of the feature — regenerating one
 * mission must not narrow the pool of the mission beside it.
 */
export const REGENERATE_HISTORY_KEY_PREFIX = 'rp-regenerate-offered';

/**
 * How many offered keys are kept per mission.
 *
 * Comfortably more presses than a creator makes on one mission in a sitting, and
 * small enough that a game with many missions cannot fill a storage quota. When
 * the cap is reached the OLDEST offer is forgotten, which is the right thing to
 * forget: the chooser's exhaustion path would have recycled it soon anyway.
 */
export const REGENERATE_HISTORY_LIMIT = 24;

/** Per creator + game + mission. A signed-out creator gets a stable anonymous key. */
export function regenerateHistoryKey(
  uid: string | null | undefined,
  gameId: string | null | undefined,
  taskId: string | null | undefined,
): string {
  const clean = (v: unknown, fallback: string): string => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s === '' ? fallback : s;
  };
  return `${REGENERATE_HISTORY_KEY_PREFIX}:${clean(uid, 'anon')}:${clean(gameId, 'unknown')}:${clean(taskId, 'unknown')}`;
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
 * Which bank keys have already been offered for this mission, newest first.
 *
 * Absent, unreadable or malformed storage all yield an EMPTY history rather than
 * an error: a creator whose browser refuses storage still gets a regeneration,
 * they just get a less varied one.
 */
export function readOfferedKeys(
  uid: string | null | undefined,
  gameId: string | null | undefined,
  taskId: string | null | undefined,
  store: PicksStore | undefined = defaultStore(),
): string[] {
  if (!store) return [];

  let raw: unknown;
  try {
    raw = store.getItem(regenerateHistoryKey(uid, gameId, taskId));
  } catch {
    return [];
  }
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  try {
    return usableKeys(JSON.parse(raw)).slice(0, REGENERATE_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Record that this bank mission was offered for this mission, newest first.
 *
 * A key offered again MOVES to the front rather than being appended: the list is
 * a set with an order, and a duplicate would spend a slot saying something the
 * list already says.
 */
export function recordOfferedKey(
  uid: string | null | undefined,
  gameId: string | null | undefined,
  taskId: string | null | undefined,
  bankKey: string | null | undefined,
  store: PicksStore | undefined = defaultStore(),
): void {
  if (!store) return;
  const fresh = typeof bankKey === 'string' ? bankKey.trim() : '';
  if (fresh === '') return;

  const existing = readOfferedKeys(uid, gameId, taskId, store);

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const k of [fresh, ...existing]) {
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(k);
    if (merged.length >= REGENERATE_HISTORY_LIMIT) break;
  }

  try {
    store.setItem(regenerateHistoryKey(uid, gameId, taskId), JSON.stringify(merged));
  } catch {
    // A full quota or a blocked store costs this creator one repeated suggestion.
    // It must never cost them the regeneration they just asked for.
  }
}

/**
 * Forget this mission's offers.
 *
 * Not wired to a control today — it exists so that a caller which REPLACES a
 * mission wholesale (an import, a paste) can start the memory over rather than
 * inheriting a history that describes a mission which is no longer there.
 */
export function clearOfferedKeys(
  uid: string | null | undefined,
  gameId: string | null | undefined,
  taskId: string | null | undefined,
  store: PicksStore | undefined = defaultStore(),
): void {
  if (!store) return;
  try {
    store.setItem(regenerateHistoryKey(uid, gameId, taskId), '[]');
  } catch {
    // Same posture as the write above.
  }
}
