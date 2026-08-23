// Pure-logic tests for emulator-backup-tiered-retention:
//   planRetention          — tiered (grandfather-father-son) keep/prune + disk cap
//   selectImportSource     — guarded dataset choice (like-for-like time + substance guard)
//   assessLoopHealth       — ok / degraded / stalled self-assessment
//   canStartExport         — re-entrancy gate
//   shouldStartBackupLoop  — backups-on-by-default + single-instance interlock
//
// SYNTHETIC FIXTURES ONLY. This file never reads or writes .firebase/backups/ (or any
// real snapshot directory) — the prune rule under test deletes data, so it is never
// pointed at data anyone needs.
//
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  planRetention,
  selectImportSource,
  assessLoopHealth,
  healthRank,
  canStartExport,
  shouldStartBackupLoop,
  snapshotName,
} from './lib/emulatorBackup.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const HOUR = 3_600_000;
const DAY = 86_400_000;
const MIN = 60_000;
const BASE = Date.UTC(2026, 6, 22, 18, 0, 0, 0);
const KB = 1024;
const SNAP = 900 * KB; // a real snapshot today is ~900 KB

type Snap = { name: string; ts?: number; bytes?: number; pinned?: boolean };
const snap = (ts: number, extra: Partial<Snap> = {}): Snap =>
  ({ name: snapshotName(ts), ts, bytes: SNAP, ...extra });

const POLICY = { recent: 10, hourly: 24, daily: 14, maxBytes: Infinity };
const pol = (over: Record<string, number> = {}) => ({ ...POLICY, ...over });

// ── Invariants asserted on EVERY planRetention call ──────────────────────────
// The whole correctness risk of this change is that a prune rule deletes the backup
// you needed, so these three run on every single case rather than as separate tests.
function plan(input: Snap[], policy = POLICY, label = '') {
  const res = planRetention({ snapshots: input, policy });
  const names = input.map((s) => s.name);
  const union = [...res.keep, ...res.prune].sort();
  ok(eq(union, [...names].sort()), `[${label}] keep ∪ prune === input`);
  ok(res.keep.every((n: string) => !res.prune.includes(n)), `[${label}] keep ∩ prune === ∅`);
  const parseable = input.filter((s) => Number.isFinite(s.ts));
  if (parseable.length > 0) {
    const newest = parseable.reduce((a, b) => ((a.ts as number) >= (b.ts as number) ? a : b));
    ok(!res.prune.includes(newest.name), `[${label}] newest snapshot is never pruned`);
  }
  return res;
}

// ── planRetention: degenerate inputs ─────────────────────────────────────────
{
  const r = plan([], POLICY, 'empty');
  ok(r.keep.length === 0 && r.prune.length === 0, 'empty list → keep [] prune []');
}
{
  const one = [snap(BASE)];
  const r = plan(one, POLICY, 'single');
  ok(r.keep.length === 1 && r.prune.length === 0, 'single snapshot → kept');
}
{
  // Every tier capacity zero: the newest must STILL survive. A policy can never
  // legislate the safety net out of existence.
  const one = [snap(BASE - 400 * DAY)];
  const r = plan(one, pol({ recent: 0, hourly: 0, daily: 0 }), 'single/zero-caps');
  ok(r.prune.length === 0, 'single + all capacities zero → still kept');
}

