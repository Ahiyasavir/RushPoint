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
 *
 * SUPERSEDED by `planRetention` (change: emulator-backup-tiered-retention): this flat
 * rule gave a ~20-minute recovery window, which is what made a bad dataset import
 * unrecoverable. The loop no longer calls it. Kept exported (and tested) because it is
 * still the correct answer to its own narrow question — "which are beyond the newest N".
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
 *
 * SUPERSEDED by `selectImportSource` (change: emulator-backup-tiered-retention). Freshness
 * alone is not a safe criterion: the caller was comparing a file mtime against a folder-name
 * timestamp, and nothing checked whether the winner actually contained anything. dev-emulator
 * now uses selectImportSource; this stays exported and tested for its narrow question.
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

// ─────────────────────────────────────────────────────────────────────────────
// Tiered retention (change: emulator-backup-tiered-retention)
//
// The flat "keep the newest 10" rule gave a ~20-minute recovery window: snapshots
// are FULL exports, so retention does not age out old *data*, it discards old
// *states* — which is exactly what makes it fatal after a bad dataset import. All
// ten folders get rewritten from the replacement dataset within 20 minutes and the
// originals are fs.rmSync'd. A grandfather-father-son policy keeps recent + hourly
// + daily states so a swap stays undoable for weeks instead of minutes.
//
// This is the single most dangerous function in the repo's dev tooling: it decides
// what gets DELETED. Hence: pure, total, and clock-free.
// ─────────────────────────────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Bucket index for a timestamp, derived from ABSOLUTE epoch ms — never from a local
 * calendar rendering. `new Date(ts).getHours()` would make deletion depend on the
 * host timezone and on DST: on a fall-back night local-hour bucketing merges two real
 * hours into one bucket and silently deletes an hour of history. Epoch-floor buckets
 * are monotonic, timezone-free and DST-free by construction.
 */
function bucketOf(ts, unitMs) {
  return Math.floor(ts / unitMs);
}

/** Newest-first list of the representative (newest) entry of each occupied bucket. */
function bucketRepresentatives(sortedAsc, unitMs, capacity) {
  if (!(capacity > 0)) return [];
  const newestPerBucket = new Map();          // bucket → entry (later writes win = newest)
  for (const e of sortedAsc) newestPerBucket.set(bucketOf(e.ts, unitMs), e);
  const buckets = [...newestPerBucket.keys()].sort((a, b) => b - a); // newest bucket first
  return buckets.slice(0, capacity).map((b) => newestPerBucket.get(b));
}

/**
 * Decide which snapshots to KEEP and which to PRUNE, given the snapshots and a policy.
 * Pure and total: every input appears in exactly one of the two output sets.
 *
 *   snapshots: Array<{ name, ts?, bytes?, pinned? }>  (ts defaults to snapshotTimeMs(name))
 *   policy:    { recent, hourly, daily, maxBytes }
 *   returns:   { keep: string[], prune: string[], tiers: Record<name,tier>, keptBytes }
 *
 * A snapshot is kept when it qualifies for ANY tier — recent (the newest N outright),
 * hourly (newest of each of the H most recent OCCUPIED hour buckets) or daily (likewise
 * over days) — plus unconditional keeps for pinned snapshots, unparseable names, and the
 * single greatest-timestamp snapshot.
 *
 * NOTE THE ABSENCE OF A `nowMs` PARAMETER. Tier capacity is counted over the buckets the
 * snapshots actually OCCUPY, never over a wall-clock window from the present. If capacity
 * were measured against Date.now(), a loop restarted a day later would find every surviving
 * snapshot outside the window and delete the whole history on its first tick — destroying
 * the evidence at exactly the moment it is needed. No clock, forward or backward or
 * DST-shifted, can influence a deletion here.
 *
 * Every ambiguity resolves toward KEEP: one snapshot too many costs ~900 KB, one too few is
 * the bug this exists to prevent.
 */
