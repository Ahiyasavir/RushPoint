// Pure-logic tests for emulator-data-backup (timing / rotation / selection).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  isSnapshotDue,
  snapshotName,
  selectSnapshotsToPrune,
  selectRestoreTarget,
  isEmulatorReady,
  canAttemptExport,
  snapshotTimeMs,
  selectFreshestImport,
  didExportSucceed,
  decidePostBuildAction,
  probeReadyWithTimeout,
  shouldShoutHealth,
} from './lib/emulatorBackup.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── isSnapshotDue ────────────────────────────────────────────────────────────
ok(isSnapshotDue(null, 1000, 500) === true, 'never taken → due');
ok(isSnapshotDue(undefined, 1000, 500) === true, 'undefined last → due');
ok(isSnapshotDue(1000, 1400, 500) === false, 'within interval → not due');
ok(isSnapshotDue(1000, 1500, 500) === true, 'at interval → due');
ok(isSnapshotDue(1000, 5000, 500) === true, 'past interval → due');

// ── snapshotName ─────────────────────────────────────────────────────────────
const t1 = Date.UTC(2026, 5, 28, 12, 34, 56, 789);
ok(snapshotName(t1) === 'backup-2026-06-28T12-34-56-789Z', `deterministic name (got ${snapshotName(t1)})`);
// Chronological = lexicographic.
const a = snapshotName(Date.UTC(2026, 0, 1, 0, 0, 0));
const b = snapshotName(Date.UTC(2026, 0, 1, 0, 0, 1));
const c = snapshotName(Date.UTC(2026, 11, 31, 23, 59, 59));
ok(a < b && b < c, 'names sort lexicographically in time order');

// ── selectSnapshotsToPrune ───────────────────────────────────────────────────
const names = ['backup-1', 'backup-3', 'backup-2', 'backup-5', 'backup-4'];
ok(JSON.stringify(selectSnapshotsToPrune(names, 3)) === JSON.stringify(['backup-1', 'backup-2']), 'prunes oldest over the limit');
ok(selectSnapshotsToPrune(names, 5).length === 0, 'at the limit → prune none');
ok(selectSnapshotsToPrune(names, 10).length === 0, 'keepN ≥ count → prune none');
ok(selectSnapshotsToPrune(['x'], 1).length === 0, 'single under limit → none');
ok(JSON.stringify(selectSnapshotsToPrune(names, 0)) === JSON.stringify(['backup-1', 'backup-2', 'backup-3', 'backup-4', 'backup-5']), 'keepN 0 → prune all (sorted)');

// ── selectRestoreTarget ──────────────────────────────────────────────────────
ok(selectRestoreTarget([{ name: 'backup-1', valid: true }, { name: 'backup-3', valid: true }, { name: 'backup-2', valid: true }]) === 'backup-3', 'newest valid');
ok(selectRestoreTarget([{ name: 'backup-3', valid: false }, { name: 'backup-2', valid: true }, { name: 'backup-1', valid: true }]) === 'backup-2', 'skips newest-but-invalid → older valid');
ok(selectRestoreTarget([]) === null, 'empty → null');
ok(selectRestoreTarget([{ name: 'backup-1', valid: false }]) === null, 'all invalid → null');
ok(selectRestoreTarget(undefined as never) === null, 'undefined → null');

// ── isEmulatorReady ──────────────────────────────────────────────────────────
ok(isEmulatorReady(null) === false, 'null hub → not ready');
ok(isEmulatorReady(undefined as never) === false, 'undefined hub → not ready');
ok(isEmulatorReady({}) === false, 'empty hub map → not ready');
ok(isEmulatorReady({ firestore: {} }) === false, 'firestore only → not ready (functions still loading)');
ok(isEmulatorReady({ functions: {} }) === false, 'functions only → not ready');
ok(isEmulatorReady({ firestore: {}, functions: {}, auth: {} }) === true, 'firestore + functions present → ready');

// ── canAttemptExport ─────────────────────────────────────────────────────────
ok(canAttemptExport({ ready: false, lastTs: null, nowTs: 1000, intervalMs: 500 }) === false, 'not ready → no export even when due');
ok(canAttemptExport({ ready: true, lastTs: null, nowTs: 1000, intervalMs: 500 }) === true, 'ready + never snapshotted → export');
ok(canAttemptExport({ ready: true, lastTs: 1000, nowTs: 1400, intervalMs: 500 }) === false, 'ready but within interval → no export');
ok(canAttemptExport({ ready: true, lastTs: 1000, nowTs: 1500, intervalMs: 500 }) === true, 'ready + interval elapsed → export');