// ── planRetention: recent tier off-by-one ────────────────────────────────────
// 15 snapshots two minutes apart, all inside one hour. recent=10 keeps the newest 10;
// the hourly tier additionally keeps that hour's newest (already in recent), and the
// daily tier that day's newest (likewise) — so exactly 5 are pruned.
{
  const fine = Array.from({ length: 15 }, (_, i) => snap(BASE + i * 2 * MIN));
  const r = plan(fine, pol({ recent: 10, hourly: 24, daily: 14 }), 'recent=10');
  ok(r.keep.length === 10, `recent tier keeps exactly 10 (got ${r.keep.length})`);
  ok(r.prune.length === 5, `recent tier prunes exactly 5 (got ${r.prune.length})`);
  ok(eq(r.prune, fine.slice(0, 5).map((s) => s.name)), 'the 5 pruned are the oldest 5');

  const atLimit = plan(fine.slice(0, 10), pol({ recent: 10 }), 'recent=exactly');
  ok(atLimit.prune.length === 0, 'exactly `recent` snapshots → prune none');

  const under = plan(fine.slice(0, 9), pol({ recent: 10 }), 'recent-1');
  ok(under.prune.length === 0, 'recent-1 snapshots → prune none');

  const over = plan(fine.slice(0, 11), pol({ recent: 10 }), 'recent+1');
  ok(over.prune.length === 1 && over.prune[0] === fine[0].name, 'recent+1 → prunes exactly the oldest one');
}

// ── planRetention: hourly tier ───────────────────────────────────────────────
// Six hours × three snapshots per hour, recent=2 so the hourly tier is what does the work.
{
  const many: Snap[] = [];
  for (let h = 0; h < 6; h++) for (let k = 0; k < 3; k++) many.push(snap(BASE + h * HOUR + k * 10 * MIN));
  const r = plan(many, pol({ recent: 2, hourly: 24, daily: 14 }), 'hourly');
  // Newest of each of the 6 hour buckets, plus the 2 recent (both already the newest hour's).
  for (let h = 0; h < 6; h++) {
    const newestOfHour = snapshotName(BASE + h * HOUR + 20 * MIN);
    ok(r.keep.includes(newestOfHour), `hourly tier keeps the NEWEST of hour ${h}`);
  }
  ok(!r.keep.includes(snapshotName(BASE + 0 * HOUR + 0 * MIN)), 'hourly tier does not keep the oldest of a bucket');
  ok(r.keep.length === 7, `6 hour representatives + 1 extra recent (got ${r.keep.length})`);
}
{
  // Capacity: only the H most recent OCCUPIED hour buckets are represented.
  const many: Snap[] = [];
  for (let h = 0; h < 6; h++) many.push(snap(BASE + h * HOUR));
  const r = plan(many, pol({ recent: 1, hourly: 3, daily: 0 }), 'hourly-capacity');
  ok(r.keep.length === 3, `hourly=3 over 6 hours → 3 kept (got ${r.keep.length})`);
  ok(r.keep.includes(snapshotName(BASE + 5 * HOUR)), 'the most recent hour is kept');
  ok(!r.keep.includes(snapshotName(BASE + 0 * HOUR)), 'the 6th-oldest hour is dropped');
}

// ── planRetention: daily tier ────────────────────────────────────────────────
{
  const days: Snap[] = [];
  for (let d = 0; d < 5; d++) { days.push(snap(BASE - d * DAY)); days.push(snap(BASE - d * DAY + 15 * MIN)); }
  const r = plan(days, pol({ recent: 1, hourly: 0, daily: 14 }), 'daily');
  for (let d = 0; d < 5; d++) {
    ok(r.keep.includes(snapshotName(BASE - d * DAY + 15 * MIN)), `daily tier keeps the NEWEST of day -${d}`);
  }
  ok(r.prune.length === 5, `one representative per day → 5 pruned (got ${r.prune.length})`);
}

// ── planRetention: THE INCIDENT — an earlier session must stay recoverable ───
{
  // A game authored 5 hours ago, then a burst of recent activity. Under the old flat
  // keep-10 policy every trace of the earlier session is gone; here it must survive.
  const old = Array.from({ length: 6 }, (_, i) => snap(BASE - 5 * HOUR + i * 2 * MIN));
  const now = Array.from({ length: 12 }, (_, i) => snap(BASE + i * 2 * MIN));
  const r = plan([...old, ...now], POLICY, 'earlier-session');
  ok(old.some((s) => r.keep.includes(s.name)), 'a snapshot from the 5-hours-ago session is still recoverable');
}

