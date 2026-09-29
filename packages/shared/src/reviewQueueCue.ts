// Is there something NEW in the review queue? (change: live-ops-feedback-loop)
//
// The creator Run Console already cues an SOS the right way: a ref-held set of seen
// ids, baselined to `null` so a fresh mount never replays history, and a cue only
// when a snapshot introduces an id the previous one lacked. The photo/video review
// queue — the thing an organizer is actually blocked on, and the thing players
// complained about waiting for in run `ijI9JMITSf8C9heN1Cwp` — had no such cue.
//
// This is the diff, extracted so it can be tested. The BASELINE is the reason: firing
// twelve cues because someone opened a console over twelve pending items is the
// obvious way to get this wrong, and it is invisible in a screenshot.
//
// FAILS SILENT, NEVER THROWS. It runs inside the same Firestore listener that renders
// the queue; a cue is a nicety and the queue is the job, so every malformed input
// resolves to "nothing new" rather than an exception that would take the panel with
// it. Same posture as `stuckGuards` and `safeZone`.
//
// Dependency-free — scripts/test-review-queue-cue.ts.

/** What a snapshot comparison concluded. */
export interface PendingCueVerdict {
  /** Keys present now that were not present before. Empty unless `shouldCue`. */
  keys: string[];
  /** Should the console play its arrival cue? */
  shouldCue: boolean;
}

const SILENT: PendingCueVerdict = Object.freeze({ keys: [], shouldCue: false }) as PendingCueVerdict;

/** A fresh silent verdict — never the frozen singleton, so a caller cannot mutate it. */
function silent(): PendingCueVerdict {
  return { keys: [], shouldCue: false };
}

// THE KEY IS NOT DEFINED HERE. A submission is a FIELD inside the team document
// (`taskSubmissions[taskId]`), not a document of its own, so there is no id to diff
// and the identity has to be composed — but `submissionKey` in ./photoQueue already
// composes it, and both consoles already key their per-row in-flight guard on it.
// A second definition would be a second answer to "are these the same submission?",
// which is the drift this change's own spec forbids. Callers pass keys built there.

/**
 * Which pending submissions are new since the previous snapshot.
 *
 * `previous === null` means "no snapshot has been seen yet" and is the BASELINE: it
 * always answers silence, however many rows arrived. That is deliberately distinct
 * from an empty `Set`, which means "a snapshot was seen and it was empty" — after
 * which an arrival really is news. Conflating the two is the defect this function
 * exists to prevent.
 *
 * A submission LEAVING (reviewed) never cues, and a snapshot where one leaves while
 * another arrives DOES — which a length comparison would miss.
 */
export function newPendingKeys(
  previous: ReadonlySet<string> | null | undefined,
  current: Iterable<string> | null | undefined,
): PendingCueVerdict {
  const keys = collectKeys(current);
  // Baseline. `undefined` is treated as "not seen yet" alongside `null` so a caller
  // whose ref has not initialised cannot accidentally cue its whole backlog.
  if (previous === null || previous === undefined) return silent();
  if (!isSetLike(previous)) return silent();
  if (keys.length === 0) return silent();

  const fresh: string[] = [];
  for (const k of keys) {
    if (!previous.has(k)) fresh.push(k);
  }
  if (fresh.length === 0) return silent();
  return { keys: fresh, shouldCue: true };
}

/**
 * The de-duplicated string keys of a snapshot, in first-seen order.
 *
 * A string is deliberately REFUSED even though it is iterable: iterating one yields
 * characters, so `'abc'` would become three phantom submissions and cue three times.
 */
function collectKeys(current: Iterable<string> | null | undefined): string[] {
  if (current === null || current === undefined) return [];
  if (typeof current === 'string') return [];
  if (typeof (current as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== 'function') return [];
  const out: string[] = [];
  const seen = new Set<string>();
  try {
    for (const raw of current as Iterable<unknown>) {
      if (typeof raw !== 'string' || raw.length === 0) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      out.push(raw);
    }
  } catch {
    // A throwing iterator is a malformed snapshot, not a reason to take the panel down.
    return [];
  }
  return out;
}

/** Does this value answer `.has(key)` like a Set? */
function isSetLike(value: unknown): value is ReadonlySet<string> {
  return !!value && typeof (value as { has?: unknown }).has === 'function';
}

export { SILENT as SILENT_CUE_VERDICT };

// ── The waiting alarm (change: review-wait-alarm) ─────────────────────────────
//
// Field report 2026-09-27: "alert strongly if I don't approve a photo for more than 20 seconds".
// `newPendingKeys` cues once when a submission ARRIVES; nothing escalated afterwards, however long
// a team stood waiting. Modelled on kitchen display systems: every ticket shows its age and changes
// colour at fixed thresholds until someone clears it. Clock injected, total, and quiet on bad data
// (an unparseable or future timestamp never raises an alarm, the same rule as the wait label).

/** A submission waiting this long raises the alarm. */
export const REVIEW_ALARM_MS = 20_000;
/** A row turns red from here. */
export const REVIEW_RED_MS = 60_000;

export interface WaitingRow { teamId: string; taskId: string; submittedAt: string }
export interface ReviewWaitVerdict {
  level: 'none' | 'alarm';
  oldest: { key: string; waitedMs: number } | null;
  overCount: number;
  playSound: boolean;
}

function waitedMs(row: WaitingRow, nowMs: number): number | null {
  if (!row || typeof row.submittedAt !== 'string' || row.submittedAt === '') return null;
  const at = Date.parse(row.submittedAt);
  if (!Number.isFinite(at) || at > nowMs) return null;
  return nowMs - at;
}

export function reviewWaitAlarm(
  pending: readonly WaitingRow[] | null | undefined,
  nowMs: number,
  opts: { mutedUntilMs?: number | null } = {},
): ReviewWaitVerdict {
  const quiet: ReviewWaitVerdict = { level: 'none', oldest: null, overCount: 0, playSound: false };
  if (!Array.isArray(pending)) return quiet;
  let oldest: ReviewWaitVerdict['oldest'] = null;
  let overCount = 0;
  for (const row of pending) {
    const w = waitedMs(row, nowMs);
    if (w === null || w < REVIEW_ALARM_MS) continue;
    overCount++;
    if (!oldest || w > oldest.waitedMs) oldest = { key: `${row.teamId}:${row.taskId}`, waitedMs: w };
  }
  if (overCount === 0) return quiet;
  const muted = typeof opts.mutedUntilMs === 'number' && Number.isFinite(opts.mutedUntilMs) && opts.mutedUntilMs > nowMs;
  return { level: 'alarm', oldest, overCount, playSound: !muted };
}

/** The colour of one waiting row: fresh, amber from 20 s, red from 60 s. Unknown ⇒ fresh. */
export function reviewRowTone(waited: number): 'fresh' | 'amber' | 'red' {
  if (!Number.isFinite(waited)) return 'fresh';
  if (waited >= REVIEW_RED_MS) return 'red';
  if (waited >= REVIEW_ALARM_MS) return 'amber';
  return 'fresh';
}
