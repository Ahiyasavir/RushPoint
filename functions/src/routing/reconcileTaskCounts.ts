// ─── Station-count reconciliation (self-heal for run.taskCounts) ──────────────
//
// `run.taskCounts[taskId]` is the live station-occupancy counter: assignTask
// increments it when it reserves a slot, releaseTask decrements it when the team
// leaves the task. The counter can drift ABOVE the true number of holders if a
// process crashes between "increment + claim" and "complete + release" (a leaked
// slot) — which permanently shrinks a station's effective capacity.
//
// `reconcileTaskCounts` recomputes the ground truth purely from the live team
// documents: a team holds exactly one station slot iff it currently has a non-empty
// `activeTaskId` (the mirror assignTask/claim set, cleared on completion). Summing
// those holders per taskId yields the counts the run doc SHOULD carry. Used as:
//   • the finalizeRun backstop — overwrite run.taskCounts with the reconciled value
//     (idempotent, one write) so a leaked +1 never survives into archived state; and
//   • the load-sim / e2e equality oracle — assert the STORED counts equal the
//     reconciled counts (a stronger check than "all zero": it flags an orphaned +1
//     that survived because a station never drained).
//
// Pure (no Firestore I/O) so it runs in the no-emulator vitest lane.

import type { RunTeam } from '@rushpoint/shared';

// A team holds a station slot for `activeTaskId` while it is a non-empty string.
// A null/undefined/'' activeTaskId means the team is between tasks (finished, or
// waiting for the next assignment) and contributes to no counter.
export function reconcileTaskCounts(teams: RunTeam[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const team of teams) {
    const held = team?.activeTaskId;
    if (typeof held !== 'string' || held.length === 0) continue;
    counts[held] = (counts[held] ?? 0) + 1;
  }
  return counts;
}

// True when `stored` matches the reconciled ground truth exactly — same keys, same
// non-zero values. Zero-valued keys on either side are ignored (a drained station
// legitimately sits at 0 and may or may not still carry the key). A mismatch means a
// leaked (or negative) counter: the stored map disagrees with who actually holds slots.
export function taskCountsReconciled(
  stored: Record<string, number> | undefined,
  teams: RunTeam[],
): boolean {
  const expected = reconcileTaskCounts(teams);
  const nonZero = (m: Record<string, number>) =>
    Object.entries(m).filter(([, v]) => v !== 0);
  const storedNZ = nonZero(stored ?? {});
  const expectedNZ = nonZero(expected);
  if (storedNZ.length !== expectedNZ.length) return false;
  return storedNZ.every(([k, v]) => expected[k] === v);
}