// ── planRetention: boundaries, ordering, clocks ──────────────────────────────
{
  const H = Math.ceil(BASE / HOUR) * HOUR;     // an exact hour boundary
  const before = snap(H - 1);
  const at = snap(H);
  const after = snap(H + 1);
  const r = plan([before, at, after], pol({ recent: 1, hourly: 24, daily: 0 }), 'hour-boundary');
  // `at` and `after` share the bucket starting at H; `before` is the previous bucket.
  ok(r.keep.includes(before.name), 'ts exactly one ms before the boundary is in the PREVIOUS bucket and kept');
  ok(r.keep.includes(after.name), 'newest of the boundary bucket is kept');
  ok(r.prune.includes(at.name), 'the exact-boundary snapshot shares the later bucket and loses to its newer sibling');
}
{
  const D = Math.ceil(BASE / DAY) * DAY;
  const r = plan([snap(D - 1), snap(D), snap(D + 1)], pol({ recent: 1, hourly: 0, daily: 24 }), 'day-boundary');
  ok(r.keep.includes(snapshotName(D - 1)), 'day boundary: the ms before belongs to the previous day bucket');
  ok(r.keep.length === 2, `day boundary: 2 day buckets → 2 kept (got ${r.keep.length})`);
}
{
  // Order independence: the same set, shuffled, must produce the same decision.
  const set: Snap[] = [];
  for (let h = 0; h < 8; h++) for (let k = 0; k < 2; k++) set.push(snap(BASE + h * HOUR + k * 20 * MIN));
  const sorted = plan(set, pol({ recent: 3, hourly: 4, daily: 2 }), 'ordered');
  const shuffled = [...set].reverse();
  shuffled.push(...shuffled.splice(0, 3));
  const out = plan(shuffled, pol({ recent: 3, hourly: 4, daily: 2 }), 'shuffled');
  ok(eq([...sorted.keep].sort(), [...out.keep].sort()), 'shuffled input → identical keep set');
  ok(eq([...sorted.prune].sort(), [...out.prune].sort()), 'shuffled input → identical prune set');
}
{
  // Clock went backwards: a snapshot arrives carrying an EARLIER timestamp than one
  // already on disk. It must be ordered by its own timestamp, and the greatest
  // timestamp must still be the protected one.
  const forward = Array.from({ length: 4 }, (_, i) => snap(BASE + i * 2 * MIN));
  const backwards = snap(BASE - 30 * MIN);
  const r = plan([...forward, backwards], pol({ recent: 2, hourly: 1, daily: 1 }), 'clock-backwards');
  ok(!r.prune.includes(forward[3].name), 'greatest timestamp still protected after a backwards jump');
  ok(r.keep.includes(forward[3].name), 'the true newest is kept, not the last-arrived');
}
{
  // DST: buckets are epoch-derived, so the two local 01:30s of a fall-back night are
  // different instants in different buckets and neither can swallow the other.
  const dstFallBack = Date.UTC(2026, 9, 25, 0, 30, 0); // Europe fall-back night, UTC
  const first = snap(dstFallBack);
  const second = snap(dstFallBack + HOUR); // the "same" local time, one hour later
  const r = plan([first, second], pol({ recent: 0, hourly: 24, daily: 0 }), 'dst');
  ok(r.keep.includes(first.name) && r.keep.includes(second.name), 'DST repeated local hour → two distinct buckets, both kept');
}
{
  // A very long gap with NO snapshots must not age anything out. If capacity were
  // measured from `now`, a loop restarted a day later would delete the entire history
  // on its first tick — destroying the evidence exactly when it is needed.
  const oldSession = Array.from({ length: 3 }, (_, i) => snap(BASE - 9 * DAY + i * HOUR));
  const resumed = [snap(BASE)];
  const r = plan([...oldSession, ...resumed], POLICY, 'long-gap');
  ok(r.prune.length === 0, `9-day gap → nothing pruned for age alone (pruned ${r.prune.length})`);
}

