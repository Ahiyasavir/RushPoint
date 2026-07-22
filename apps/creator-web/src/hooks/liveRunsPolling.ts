// Pure policy for the shared live-run poll + the persistent ActiveRunBar.
// Deliberately dependency-free (no React, no Firebase) so it runs in the node-env
// vitest lane — see docs/wave-a/active-run-bar.md.
import type { LiveRunSummary } from '@rushpoint/shared';

/** How often the shared `listLiveRuns` loop fires while the tab is visible. */
export const LIVE_RUNS_POLL_MS = 10_000;

/**
 * Interval for the shared poll loop, or `null` when it must be paused entirely.
 * Paused when nothing consumes the data, or while the tab is hidden — an
 * always-on 10s callable on every route would be a real cost regression.
 */
export function pollDelayFor({ hidden, subscribers }: { hidden: boolean; subscribers: number }): number | null {
  if (hidden || subscribers <= 0) return null;
  return LIVE_RUNS_POLL_MS;
}

/**
 * The single run the floating bar features: the most recently launched one.
 * `launchedAt === null` sorts last; ties break on runId so the bar never flickers
 * between two runs across polls.
 */
export function selectFeaturedRun(runs: LiveRunSummary[] | null | undefined): LiveRunSummary | null {
  if (!runs || runs.length === 0) return null;
  let best: LiveRunSummary | null = null;
  for (const r of runs) {
    if (!best) { best = r; continue; }
    const a = r.launchedAt ? Date.parse(r.launchedAt) : Number.NEGATIVE_INFINITY;
    const b = best.launchedAt ? Date.parse(best.launchedAt) : Number.NEGATIVE_INFINITY;
    const aa = Number.isFinite(a) ? a : Number.NEGATIVE_INFINITY;
    const bb = Number.isFinite(b) ? b : Number.NEGATIVE_INFINITY;
    if (aa > bb || (aa === bb && r.runId < best.runId)) best = r;
  }
  return best;
}

/** `/run/:gameId/:runId` for the given run — the console the bar re-enters. */
export function runConsolePath(run: Pick<LiveRunSummary, 'gameId' | 'runId'>): string {
  return `/run/${run.gameId}/${run.runId}`;
}

/** True for the `/run/:gameId/:runId` route shape — ANY run console, not one run's. */
export function isRunConsolePath(pathname: string): boolean {
  const parts = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/');
  // ['', 'run', gameId, runId]
  return parts.length === 4 && parts[0] === '' && parts[1] === 'run' && !!parts[2] && !!parts[3];
}

/**
 * The bar is a shortcut back to a run you navigated away from, so it hides where
 * those controls already live: ANY run console and the /live overview. It stays
 * visible everywhere else, Builder included (in compact mode).
 *
 * It suppresses on any console, not only the featured run's: the bar features
 * exactly one run (`selectFeaturedRun`), so with two live runs a creator sitting
 * in run B's console used to see a bar whose "End run" finalizes run A — ending
 * the wrong event, irreversibly, on the wrong participants.
 */
export function shouldShowBar({
  authed, featured, pathname,
}: { authed: boolean; featured: LiveRunSummary | null; pathname: string }): boolean {
  if (!authed || !featured) return false;
  if (pathname === '/live' || pathname.startsWith('/live/')) return false;
  if (isRunConsolePath(pathname)) return false;
  return true;
}

/**
 * The Builder is an `h-screen overflow-hidden` 3-pane workspace whose panels run
 * to the viewport edge, so there the bar renders as a collapsed pill the creator
 * expands on demand instead of a full-width bar covering the panel chrome.
 */
export function barMode(pathname: string): 'compact' | 'full' {
  return pathname.startsWith('/build/') ? 'compact' : 'full';
}
