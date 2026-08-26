// Pure polling policy for the Run Console's teams board (perf: run-console-poll-cost).
//
// WHY THIS EXISTS. `listRunTeams` was polled on a flat 5s `setInterval` that never
// paused. With 29 teams that call reads ~60 Firestore documents, so a nine-minute run
// spent ~6,000 of its ~17,000 reads here alone — a third of what exhausted the daily
// quota mid-play on 2026-08-26. The interval also kept firing while the tab was hidden
// and after the run had FINISHED, even though RunConsolePage already makes exactly that
// argument twenty lines further down about its Firestore listeners ("a FINISHED run's
// teams no longer change, so a live listener on them is pure cost that never fires
// again"). The poll simply did not follow the rule the listeners did.
//
// WHY BACK OFF RATHER THAN JUST SLOW DOWN. Raising the interval outright would have cost
// live-ops responsiveness for the whole run: this board is the creator's operational view
// of the field, and a photo-review queue or a stuck team that surfaces 20s late is a real
// regression. So the base interval is UNCHANGED at 5s and only a board that is provably
// not moving backs off — and any change at all snaps it straight back. A busy race polls
// exactly as fast as it did before; the quiet stretches (before the start, between
// clusters of arrivals, after the last team finishes) are what stop costing reads.
//
// Dependency-free on purpose — no React, no Firebase — so it runs in the node-env vitest
// lane beside `hooks/liveRunsPolling.ts`, whose `pollDelayFor` shape this mirrors.

/** Interval while the board is actively changing. Unchanged from the original poll. */
export const TEAMS_POLL_BASE_MS = 5_000;
/** The slowest a live run is ever polled, however long it stays quiet. */
export const TEAMS_POLL_MAX_MS = 20_000;

/**
 * Consecutive unchanged polls → interval. Thresholds, not a formula, so the steps are
 * readable and the cap is exact. Must stay sorted by `afterQuietPolls` ascending.
 */
const BACKOFF_LADDER: ReadonlyArray<{ afterQuietPolls: number; ms: number }> = [
  { afterQuietPolls: 0, ms: TEAMS_POLL_BASE_MS },
  { afterQuietPolls: 3, ms: 10_000 },
  { afterQuietPolls: 9, ms: TEAMS_POLL_MAX_MS },
];

/**
 * How long to wait before the next teams poll, or `null` to stop polling entirely.
 *
 * Paused while the tab is hidden (nobody is looking) and on a finished run (the data
 * cannot change again). Every other status — including an absent or unrecognized one —
 * keeps polling: a run that has not started yet is still taking joins, and guessing
 * "paused" from a status we do not recognize would silently blind the console.
 */
export function teamsPollDelayFor({
  hidden, runStatus, quietPolls,
}: {
  hidden: boolean;
  runStatus?: string | null;
  quietPolls: number;
}): number | null {
  if (hidden) return null;
  if (runStatus === 'finished') return null;

  // A non-finite or negative count means the caller lost track; poll at full speed
  // rather than inventing a back-off from a value we do not trust.
  const quiet = Number.isFinite(quietPolls) && quietPolls > 0 ? Math.floor(quietPolls) : 0;

  let ms = TEAMS_POLL_BASE_MS;
  for (const step of BACKOFF_LADDER) {
    if (quiet >= step.afterQuietPolls) ms = step.ms;
  }
  return Math.min(ms, TEAMS_POLL_MAX_MS);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * A compact digest of everything the teams board renders, used only to answer "did this
 * poll change anything?". Order-independent, so a differently-ordered response from the
 * server does not read as movement and reset the back-off.
 *
 * Total by construction and never throws: this runs on the console's only view of the
 * field, so a malformed row must degrade to "looks different" (poll again) rather than
 * take the page down. The catch below biases the same way for the same reason.
 */
export function teamsFingerprint(teams: readonly unknown[] | null | undefined): string {
  try {
    if (!Array.isArray(teams)) return '';
    const rows: string[] = [];
    for (const t of teams) {
      if (!t || typeof t !== 'object') { rows.push('~'); continue; }
      const team = t as Record<string, unknown>;

      const stages = asArray(team.stages).map((s) => {
        if (!s || typeof s !== 'object') return '~';
        const stage = s as Record<string, unknown>;
        const tasks = asArray(stage.tasks).map((k) => {
          if (!k || typeof k !== 'object') return '~';
          const task = k as Record<string, unknown>;
          return `${str(task.taskId)}:${str(task.status)}`;
        }).join(',');
        return `${str(stage.order)}:${str(stage.status)}[${tasks}]`;
      }).join('|');

      // Pending photo/audio reviews are an attention signal the board shows, so a
      // submission changing state has to count as movement.
      const subs = team.taskSubmissions && typeof team.taskSubmissions === 'object'
        ? Object.entries(team.taskSubmissions as Record<string, unknown>)
          .map(([id, v]) => `${id}:${str((v as { status?: unknown } | null)?.status)}`)
          .sort()
          .join(',')
        : '';

      rows.push([str(team.id), str(team.status), str(team.score), stages, subs].join('#'));
    }
    rows.sort();
    return rows.join(';');
  } catch {
    // Deliberately never equal to a previous digest: an unreadable board resets the
    // back-off and keeps polling at full speed.
    return `ERR:${Date.now()}`;
  }
}