// ── planRetention: things we cannot reason about are never deleted ───────────
{
  const junk = { name: 'backup-not-a-timestamp', bytes: SNAP };
  const r = plan([junk, ...Array.from({ length: 12 }, (_, i) => snap(BASE + i * 2 * MIN))], pol({ recent: 1, hourly: 1, daily: 1 }), 'unparseable');
  ok(r.keep.includes(junk.name), 'unparseable snapshot name → always kept, never pruned');
}
{
  // The liveness status file lives in the same directory. It must never be a candidate.
  const status = { name: 'STATUS.json', bytes: 512 };
  const r = plan([status, ...Array.from({ length: 12 }, (_, i) => snap(BASE + i * 2 * MIN))], pol({ recent: 1, hourly: 1, daily: 1 }), 'status-file');
  ok(!r.prune.includes('STATUS.json'), 'a STATUS.json-like entry is never pruned');
}
{
  // Pinned = deliberately captured before a destructive operation. Tier-exempt.
  const pinned = snap(BASE - 200 * DAY, { pinned: true });
  const r = plan([pinned, ...Array.from({ length: 12 }, (_, i) => snap(BASE + i * 2 * MIN))], pol({ recent: 1, hourly: 1, daily: 1 }), 'pinned');
  ok(r.keep.includes(pinned.name), 'pinned snapshot survives tier pruning however old');
}

// ── planRetention: disk cap ──────────────────────────────────────────────────
{
  const set = Array.from({ length: 10 }, (_, i) => snap(BASE + i * HOUR));
  const under = plan(set, pol({ recent: 10, maxBytes: 10 * SNAP }), 'cap-under');
  ok(under.prune.length === 0, 'total under the cap → nothing evicted');

  const exact = plan(set, pol({ recent: 10, maxBytes: 10 * SNAP }), 'cap-exact');
  ok(exact.prune.length === 0, 'total exactly at the cap → nothing evicted');

  const over = plan(set, pol({ recent: 10, maxBytes: 4 * SNAP }), 'cap-over');
  ok(over.keep.length === 4, `cap of 4 snapshots → 4 kept (got ${over.keep.length})`);
  ok(eq(over.prune, set.slice(0, 6).map((s) => s.name)), 'cap evicts OLDEST first');
  ok(over.keptBytes <= 4 * SNAP, 'retained total fits the cap');

  const tiny = plan(set, pol({ recent: 10, maxBytes: 1 }), 'cap-tiny');
  ok(tiny.keep.length === 1, `cap below one snapshot → exactly 1 kept (got ${tiny.keep.length})`);
  ok(tiny.keep[0] === set[9].name, 'the survivor of an absurd cap is the NEWEST snapshot');
}
{
  // Pinned snapshots are tier-exempt but NOT cap-exempt — the disk must never fill.
  const set = [snap(BASE - 5 * DAY, { pinned: true }), ...Array.from({ length: 4 }, (_, i) => snap(BASE + i * HOUR))];
  const r = plan(set, pol({ recent: 10, maxBytes: 2 * SNAP }), 'cap-vs-pinned');
  ok(r.prune.includes(set[0].name), 'the disk cap can evict even a pinned snapshot');
}

// ── selectImportSource — the dataset-swap guard ──────────────────────────────
const cand = (over: Record<string, unknown> = {}) =>
  ({ present: true, valid: true, metaMtimeMs: BASE, nameMs: BASE, bytes: SNAP, ...over });

