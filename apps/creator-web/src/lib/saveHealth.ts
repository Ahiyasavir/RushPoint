// What the Builder should say about a save still in flight
// (change: save-tells-the-truth).
//
// THE REPORTED DEFECT. "Changes were not saved in real time when there was a
// connectivity problem. The user got no clear indication of this, and the sync only
// happened after turning cellular data on."
//
// The Firebase callable SDK's default timeout is SEVENTY SECONDS
// (`@firebase/functions`: `timeout = options.timeout || 70000`). On a dead connection
// the Builder set status `saving`, showed "שומר…" beside a pulsing dot, and then said
// nothing at all until the promise finally rejected over a minute later. For that whole
// minute it was indistinguishable from a Builder saving normally — because "saving" is
// the word for both — so the creator kept typing into something they believed was
// persisting.
//
// THE FAIL-SAFE DIRECTION IS "DO NOT CRY WOLF". This drives a status line, not a gate.
// An unusable clock, a missing timestamp, a clock that went backwards, or a browser
// that reports nothing about connectivity all resolve to the ordinary in-progress
// state. Escalating on bad evidence would train a creator to ignore the one message
// that matters.
//
// AND IT MAY NEVER GATE. CLAUDE.md is explicit that `navigator.onLine` reads false on
// working connections, so it may INFORM and must never BLOCK — which is why there is no
// "should we send?" answer anywhere in this module. The save always goes out; this only
// decides what the creator is told while it is out.
//
// Pure: no React, no DOM, no clock of its own — `nowMs` is injected so the whole thing
// is testable. scripts/test-save-health.ts.

/** A save in flight this long has stopped looking routine. */
export const SAVE_SLOW_AFTER_MS = 6_000;

/** A save in flight this long is almost certainly a connection problem. */
export const SAVE_STALLED_AFTER_MS = 20_000;

/** The Builder's own save status, plus the states this module can escalate to. */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'failed';
export type SaveHealthLevel = SaveStatus | 'slow' | 'stalled' | 'offline';

export interface SaveHealthInput {
  status: SaveStatus;
  /** When the in-flight save started. Null when nothing is in flight. */
  startedAtMs?: number | null;
  /** Injected clock. */
  nowMs?: number | null;
  /** `navigator.onLine`. Undefined where the browser will not say. */
  online?: boolean;
}

export interface SaveHealth {
  level: SaveHealthLevel;
  /** How long the save has been in flight, or null when it cannot be measured. */
  elapsedMs: number | null;
  /** Should the creator be doing something about this? */
  needsAttention: boolean;
}

/** A finite number, or null. */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * What to tell the creator about the current save.
 *
 * Escalation is monotonic in elapsed time and `offline` outranks everything the clock
 * could say, because a browser that knows it has no connection is better evidence than
 * a stopwatch.
 *
 * Anything that is not an in-flight save is passed straight through: `saved`,
 * `unsaved` and `failed` already mean what they say, and re-deciding them here would
 * put two owners on one piece of state.
 */
export function saveHealth(input: SaveHealthInput): SaveHealth {
  const safe = (input && typeof input === 'object' && !Array.isArray(input))
    ? input
    : ({ status: 'saved' } as SaveHealthInput);

  const status: SaveStatus = safe.status === 'saving' || safe.status === 'unsaved'
    || safe.status === 'failed' || safe.status === 'saved'
    ? safe.status
    : 'saved';

  if (status !== 'saving') {
    return { level: status, elapsedMs: null, needsAttention: status === 'failed' };
  }

  const startedAt = finite(safe.startedAtMs);
  const now = finite(safe.nowMs);
  // A backwards clock (device time change, a tab resuming from sleep) is not evidence
  // of a long save.
  const elapsedMs = startedAt !== null && now !== null && now >= startedAt
    ? now - startedAt
    : null;

  // Explicitly `=== false`: `undefined` means "the browser would not say", which is
  // not the same as "offline", and guessing would raise a false alarm on every save
  // in an embedded webview that omits the property.
  if (safe.online === false) {
    return { level: 'offline', elapsedMs, needsAttention: true };
  }
  if (elapsedMs !== null && elapsedMs >= SAVE_STALLED_AFTER_MS) {
    return { level: 'stalled', elapsedMs, needsAttention: true };
  }
  if (elapsedMs !== null && elapsedMs >= SAVE_SLOW_AFTER_MS) {
    return { level: 'slow', elapsedMs, needsAttention: true };
  }
  return { level: 'saving', elapsedMs, needsAttention: false };
}