// ── snapshotTimeMs (inverse of snapshotName) ─────────────────────────────────
ok(snapshotTimeMs('backup-2026-06-28T12-34-56-789Z') === Date.UTC(2026, 5, 28, 12, 34, 56, 789), 'parses a snapshot name back to ms');
ok(snapshotTimeMs(snapshotName(t1)) === t1, 'round-trips snapshotName → snapshotTimeMs');
ok(Number.isNaN(snapshotTimeMs('not-a-backup')), 'garbage name → NaN');
ok(Number.isNaN(snapshotTimeMs('')), 'empty → NaN');
ok(Number.isNaN(snapshotTimeMs(undefined as never)), 'undefined → NaN');

// ── selectFreshestImport (primary export vs newest crash backup) ─────────────
ok(selectFreshestImport({ primaryMs: 2000, backupMs: 1000 }) === 'primary', 'primary newer → primary (clean/planned teardown)');
ok(selectFreshestImport({ primaryMs: 1000, backupMs: 2000 }) === 'backup', 'backup newer → backup (crash after last planned export)');
ok(selectFreshestImport({ primaryMs: 1500, backupMs: 1500 }) === 'primary', 'tie → primary (prefer the clean export)');
ok(selectFreshestImport({ primaryMs: null, backupMs: 2000 }) === 'backup', 'no primary → backup');
ok(selectFreshestImport({ primaryMs: 2000, backupMs: null }) === 'primary', 'no backup → primary');
ok(selectFreshestImport({ primaryMs: NaN, backupMs: NaN }) === null, 'neither present → null (start fresh)');
ok(selectFreshestImport({ primaryMs: null, backupMs: null }) === null, 'both null → null');

// ── didExportSucceed (mtime-based, ignores the flaky Windows exit code) ──────
ok(didExportSucceed({ beforeMtimeMs: null, afterExists: true, afterMtimeMs: 1000 }) === true, 'no prior metadata, now exists → success (first export ever)');
ok(didExportSucceed({ beforeMtimeMs: null, afterExists: false, afterMtimeMs: undefined }) === false, 'no prior metadata, still absent → failure');
ok(didExportSucceed({ beforeMtimeMs: 1000, afterExists: true, afterMtimeMs: 2000 }) === true, 'mtime advanced → success (this is the exit-code-134 case)');
ok(didExportSucceed({ beforeMtimeMs: 1000, afterExists: true, afterMtimeMs: 1000 }) === false, 'mtime unchanged → failure (stale leftover, no real write)');
ok(didExportSucceed({ beforeMtimeMs: 2000, afterExists: true, afterMtimeMs: 1000 }) === false, 'mtime went backwards (clock skew) → treated as failure, not success');
ok(didExportSucceed({ beforeMtimeMs: 1000, afterExists: false, afterMtimeMs: undefined }) === false, 'metadata vanished after attempt → failure');

// ── decidePostBuildAction (functions compile-gate vs app dist availability) ──
ok(decidePostBuildAction({ functionsOk: true, appsBuilt: true, distReady: true }) === 'launch-fresh', 'all built → launch-fresh');
ok(decidePostBuildAction({ functionsOk: true, appsBuilt: false, distReady: true }) === 'launch-stale', 'apps failed but prior dist → serve stale');
ok(decidePostBuildAction({ functionsOk: true, appsBuilt: false, distReady: false }) === 'retry-no-dist', 'apps failed, no dist (fresh host) → retry');
ok(decidePostBuildAction({ functionsOk: false, appsBuilt: false, distReady: false }) === 'retry-functions', 'functions broken, no dist → retry (never launch)');
ok(decidePostBuildAction({ functionsOk: false, appsBuilt: false, distReady: true }) === 'retry-functions', 'functions broken even WITH a serveable dist → retry (crash-loop beats availability)');
ok(decidePostBuildAction({ functionsOk: false, appsBuilt: true, distReady: true }) === 'retry-functions', 'functions broken outranks a clean app build → retry');

// ── probeReadyWithTimeout (the incident: an unbounded readiness probe froze
// tick() forever, so reportHealth()/writeStatus() — which come AFTER the probe
// await — never ran and the heartbeat went silent for hours while the loop
// stayed alive). This bounds ANY probe (hung / rejecting / throwing) to a hard
// timeout so the caller always gets an answer and can always go on to report
// health + write the heartbeat. ──────────────────────────────────────────────
function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