{
  const r = selectImportSource({ primary: cand({ metaMtimeMs: BASE + 1000 }), backup: cand() });
  ok(r.source === 'primary' && r.reason === 'freshest', 'ordinary case: freshest wins');
}
{
  const r = selectImportSource({ primary: cand(), backup: cand({ metaMtimeMs: BASE + 1000 }) });
  ok(r.source === 'backup' && r.reason === 'freshest', 'backup fresher → backup wins (crash after last planned export)');
}
{
  const r = selectImportSource({ primary: cand({ metaMtimeMs: BASE + 5000, valid: false }), backup: cand() });
  ok(r.source === 'backup', 'fresher but INVALID candidate never wins');
}
{
  const r = selectImportSource({ primary: cand({ metaMtimeMs: BASE + 5000, bytes: 0 }), backup: cand() });
  ok(r.source === 'backup', 'fresher but EMPTY candidate never wins');
}
{
  const r = selectImportSource({ primary: cand({ present: false }), backup: cand({ valid: false }) });
  ok(r.source === null && r.reason === 'none', 'no usable candidate → import nothing, start fresh');
}
{
  const r = selectImportSource({ primary: cand({ metaMtimeMs: BASE - 99 * DAY }), backup: cand({ present: false }) });
  ok(r.source === 'primary' && r.reason === 'only-candidate', 'single candidate wins however old');
  ok(r.shrink === null, 'substance guard cannot engage without an alternative');
}
{
  // THE INCIDENT, with the real on-disk numbers: a 217 KB primary export dated
  // 2026-07-09 versus a 689 KB snapshot. Make the primary look freshest — the old
  // `>` comparison would adopt it and every snapshot would be rewritten from a
  // dataset a quarter the size within 20 minutes.
  const r = selectImportSource({
    primary: cand({ metaMtimeMs: BASE + 60_000, bytes: 217 * KB }),
    backup: cand({ metaMtimeMs: BASE, bytes: 689 * KB }),
  });
  ok(r.source === 'backup', 'substance guard: a drastically smaller fresh dataset does NOT replace a substantial one');
  ok(r.reason === 'shrink-guard', `guard reports itself (reason=${r.reason})`);
  ok(r.shrink && r.shrink.freshestBytes === 217 * KB && r.shrink.alternativeBytes === 689 * KB,
    'guard names both sizes so the human sees what was nearly lost');
}
{
  const r = selectImportSource({
    primary: cand({ metaMtimeMs: BASE + 60_000, bytes: 217 * KB }),
    backup: cand({ metaMtimeMs: BASE, bytes: 689 * KB }),
    allowShrink: true,
  });
  ok(r.source === 'primary' && r.reason === 'shrink-overridden', 'explicit override honours a real, intended shrink');
}
{
  const r = selectImportSource({
    primary: cand({ metaMtimeMs: BASE + 1000, bytes: 800 * KB }),
    backup: cand({ bytes: 900 * KB }),
  });
  ok(r.source === 'primary' && r.reason === 'freshest' && r.shrink === null, 'comparable sizes → guard stays out of the way');
}
{
  // Like-for-like: with no metadata mtime the folder-name timestamp is a FALLBACK and
  // the decision says so, rather than silently comparing two different events.
  const r = selectImportSource({
    primary: cand({ metaMtimeMs: NaN, nameMs: BASE + 5000 }),
    backup: cand({ metaMtimeMs: BASE }),
  });
  ok(r.source === 'primary', 'fallback timestamp still yields a decision');
  ok(r.usedFallbackTime === true, 'the decision reports that a fallback timestamp was used');
}
{
  const r = selectImportSource({ primary: cand(), backup: cand() });
  ok(r.source === 'primary', 'exact tie → primary (unchanged from selectFreshestImport)');
}

// ── assessLoopHealth ─────────────────────────────────────────────────────────
const INT = 2 * MIN;
const health = (over: Record<string, unknown> = {}) =>
  assessLoopHealth({ lastSuccessMs: BASE, nowMs: BASE + INT, intervalMs: INT, consecutiveFailures: 0, startedMs: BASE, ...over });

