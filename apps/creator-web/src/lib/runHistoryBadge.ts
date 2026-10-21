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

interface RunLike { status?: unknown; launchedAt?: unknown; createdAt?: unknown; updatedAt?: unknown }

function parseIso(v: unknown): number {
  return typeof v === 'string' ? Date.parse(v) : Number.NaN;
}

/**
 * When this run last showed life: the later of its launch (or creation) and its last write.
 * D07 (race 14.10): the real run was launched on 12.10 and played on 14.10, and counting only
 * from launch hid it while 31 teams played on it. The server writes `updatedAt` during play.
 * NaN when the run carries no readable date at all.
 */
export function runLastActivityMs(run: RunLike | null | undefined): number {
  if (!run) return Number.NaN;
  const launched = Number.isFinite(parseIso(run.launchedAt)) ? parseIso(run.launchedAt) : parseIso(run.createdAt);
  const touched = parseIso(run.updatedAt);
  if (!Number.isFinite(launched)) return touched;
  return Number.isFinite(touched) ? Math.max(launched, touched) : launched;
}

/**
 * Which of two live runs a "go to the run" link should mean (D08): one with players before one
 * without, then the one played most recently, then runId so a poll never flickers. On 14.10 the
 * run bar and the game card both led to an empty run launched that morning by mistake, while the
 * real run, launched two days earlier, held every team. Negative when `a` comes first.
 */
export function compareRunsForFocus(
  a: RunLike & { participantCount?: unknown; runId: string },
  b: RunLike & { participantCount?: unknown; runId: string },
): number {
  const ap = typeof a.participantCount === 'number' && a.participantCount > 0 ? 1 : 0;
  const bp = typeof b.participantCount === 'number' && b.participantCount > 0 ? 1 : 0;
  if (ap !== bp) return bp - ap;
  const at = runLastActivityMs(a);
  const bt = runLastActivityMs(b);
  const aa = Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
  const bb = Number.isFinite(bt) ? bt : Number.NEGATIVE_INFINITY;
  if (aa !== bb) return bb > aa ? 1 : -1;
  return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
}

/**
 * Is this live run being played now? An absent `status` is read as live, because the
 * floating bar's summaries (`LiveRunSummary`) come from a live-only listing and carry none.
 */
export function isPlayingNow(run: RunLike | null | undefined, now: number): boolean {
  if (!run) return false;
  if (run.status !== undefined && run.status !== 'live') return false;
  const at = runLastActivityMs(run);
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