async function testProbeReadyWithTimeout() {
  // A probe that resolves true quickly → true, fast (no timeout hit).
  {
    const start = process.hrtime.bigint();
    const result = await probeReadyWithTimeout(async () => true, 1000);
    ok(result === true, `resolved-true probe → true (got ${result})`);
    ok(elapsedMs(start) < 500, `resolved-true probe returns promptly (took ${elapsedMs(start)}ms)`);
  }

  // A probe that resolves false quickly → false, fast.
  {
    const result = await probeReadyWithTimeout(async () => false, 1000);
    ok(result === false, `resolved-false probe → false (got ${result})`);
  }

  // THE INCIDENT: a probe that never resolves must not hang the caller — it
  // must fall through to `false` once the timeout elapses.
  {
    const start = process.hrtime.bigint();
    const neverResolves = () => new Promise<boolean>(() => {});
    const result = await probeReadyWithTimeout(neverResolves, 50);
    const took = elapsedMs(start);
    ok(result === false, `hung probe → false, not a hang (got ${result})`);
    ok(took < 1000, `hung probe bounded near the timeout, not left pending (took ${took}ms)`);
  }

  // A rejecting probe must also resolve to false, not throw.
  {
    let threw = false;
    let result: boolean | null = null;
    try {
      result = await probeReadyWithTimeout(async () => { throw new Error('probe blew up'); }, 1000);
    } catch { threw = true; }
    ok(threw === false, 'rejecting probe does not throw out of probeReadyWithTimeout');
    ok(result === false, `rejecting probe → false (got ${result})`);
  }

  // A synchronously-throwing probe (not even returning a promise) must also
  // resolve to false rather than propagating.
  {
    let threw = false;
    let result: boolean | null = null;
    try {
      result = await probeReadyWithTimeout(() => { throw new Error('sync boom'); }, 1000);
    } catch { threw = true; }
    ok(threw === false, 'sync-throwing probe does not throw out of probeReadyWithTimeout');
    ok(result === false, `sync-throwing probe → false (got ${result})`);
  }

  // The timeout timer must not keep the process alive / leak once the probe
  // itself settles first — clearScheduledTimeout is exercised via a spy.
  {
    let cleared = false;
    const fakeClear = (h: unknown) => { cleared = true; clearTimeout(h as NodeJS.Timeout); };
    await probeReadyWithTimeout(async () => true, 1000, setTimeout, fakeClear);
    ok(cleared === true, 'timeout handle is cleared once the probe settles first');
  }

  // The timer functions are part of this function's contract (they are parameters), so a
  // scheduler that fires its callback SYNCHRONOUSLY is a legal input — e.g. a fake clock,
  // or a timeoutMs of 0 under some shim. `const timer = scheduleTimeout(...)` put the
  // binding in its temporal dead zone at exactly that moment: finish(false) would touch
  // `timer` before initialization and throw a ReferenceError out of the Promise executor,
  // rejecting the promise. That is the opposite of this function's one guarantee — that
  // the caller ALWAYS gets an answer and never has to handle a throw.
  {
    let threw = false;
    let result: boolean | null = null;
    const syncScheduler = ((fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; }) as typeof setTimeout;
    try {
      result = await probeReadyWithTimeout(() => new Promise<boolean>(() => {}), 0, syncScheduler, () => {});
    } catch { threw = true; }
    ok(threw === false, 'synchronously-firing scheduler does not throw (no TDZ on the timer handle)');
    ok(result === false, `synchronously-firing scheduler → false, the ordinary not-ready answer (got ${result})`);
  }
}

// ── shouldShoutHealth (the watchdog made the banner a firehose) ──────────────
// reportHealth() shouted a 6-line red banner on EVERY assessment. That was once
// per snapshot interval (minutes) until the watchdog started re-asserting health
// every ~5s — ~720 banners an hour, which buries the emulator/dev-stack output
// the banner exists to draw attention to. The ASSESSMENT and the heartbeat must
// keep running at the watchdog cadence; only the shouting is rate-limited. An
// escalation must never be swallowed by the gap, and a clock that jumps backwards
// must never suppress the banner permanently.
const GAP = 60_000;

// Healthy → never shout, no matter the timing.
ok(shouldShoutHealth({ health: 'ok', lastShoutMs: null, lastShoutHealth: null, nowMs: 1_000_000, minGapMs: GAP }) === false, 'ok → never shouts');
ok(shouldShoutHealth({ health: 'ok', lastShoutMs: 0, lastShoutHealth: 'stalled', nowMs: 10_000_000, minGapMs: GAP }) === false, 'recovered to ok → silent even after a long gap');
ok(shouldShoutHealth({ health: 'starting', lastShoutMs: null, lastShoutHealth: null, nowMs: 1_000, minGapMs: GAP }) === false, 'starting → not a shoutable level');