ok(health() === 'ok', 'fresh success, no failures → ok');
ok(health({ nowMs: BASE + 2 * INT }) === 'ok', 'exactly 2 intervals → still ok (boundary)');
ok(health({ nowMs: BASE + 2 * INT + 1 }) === 'degraded', 'just past 2 intervals → degraded');
ok(health({ nowMs: BASE + 5 * INT }) === 'degraded', 'exactly 5 intervals → degraded (boundary)');
ok(health({ nowMs: BASE + 5 * INT + 1 }) === 'stalled', 'just past 5 intervals → stalled');
ok(health({ nowMs: BASE + 60 * INT }) === 'stalled', 'the observed incident: 16+ min with no snapshot → stalled');
ok(health({ consecutiveFailures: 1 }) === 'degraded', 'one export failure → degraded even with a fresh success');
ok(health({ consecutiveFailures: 3 }) === 'stalled', 'three consecutive failures → stalled even with a fresh success');
ok(health({ lastSuccessMs: null, nowMs: BASE + INT }) === 'starting', 'never succeeded, just started → starting');
ok(health({ lastSuccessMs: null, nowMs: BASE + 3 * INT }) === 'degraded', 'never succeeded, overshooting → degraded');
ok(health({ lastSuccessMs: null, nowMs: BASE + 9 * INT }) === 'stalled', 'never succeeded, long overshoot → stalled');
{
  // Monotonicity: worse inputs must never yield a healthier level.
  let bad = true;
  let prev = -1;
  for (let k = 0; k <= 20; k++) {
    const rank = healthRank(assessLoopHealth({ lastSuccessMs: BASE, nowMs: BASE + k * INT, intervalMs: INT, consecutiveFailures: 0, startedMs: BASE }));
    if (rank < prev) bad = false;
    prev = rank;
  }
  ok(bad, 'health never improves as time since last success grows');
  let bad2 = true;
  prev = -1;
  for (let f = 0; f <= 8; f++) {
    const rank = healthRank(assessLoopHealth({ lastSuccessMs: BASE, nowMs: BASE + INT, intervalMs: INT, consecutiveFailures: f, startedMs: BASE }));
    if (rank < prev) bad2 = false;
    prev = rank;
  }
  ok(bad2, 'health never improves as consecutive failures grow');
}

// ── canStartExport — re-entrancy ─────────────────────────────────────────────
ok(canStartExport({ inFlight: false, ready: true, lastTs: null, nowTs: BASE, intervalMs: INT }) === true, 'idle + ready + due → export');
ok(canStartExport({ inFlight: true, ready: true, lastTs: null, nowTs: BASE, intervalMs: INT }) === false, 'an export already in flight → refuse (no overlapping ticks)');
ok(canStartExport({ inFlight: false, ready: false, lastTs: null, nowTs: BASE, intervalMs: INT }) === false, 'not ready → refuse (readiness gate preserved)');
ok(canStartExport({ inFlight: false, ready: true, lastTs: BASE, nowTs: BASE + 1, intervalMs: INT }) === false, 'not due → refuse');

// ── shouldStartBackupLoop — on by default, single instance ───────────────────
const hb = (over: Record<string, unknown> = {}) => ({ pid: 4242, updatedAt: BASE, ...over });

ok(shouldStartBackupLoop({ optOut: false, status: null, nowMs: BASE, pidAlive: false, intervalMs: INT }) === true,
  'no heartbeat at all → start the loop (dev:all is protected by default)');
ok(shouldStartBackupLoop({ optOut: true, status: null, nowMs: BASE, pidAlive: false, intervalMs: INT }) === false,
  'explicit opt-out → no loop');
ok(shouldStartBackupLoop({ optOut: false, status: hb(), nowMs: BASE + INT, pidAlive: true, intervalMs: INT }) === false,
  'recent heartbeat + live pid → do NOT start a second loop (playtest already runs one)');
ok(shouldStartBackupLoop({ optOut: false, status: hb(), nowMs: BASE + 99 * INT, pidAlive: true, intervalMs: INT }) === true,
  'stale heartbeat → start a loop even though the pid is alive (this is the wedged-loop case)');
ok(shouldStartBackupLoop({ optOut: false, status: hb(), nowMs: BASE + INT, pidAlive: false, intervalMs: INT }) === true,
  'recent heartbeat but dead pid (orphan left behind) → start a loop');
ok(shouldStartBackupLoop({ optOut: false, status: hb({ updatedAt: NaN }), nowMs: BASE, pidAlive: true, intervalMs: INT }) === true,
  'unreadable heartbeat → fail OPEN and start a loop (an extra loop is noisy, no loop is silent)');

console.log(failed === 0
  ? `\n✅ ALL EMULATOR-RETENTION TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
