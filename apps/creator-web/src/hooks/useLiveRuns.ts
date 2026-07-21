import { useEffect, useState } from 'react';
import type { LiveRunSummary } from '@rushpoint/shared';
import { listLiveRuns } from '../services/calls';
import { useAuth } from '../components/AuthGate';
import { LIVE_RUNS_POLL_MS, pollDelayFor } from './liveRunsPolling';

// ── Shared live-run store ─────────────────────────────────────────────────────
// One `listLiveRuns` poll loop for the WHOLE app. Both the persistent
// <ActiveRunBar/> and RunsOverviewPage consume it, and on /live both are mounted
// at once — a per-component interval would double the callable load app-wide.
// The timer lives here (module scope), never in the hook: the first subscriber
// starts it, the last one stops it, and it pauses while the tab is hidden.

interface Snapshot {
  runs: LiveRunSummary[] | null;
  errored: boolean;
}

let snapshot: Snapshot = { runs: null, errored: false };
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let visibilityBound = false;
const subscribers = new Set<(s: Snapshot) => void>();

function emit() {
  for (const fn of subscribers) fn(snapshot);
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Fetch once. Concurrent callers share the same request. */
function poll(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await listLiveRuns({});
      snapshot = { runs: res.runs, errored: false };
    } catch {
      // Keep the last good list on-screen; only flag the error state.
      snapshot = { runs: snapshot.runs, errored: true };
    } finally {
      fetchedAt = Date.now();
      inFlight = null;
    }
    emit();
  })();
  return inFlight;
}

/** Start/stop/re-arm the single interval according to the pure policy. */
function syncTimer() {
  const delay = pollDelayFor({ hidden: isHidden(), subscribers: subscribers.size });
  if (delay === null) {
    if (timer) { clearInterval(timer); timer = null; }
    return;
  }
  if (timer) return;
  timer = setInterval(() => void poll(), delay);
}

function onVisibility() {
  syncTimer();
  // Catch up immediately when the creator comes back to the tab.
  if (!isHidden() && subscribers.size > 0 && Date.now() - fetchedAt >= LIVE_RUNS_POLL_MS) void poll();
}

function subscribe(fn: (s: Snapshot) => void): () => void {
  subscribers.add(fn);
  if (!visibilityBound && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    visibilityBound = true;
  }
  syncTimer();
  // New subscriber gets the cached snapshot instantly; only refetch if stale.
  if (!isHidden() && (snapshot.runs === null || Date.now() - fetchedAt >= LIVE_RUNS_POLL_MS)) void poll();
  return () => {
    subscribers.delete(fn);
    syncTimer();
  };
}

export interface UseLiveRuns extends Snapshot {
  /** Force an immediate refresh (retry button, right after finalizing a run). */
  refresh: () => Promise<void>;
}

/**
 * Live runs for the signed-in creator, backed by the shared poll loop above.
 * Returns `runs === null` until the first response lands.
 */
export function useLiveRuns(): UseLiveRuns {
  const { user } = useAuth();
  const authed = !!user;
  const [state, setState] = useState<Snapshot>(snapshot);

  useEffect(() => {
    if (!authed) return;               // never poll for a signed-out creator
    return subscribe(setState);
  }, [authed]);

  if (!authed) return { runs: null, errored: false, refresh: async () => {} };
  return { ...state, refresh: poll };
}
