// What creators teach the mission bank (change: composer-v2-learning).
//
// A bank mission still in a game that launched was KEPT; one regenerated away was SWAPPED. Those
// counts update its quality (apps/creator-web/src/lib/missionQuality.ts: the rating is the prior,
// the counts are the evidence). This is the pure half of `recordMissionSignals`.
//
// One document, `missionStats/all`, holds every count as `counts.<key>.kept|swapped`, so the
// composer reads ONE document rather than one per mission. Writes are rare (a launch, a regenerate),
// far below a single document's write rate. Counts only: no uid, no game, nothing personal.

export const MISSION_STATS_DOC = 'missionStats/all';
/** Keys per call: a launched game's missions plus a little. */
export const MAX_SIGNAL_KEYS = 60;
/** A bank key: lowercase words joined by hyphens. Anything else is dropped before it can become a field path. */
const BANK_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface MissionSignals { kept: string[]; swapped: string[] }

function keys(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((k): k is string => typeof k === 'string' && BANK_KEY.test(k)))];
}

/** The signals worth recording, or null when there is nothing valid to record. */
export function parseMissionSignals(data: unknown): MissionSignals | null {
  const d = (data && typeof data === 'object' ? data : {}) as { kept?: unknown; swapped?: unknown };
  const swapped = keys(d.swapped);
  // A mission swapped away in the same breath it was "kept" was not kept.
  const kept = keys(d.kept).filter((k) => !swapped.includes(k));
  const total = kept.length + swapped.length;
  if (total === 0) return null;
  if (total <= MAX_SIGNAL_KEYS) return { kept, swapped };
  const s = swapped.slice(0, MAX_SIGNAL_KEYS);
  return { kept: kept.slice(0, MAX_SIGNAL_KEYS - s.length), swapped: s };
}

/**
 * The `set(..., { merge: true })` payload. A NESTED object, never dotted keys: `.set` with a dotted
 * key writes a literal field named "a.b" (CLAUDE.md). `inc` is FieldValue.increment, injected so the
 * shape is testable without the Admin SDK.
 */
export function statsIncrements<T>(signals: MissionSignals, inc: (n: number) => T): Record<string, unknown> {
  const counts: Record<string, Record<string, T>> = {};
  for (const k of signals.kept) counts[k] = { kept: inc(1) };
  for (const k of signals.swapped) counts[k] = { swapped: inc(1) };
  return { counts, updatedAt: new Date().toISOString() };
}