// First occurrence is always immediate — a suppressed first banner is a silent net.
ok(shouldShoutHealth({ health: 'degraded', lastShoutMs: null, lastShoutHealth: null, nowMs: 1_000, minGapMs: GAP }) === true, 'first degraded (no prior shout) → shout immediately');
ok(shouldShoutHealth({ health: 'stalled', lastShoutMs: undefined, lastShoutHealth: undefined, nowMs: 1_000, minGapMs: GAP }) === true, 'undefined lastShoutMs → shout immediately');
ok(shouldShoutHealth({ health: 'stalled', lastShoutMs: NaN, lastShoutHealth: 'stalled', nowMs: 1_000, minGapMs: GAP }) === true, 'NaN lastShoutMs → shout immediately (never treated as "just shouted")');

// Within the gap at the SAME level → suppressed (this is the whole point).
ok(shouldShoutHealth({ health: 'degraded', lastShoutMs: 1_000_000, lastShoutHealth: 'degraded', nowMs: 1_005_000, minGapMs: GAP }) === false, 'same level 5s later → suppressed (watchdog cadence)');
ok(shouldShoutHealth({ health: 'stalled', lastShoutMs: 1_000_000, lastShoutHealth: 'stalled', nowMs: 1_059_999, minGapMs: GAP }) === false, 'same level just under the gap → suppressed');
ok(shouldShoutHealth({ health: 'stalled', lastShoutMs: 1_000_000, lastShoutHealth: 'stalled', nowMs: 1_060_000, minGapMs: GAP }) === true, 'same level exactly at the gap → shout');
ok(shouldShoutHealth({ health: 'stalled', lastShoutMs: 1_000_000, lastShoutHealth: 'stalled', nowMs: 1_200_000, minGapMs: GAP }) === true, 'same level past the gap → shout again (condition still holds)');

// A CHANGE of level is news — it must never wait out the gap.
ok(shouldShoutHealth({ health: 'stalled', lastShoutMs: 1_000_000, lastShoutHealth: 'degraded', nowMs: 1_000_500, minGapMs: GAP }) === true, 'degraded → stalled escalation is never swallowed by the gap');
ok(shouldShoutHealth({ health: 'degraded', lastShoutMs: 1_000_000, lastShoutHealth: 'stalled', nowMs: 1_000_500, minGapMs: GAP }) === true, 'stalled → degraded de-escalation also reported immediately');
ok(shouldShoutHealth({ health: 'degraded', lastShoutMs: 1_000_000, lastShoutHealth: 'ok', nowMs: 1_000_500, minGapMs: GAP }) === true, 'ok → degraded is a change → shout immediately');

// Clock skew: nowMs before lastShoutMs must not suppress the banner forever.
ok(shouldShoutHealth({ health: 'stalled', lastShoutMs: 5_000_000, lastShoutHealth: 'stalled', nowMs: 1_000, minGapMs: GAP }) === true, 'clock jumped backwards → shout (never permanently suppressed)');
ok(shouldShoutHealth({ health: 'degraded', lastShoutMs: 5_000_000, lastShoutHealth: 'degraded', nowMs: 4_999_999, minGapMs: GAP }) === true, 'now 1ms before last shout → shout, not suppressed');
// …and the caller re-stamps lastShoutMs, so the next tick is ordinary again.
ok(shouldShoutHealth({ health: 'stalled', lastShoutMs: 1_000, lastShoutHealth: 'stalled', nowMs: 2_000, minGapMs: GAP }) === false, 'after re-stamping post-skew, the gap applies again');

// Degenerate gaps degrade to "always shout", never to "never shout".
ok(shouldShoutHealth({ health: 'stalled', lastShoutMs: 1_000, lastShoutHealth: 'stalled', nowMs: 1_001, minGapMs: 0 }) === true, 'gap 0 → rate limiting explicitly disabled, always shouts');
ok(shouldShoutHealth({ health: 'stalled', lastShoutMs: 1_000, lastShoutHealth: 'stalled', nowMs: 10_000_000, minGapMs: NaN }) === true, 'NaN gap → default gap, long-elapsed still shouts');
ok(shouldShoutHealth({ health: 'stalled', lastShoutMs: 1_000, lastShoutHealth: 'stalled', nowMs: 2_000, minGapMs: -5 }) === false, 'negative gap → default gap (not "always"), 1s later stays suppressed');
ok(shouldShoutHealth({} as never) === false, 'no arguments → false (never shout about nothing)');
ok(shouldShoutHealth(undefined as never) === false, 'undefined arg → false, does not throw');

async function main() {
  await testProbeReadyWithTimeout();

  console.log(failed === 0
    ? `\n✅ ALL EMULATOR-BACKUP TESTS PASSED (${passed})`
    : `\n❌ ${failed} failed, ${passed} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
