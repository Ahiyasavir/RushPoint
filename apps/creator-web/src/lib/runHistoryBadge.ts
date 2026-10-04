// "Is this run being played now?" and what a run history row says about its status
// (scripts/test-run-history-badge.ts).
//
// `live` only means nobody pressed "end the run". Within a day of launch that is people
// playing; after that it is a run left open, and "playing now" on an August run was false.
// ONE predicate, `isPlayingNow`, read by the history badge AND the floating run bar
// (change: active-run-bar-recent), so the two can never disagree. A live run with no
// readable date counts as playing: a missing field must never hide a real event.

export type RunHistoryBadge = 'live' | 'open' | 'finished' | 'draft';

const PLAYING_WINDOW_MS = 24 * 3600_000;

interface RunLike { status?: unknown; launchedAt?: unknown; createdAt?: unknown }

/**
 * Is this live run being played now? An absent `status` is read as live, because the
 * floating bar's summaries (`LiveRunSummary`) come from a live-only listing and carry none.
 */
export function isPlayingNow(run: RunLike | null | undefined, now: number): boolean {
  if (!run) return false;
  if (run.status !== undefined && run.status !== 'live') return false;
  const iso = typeof run.launchedAt === 'string' ? run.launchedAt : typeof run.createdAt === 'string' ? run.createdAt : '';
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || !Number.isFinite(now)) return true;
  return now - at <= PLAYING_WINDOW_MS;
}

export function runHistoryBadge(run: RunLike | null | undefined, now: number): RunHistoryBadge | null {
  if (!run) return null;
  if (run.status === 'finished') return 'finished';
  if (run.status === 'draft') return 'draft';
  if (run.status !== 'live') return null;
  return isPlayingNow(run, now) ? 'live' : 'open';
}