export function planRetention({ snapshots, policy } = {}) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const {
    recent = 10, hourly = 24, daily = 14, maxBytes = Infinity,
  } = policy || {};

  const entries = list.map((s) => {
    const e = typeof s === 'string' ? { name: s } : (s || {});
    const ts = Number.isFinite(e.ts) ? e.ts : snapshotTimeMs(e.name);
    return {
      name: e.name,
      ts: Number.isFinite(ts) ? ts : null,
      bytes: Number.isFinite(e.bytes) && e.bytes > 0 ? e.bytes : 0,
      pinned: e.pinned === true,
    };
  });

  // Anything whose timestamp we cannot determine (a hand-made folder, the STATUS.json
  // heartbeat, a partially-written export) is never a deletion candidate. We do not
  // delete what we cannot reason about.
  const unparseable = entries.filter((e) => e.ts == null);
  const dated = entries.filter((e) => e.ts != null)
    .sort((a, b) => (a.ts - b.ts) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const tiers = {};
  const mark = (e, tier) => { if (e && !tiers[e.name]) tiers[e.name] = tier; };

  for (const e of unparseable) mark(e, 'unparseable');
  // Recent tier LAST-wins for labelling priority, so assign coarsest → finest.
  for (const e of bucketRepresentatives(dated, DAY_MS, daily)) mark(e, 'daily');
  for (const e of bucketRepresentatives(dated, HOUR_MS, hourly)) mark(e, 'hourly');
  if (recent > 0) for (const e of dated.slice(-recent)) { tiers[e.name] = 'recent'; }
  for (const e of dated) if (e.pinned) mark(e, 'pinned');
  // The newest snapshot is kept unconditionally — a policy of all-zero capacities must
  // never be able to legislate the safety net out of existence.
  if (dated.length > 0) mark(dated[dated.length - 1], 'newest');

  let keepEntries = entries.filter((e) => tiers[e.name]);
  const pruneEntries = entries.filter((e) => !tiers[e.name]);

  // ── Disk cap ───────────────────────────────────────────────────────────────
  // Deeper history keeps more states, so bound the total. Eviction is oldest-first,
  // which drains the coarsest/oldest tier (daily) before hourly and recent. The newest
  // snapshot is never evictable, so the cap can never empty the safety net.
  let keptBytes = keepEntries.reduce((sum, e) => sum + e.bytes, 0);
  if (Number.isFinite(maxBytes) && keptBytes > maxBytes) {
    const newest = dated.length > 0 ? dated[dated.length - 1].name : null;
    const evictable = [
      ...keepEntries.filter((e) => e.ts != null && e.name !== newest).sort((a, b) => a.ts - b.ts),
      ...keepEntries.filter((e) => e.ts == null),   // unreasonable-about entries evict last
    ];
    const evicted = new Set();
    for (const e of evictable) {
      if (keptBytes <= maxBytes) break;
      evicted.add(e.name);
      keptBytes -= e.bytes;
      tiers[e.name] = 'evicted';
    }
    if (evicted.size > 0) {
      keepEntries = keepEntries.filter((e) => !evicted.has(e.name));
      for (const e of entries) if (evicted.has(e.name)) pruneEntries.push(e);
    }
  }

  const byTime = (a, b) => ((a.ts ?? Infinity) - (b.ts ?? Infinity)) || (a.name < b.name ? -1 : 1);
  return {
    keep: keepEntries.sort(byTime).map((e) => e.name),
    prune: pruneEntries.sort(byTime).map((e) => e.name),
    tiers,
    keptBytes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import safety (change: emulator-backup-tiered-retention)
// ─────────────────────────────────────────────────────────────────────────────

/** A candidate is usable only if it is present, carries valid export metadata, and holds data. */
function qualifies(c) {
  return Boolean(c) && c.present !== false && c.valid !== false && Number(c.bytes) > 0;
}

/** Like-for-like time for a candidate: its own metadata write time, name timestamp as fallback. */
function candidateTime(c) {
  if (Number.isFinite(c?.metaMtimeMs)) return { ms: c.metaMtimeMs, fallback: false };
  if (Number.isFinite(c?.nameMs)) return { ms: c.nameMs, fallback: true };
  return { ms: -Infinity, fallback: false };
}

/**
 * Choose which dataset to boot the emulator from — the guarded replacement for a bare
 * `primaryMs >= backupMs`.
 *
 * Three defects it closes, all implicated in the lost-game incident:
 *   1. The old comparison put the primary export's FILE MTIME against the backup's
 *      FOLDER-NAME timestamp — two different events. Both sides now use the write time
 *      of their own firebase-export-metadata.json; the name timestamp is a fallback only
 *      and is reported via `usedFallbackTime`.
 *   2. Freshness was used as a proxy for goodness with no validity/emptiness check. An
 *      absent, metadata-less or empty candidate can now never win.
 *   3. Nothing compared SUBSTANCE. On disk right now the primary export is 217 KB against
 *      a 689 KB snapshot; anything that touches the primary's mtime hands victory to a
 *      dataset a quarter the size, which then becomes the baseline every later snapshot is
 *      taken from — games and their creator identities vanishing together. The substance
 *      guard refuses that swap: when the freshest candidate is below `shrinkRatio` of the
 *      alternative, the substantial dataset wins and the caller is told, loudly.
 *
 * The harms are asymmetric: wrongly keeping the larger dataset costs one message and an
 * env var (`allowShrink`), wrongly adopting the smaller one destroys work and then
 * shreds every snapshot of it within 20 minutes.
 *
 *   candidates: { present, valid, metaMtimeMs, nameMs, bytes }
 *   returns: { source: 'primary'|'backup'|null, reason, usedFallbackTime, shrink }
 *   reason: 'none' | 'only-candidate' | 'freshest' | 'shrink-guard' | 'shrink-overridden'
 */
export function selectImportSource({ primary, backup, allowShrink = false, shrinkRatio = 0.5 } = {}) {
  const okP = qualifies(primary);
  const okB = qualifies(backup);
  if (!okP && !okB) return { source: null, reason: 'none', usedFallbackTime: false, shrink: null };
  if (okP !== okB) {
    const only = okP ? 'primary' : 'backup';
    return { source: only, reason: 'only-candidate', usedFallbackTime: candidateTime(okP ? primary : backup).fallback, shrink: null };
  }

  const tp = candidateTime(primary);
  const tb = candidateTime(backup);
  const usedFallbackTime = tp.fallback || tb.fallback;
  // Tie → primary, preserving selectFreshestImport's rule (prefer the clean export).
  const freshestKey = tp.ms >= tb.ms ? 'primary' : 'backup';
  const freshest = freshestKey === 'primary' ? primary : backup;
  const alternative = freshestKey === 'primary' ? backup : primary;
  const otherKey = freshestKey === 'primary' ? 'backup' : 'primary';

  const ratio = alternative.bytes > 0 ? freshest.bytes / alternative.bytes : Infinity;
  if (ratio < shrinkRatio) {
    const shrink = { freshestBytes: freshest.bytes, alternativeBytes: alternative.bytes, ratio };
    return allowShrink
      ? { source: freshestKey, reason: 'shrink-overridden', usedFallbackTime, shrink }
      : { source: otherKey, reason: 'shrink-guard', usedFallbackTime, shrink };
  }
  return { source: freshestKey, reason: 'freshest', usedFallbackTime, shrink: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Liveness (change: emulator-backup-tiered-retention)
// ─────────────────────────────────────────────────────────────────────────────

const HEALTH_RANK = { ok: 0, starting: 1, degraded: 2, stalled: 3 };

/** Severity ordering for health levels — higher is worse. Used to assert monotonicity. */
export function healthRank(level) {
  return HEALTH_RANK[level] ?? 3;
}

/**
 * The loop's self-assessment, from how far the interval has been overshot since the last
 * SUCCESSFUL snapshot and how many exports failed in a row. Thresholds are multiples of the
 * interval, not absolute seconds, because the interval is configurable.
 *   degraded: past 2 intervals, or ≥ 1 failure
 *   stalled:  past 5 intervals, or ≥ 3 consecutive failures
 * Monotonic in both inputs: more elapsed time or more failures never yields a healthier level.
 * `startedMs` supplies the reference point before the first success.
 */
export function assessLoopHealth({ lastSuccessMs, nowMs, intervalMs, consecutiveFailures = 0, startedMs = null } = {}) {
  const failures = Math.max(0, Number(consecutiveFailures) || 0);
  const everSucceeded = Number.isFinite(lastSuccessMs);
  const since = everSucceeded ? lastSuccessMs : (Number.isFinite(startedMs) ? startedMs : nowMs);
  const interval = Number(intervalMs) > 0 ? Number(intervalMs) : 1;
  const ratio = (Number(nowMs) - since) / interval;

  const timeSeverity = ratio > 5 ? 3 : ratio > 2 ? 2 : (everSucceeded ? 0 : 1);
  const failSeverity = failures >= 3 ? 3 : failures >= 1 ? 2 : 0;
  const severity = Math.max(timeSeverity, failSeverity);

  if (severity >= 3) return 'stalled';
  if (severity === 2) return 'degraded';
  return everSucceeded ? 'ok' : 'starting';
}

/**
 * Default minimum wall-clock gap between two identical health banners (ms). One minute
 * is the floor; the loop raises it to its own snapshot interval so, at defaults, an
 * unhealthy loop shouts at most once per missed snapshot opportunity.
 */
export const DEFAULT_HEALTH_SHOUT_GAP_MS = 60_000;

/**
 * Whether the loop should emit its loud health banner right now
 * (change: emulator-backup-tiered-retention, task 6.7).
 *
 * The banner used to fire on EVERY health assessment. That was once per snapshot
 * interval — minutes apart — until the watchdog began re-asserting health every ~5s to
 * keep the heartbeat independent of a wedged tick. At that cadence the same 6-line
 * bright-red banner prints ~720 times an hour and buries the emulator / dev-stack output
 * a person needs in order to diagnose the very incident it is warning about. A signal
 * that drowns its own context is not a signal.
 *
 * So: ASSESSING health and PERSISTING it stay on the watchdog cadence (unchanged — the
 * heartbeat and `--status` must never get coarser); only the SHOUTING is rate-limited,
 * and only in the one case where repetition adds nothing — the identical level, already
 * announced, moments ago. Everything that carries new information is exempt:
 *   - `ok`/`starting`             → never shouts at all.
 *   - no banner shown yet         → shout NOW; a suppressed first banner is a silent net.
 *   - the level CHANGED           → shout NOW. An escalation (degraded → stalled) is the
 *                                   most important thing this function can say and must
 *                                   never wait out a gap.
 *   - the clock moved BACKWARDS   → shout NOW. A negative "elapsed" must never read as
 *                                   "just shouted" and mute the banner until the clock
 *                                   catches up (potentially forever). The caller re-stamps
 *                                   `lastShoutMs` after shouting, so this self-corrects
 *                                   after exactly one banner.
 * Otherwise: stay quiet until `minGapMs` has elapsed.
 *
 * `minGapMs` of exactly 0 explicitly disables rate limiting (always shout); anything
 * non-finite or negative falls back to the default rather than to "always" or "never".
 * Pure — no clock, no I/O; `nowMs` and the last-shout state are supplied by the caller.
 */
export function shouldShoutHealth({ health, lastShoutMs, lastShoutHealth, nowMs, minGapMs } = {}) {
  if (health !== 'degraded' && health !== 'stalled') return false;   // nothing to shout about
  if (!Number.isFinite(lastShoutMs)) return true;                    // never shouted (incl. null/undefined/NaN)
  if (health !== lastShoutHealth) return true;                       // level changed — never swallow an escalation
  const gap = Number.isFinite(minGapMs) && minGapMs >= 0 ? Number(minGapMs) : DEFAULT_HEALTH_SHOUT_GAP_MS;
  const elapsed = Number(nowMs) - Number(lastShoutMs);
  if (!Number.isFinite(elapsed)) return true;                        // unusable clock → err loud
  if (elapsed < 0) return true;                                      // clock skew → shout and re-stamp
  return elapsed >= gap;
}

/**
 * The loop's full gate before spawning an export: the existing readiness + interval gate,
 * PLUS a re-entrancy refusal. `tick` is async but driven by a bare setInterval that never
 * awaits it, so without this two ticks can stack exports against one emulator — and an
 * export that never returns used to leave the loop pending forever with no signal.
 */
export function canStartExport({ inFlight, ready, lastTs, nowTs, intervalMs }) {
  if (inFlight === true) return false;
  return canAttemptExport({ ready, lastTs, nowTs, intervalMs });
}

/**
 * Bound an arbitrary readiness probe to a hard timeout so a hung/rejecting/throwing
 * probe can never block its caller forever (change: emulator-backup-liveness-watchdog).
 *
 * The incident: `tick()` awaited `isReadyNow()` with no bound at all. When the
 * emulator died mid-probe the await never settled, so everything AFTER it —
 * `reportHealth()`, `writeStatus()` — never ran either: the heartbeat froze and the
 * stalled banner never fired, while `setInterval` kept queuing new ticks that wedged
 * on the same unresolved probe. This function is the fix at its root: no matter what
 * `probe()` does (hangs forever, rejects, throws synchronously, resolves late), the
 * caller ALWAYS gets an answer within `timeoutMs` — `false` (not ready) on timeout or
 * any failure, indistinguishable from an ordinary "not ready" result so downstream
 * health/heartbeat logic can't special-case it away.
 *
 *   probe: () => Promise<boolean> | boolean   the readiness check to bound
 *   timeoutMs: number
 *   scheduleTimeout / clearScheduledTimeout: injectable timer functions (default the
 *     real ones) purely so tests can spy on clearing without depending on real timers
 *     for correctness — the bound itself always uses real elapsed time.
 */
export function probeReadyWithTimeout(probe, timeoutMs, scheduleTimeout = setTimeout, clearScheduledTimeout = clearTimeout) {
  return new Promise((resolve) => {
    let settled = false;
    // `let` + declared BEFORE scheduleTimeout on purpose. The timer functions are
    // injectable parameters, so a scheduler that fires its callback SYNCHRONOUSLY is a
    // legal input (a fake clock, a 0ms shim). With `const timer = scheduleTimeout(...)`
    // that callback would run finish(false) while `timer` was still in its temporal dead
    // zone — a ReferenceError thrown out of the Promise executor, rejecting the promise
    // and breaking the single guarantee this function exists to make: the caller always
    // gets an answer and never has to catch. Hoisting the binding makes `timer` merely
    // `undefined` at that instant, and clearing `undefined` is a harmless no-op.
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearScheduledTimeout(timer);
      resolve(value === true);
    };
    timer = scheduleTimeout(() => finish(false), timeoutMs);
    (async () => {
      try {
        return await probe();
      } catch {
        return false;
      }
    })().then(finish, () => finish(false));
  });
}

/**
 * Whether an emulator session should start its own snapshot loop.
 *
 * Backups are ON BY DEFAULT (the lost game was lost in an unprotected `dev:all` session —
 * dev-emulator only started the loop when RUSHPOINT_BACKUP was set, and dev:all never set
 * it). `optOut` is now the explicit act.
 *
 * The interlock against a duplicate loop is the published heartbeat: skip ONLY when the
 * heartbeat is recent AND its process is still alive. Everything else fails OPEN and starts
 * a loop, because an extra loop is noisy and recoverable (free-ports.mjs already reaps
 * orphans by cmdline) while no loop is silent — and silence is what caused this incident.
 */
export function shouldStartBackupLoop({ optOut, status, nowMs, pidAlive, intervalMs } = {}) {
  if (optOut === true) return false;
  if (!status || !Number.isFinite(status.updatedAt)) return true;
  const interval = Number(intervalMs) > 0 ? Number(intervalMs) : 120_000;
  const fresh = (Number(nowMs) - status.updatedAt) <= Math.max(3 * interval, 60_000);
  return !(fresh && pidAlive === true);
}

/**
 * What the supervisor loop should do after a prod build attempt, given whether the
 * functions compile-gate passed, whether the app bundles built, and whether a serveable
 * app dist already exists on disk. Pure decision — the loop maps the result to logging +
 * control flow. Four outcomes:
 *   'retry-functions' — functions did NOT compile. Launching would crash-loop
 *       dev-emulator.mjs's process.exit(1) under `--kill-others-on-fail`, so NEVER launch:
 *       skip this cycle, keep serving the previous good stack, back off, retry. This wins
 *       even when a serveable app dist exists — a crash-looping stack serves nothing.
 *   'launch-fresh'    — everything built cleanly; launch.
 *   'launch-stale'    — functions compile but the app bundles failed AND a prior good dist
 *       is on disk; serve THAT (availability first — a broken app push never blacks out the
 *       site). The caller keeps needBuild armed to retry.
 *   'retry-no-dist'   — functions compile but the apps failed and there's no dist at all
 *       yet (fresh host); retry after a backoff rather than launch vite-preview on nothing.
 */
export function decidePostBuildAction({ functionsOk, appsBuilt, distReady }) {
  if (!functionsOk) return 'retry-functions';   // guaranteed crash-loop → never launch
  if (appsBuilt) return 'launch-fresh';         // clean build of everything
  if (distReady) return 'launch-stale';         // apps failed but a prior good dist serves
  return 'retry-no-dist';                        // fresh host, nothing serveable yet
}
