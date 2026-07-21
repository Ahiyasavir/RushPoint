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

/**
 * Inverse of `snapshotName`: parse a `backup-<iso-with-dashes>` folder name back to
 * epoch-ms, or NaN if it doesn't match. The date keeps its own dashes, so we only
 * un-swap the time separators after the `T` (HH-MM-SS-mmm → HH:MM:SS.mmm).
 */
export function snapshotTimeMs(name) {
  const m = /^backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name || '');
  if (!m) return NaN;
  const [, date, hh, mm, ss, ms] = m;
  return Date.parse(`${date}T${hh}:${mm}:${ss}.${ms}Z`);
}

/**
 * Choose the FRESHEST import source between the primary export dir and the newest
 * valid periodic backup — the fix for the "planned export shadows a newer crash
 * backup" hazard. On a clean/planned teardown the primary dir is written last and
 * wins; after a crash (no planned export) the newest periodic backup can be newer
 * and must win instead. Inputs are already-resolved timestamps (ms) so this stays
 * pure/testable; either may be null/NaN when that source is absent.
 *   returns 'primary' | 'backup' | null
 * Ties (equal ms) prefer 'primary' (the just-written clean export). When only one
 * source is present, that one wins; when neither is, null (start fresh).
 */
export function selectFreshestImport({ primaryMs, backupMs }) {
  const p = Number.isFinite(primaryMs) ? primaryMs : null;
  const b = Number.isFinite(backupMs) ? backupMs : null;
  if (p == null && b == null) return null;
  if (p == null) return 'backup';
  if (b == null) return 'primary';
  return p >= b ? 'primary' : 'backup';
}

/**
 * Whether an `emulators:export` attempt actually wrote a fresh snapshot — decided by
 * the metadata file's mtime, NOT the child process's exit code. On Windows,
 * `firebase emulators:export` hits a libuv assertion during shutdown
 * (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, src/win/async.c) and
 * exits with a garbage non-zero status EVEN WHEN THE EXPORT GENUINELY SUCCEEDED (the
 * file is written and valid before the crash-on-exit happens). Trusting the exit
 * code makes every export look like a failure. The metadata file's mtime is ground
 * truth: if it didn't exist before and exists now, or its mtime moved forward, the
 * export wrote real data — the exit code is irrelevant noise.
 *   beforeMtimeMs: mtime of the metadata file before the attempt, or null if absent.
 *   afterExists / afterMtimeMs: metadata file state read AFTER the attempt.
 */
export function didExportSucceed({ beforeMtimeMs, afterExists, afterMtimeMs }) {
  if (!afterExists) return false;
  if (beforeMtimeMs == null) return true;               // didn't exist before, does now
  return typeof afterMtimeMs === 'number' && afterMtimeMs > beforeMtimeMs;
}
