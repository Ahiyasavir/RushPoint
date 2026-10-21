// "Is this game already running?" asked BEFORE a launch (D06, D09, race to Zion 14.10).
//
// The run had been launched on 12.10. On the morning of the race "הפעל ריצה" was pressed to open
// the game, and every press made a NEW live run and jumped the console to it: three empty runs
// between 08:42 and 09:25, while teams were joining the real one and nobody could see them. Both
// launch buttons (Builder header, Dashboard card) now ask this first and offer to go back to the
// run that is already live. Pure: no React, no Firebase.
import type { LiveRunSummary } from '@rushpoint/shared';
import { compareRunsForFocus } from './runHistoryBadge';

/**
 * The live run of `gameId` a launch would duplicate, or null. A test run never counts (rehearsing
 * must not block the real launch). Among several, the one with players and played most recently.
 * Total: junk in is "nothing to resume".
 */
export function liveRunToResume(
  gameId: string,
  runs: LiveRunSummary[] | null | undefined,
): LiveRunSummary | null {
  if (!gameId || !Array.isArray(runs)) return null;
  let best: LiveRunSummary | null = null;
  for (const r of runs) {
    if (!r || r.gameId !== gameId || r.isTestDrive === true) continue;
    if (!best || compareRunsForFocus(r, best) < 0) best = r;
  }
  return best;
}

export type LaunchOverLiveRun =
  | { kind: 'launch' }
  | { kind: 'open'; run: LiveRunSummary }
  | { kind: 'cancel' };

export interface LaunchGuardCopy {
  /** "This game is already running: launched {when}, {teams} players. Open it?" */
  existsBody: (p: { when: string; players: number }) => string;
  openCta: string;
  /** Asked only after "no": launching a SECOND live run is deliberate, and said so. */
  anotherBody: string;
  anotherCta: string;
}

/**
 * Ask before a real launch when the game already has a live run. The list is fetched FRESH at the
 * press, never from a cache the morning's first press could not have refreshed yet. Fails OPEN:
 * if the list cannot be read, the launch goes ahead exactly as it did before this guard.
 */
export async function decideLaunchOverLiveRun(deps: {
  gameId: string;
  fetchLiveRuns: () => Promise<LiveRunSummary[]>;
  confirm: (message: string, cta: string, danger?: boolean) => Promise<boolean>;
  copy: LaunchGuardCopy;
  formatWhen: (iso: string | null) => string;
}): Promise<LaunchOverLiveRun> {
  let runs: LiveRunSummary[];
  try { runs = await deps.fetchLiveRuns(); } catch { return { kind: 'launch' }; }
  const existing = liveRunToResume(deps.gameId, runs);
  if (!existing) return { kind: 'launch' };
  const open = await deps.confirm(
    deps.copy.existsBody({ when: deps.formatWhen(existing.launchedAt), players: existing.participantCount ?? 0 }),
    deps.copy.openCta,
  );
  if (open) return { kind: 'open', run: existing };
  const another = await deps.confirm(deps.copy.anotherBody, deps.copy.anotherCta, true);
  return another ? { kind: 'launch' } : { kind: 'cancel' };
}

/** "Monday 12.10, 18:00" in the console's language, for the question above. '' when unknown. */
export function formatLaunchWhen(iso: string | null, lang: string): string {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', {
      weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
}
