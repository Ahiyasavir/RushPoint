// Pure timing / rotation / selection logic for the crash-safe emulator backup
// loop (change: emulator-data-backup). No Date.now(), no filesystem, no spawn —
// time and directory listings are passed in so this is fully unit-testable.

/** True when a snapshot is due: never taken yet, or the interval has elapsed. */
export function isSnapshotDue(lastTs, nowTs, intervalMs) {
  if (lastTs == null) return true;
  return nowTs - lastTs >= intervalMs;
}

/**
 * Whether the emulator suite is fully booted, given the parsed emulator Hub
 * `/emulators` response (or null on a failed probe). Ready iff BOTH the
 * `firestore` and `functions` emulators are present — functions load last, so
 * their presence means boot is effectively complete and an export is safe.
 * Never run an export against a not-ready emulator: it wedges Firestore and
 * cascade-kills the playtest stack.
 */
export function isEmulatorReady(hubJson) {
  if (!hubJson || typeof hubJson !== 'object') return false;
  return Boolean(hubJson.firestore) && Boolean(hubJson.functions);
}

/**
 * The single gate the backup loop consults before spawning an export: only when
 * the emulator is ready AND a snapshot is due. `ready` comes from
 * `isEmulatorReady`; the due check reuses `isSnapshotDue`. Pure — no I/O.
 */
export function canAttemptExport({ ready, lastTs, nowTs, intervalMs }) {
  return ready === true && isSnapshotDue(lastTs, nowTs, intervalMs);
}

/**
 * Deterministic, lexicographically-sortable snapshot folder name for a timestamp
 * (ms). ISO-8601 in UTC with `:`/`.` swapped for `-` so the string sorts in
 * chronological order.
 */
export function snapshotName(nowTs) {
  const iso = new Date(nowTs).toISOString();       // 2026-06-28T12:34:56.789Z
  return `backup-${iso.replace(/[:.]/g, '-')}`;     // backup-2026-06-28T12-34-56-789Z
}

/** Chronological sort of snapshot names (names sort lexicographically). */
function sortedAsc(names) {
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The oldest snapshots to delete so only the newest `keepN` remain. Returns []
 * when at/under the limit (or keepN covers everything).
 */
export function selectSnapshotsToPrune(names, keepN) {
  const sorted = sortedAsc(names);
  if (keepN <= 0) return sorted;                    // keep nothing → prune all
  if (sorted.length <= keepN) return [];
  return sorted.slice(0, sorted.length - keepN);    // the oldest extras
}

/**
 * The most recent VALID snapshot to restore from. Skips a newest-but-invalid
 * snapshot in favor of an older valid one. `entries` = `{ name, valid }[]`.
 * Returns null when empty or all invalid.
 */
export function selectRestoreTarget(entries) {
  const valid = (entries ?? []).filter((e) => e && e.valid);
  if (valid.length === 0) return null;
  const sorted = sortedAsc(valid.map((e) => e.name));
  return sorted[sorted.length - 1];                 // newest valid
}
