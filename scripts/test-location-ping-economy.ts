// Pure-logic tests for the location ping write verdict (change: spark-tier-location-load).
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// WHY THIS FILE IS THE MOST IMPORTANT ONE IN THE CHANGE: this verdict is the ONLY
// component that can cause a participant's position to go unrecorded. Everything else in
// the change either counts things or caches things; this decides whether a real fix is
// thrown away. So the assertions are deliberately weighted toward proving it WRITES —
// a verdict that suppresses too little merely costs quota, while a verdict that suppresses
// too much loses a player on the staff map during a live game.
//
// The measured baseline it exists to fix: 3 reads + 2 writes per ping, x225 pings x120
// participants = 81,000 reads / 54,000 writes against ceilings of 50,000 / 20,000.
//
// FAIL-OPEN IS THE CONTRACT. Absent, malformed, non-finite or unparseable input must all
// resolve to *write*. This mirrors safeZone.ts and stuckGuards.ts: a total function whose
// uncertain answer is the safe one.
//
// No emulator.  npx tsx scripts/test-location-ping-economy.ts
import {
  shouldWritePin,
  shouldRetainTrackPoint,
  PIN_MIN_WRITE_INTERVAL_MS,
  PIN_JUMP_METERS,
  PIN_ACCURACY_CEILING_METERS,
  TRACK_RETENTION_METERS,
} from '../packages/shared/src/locationPingEconomy';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const BASE = { lat: 31.78, lng: 35.21 };
/** Metres of latitude, north. Longitude is left alone so the maths stays exact. */
const north = (m: number) => ({ lat: BASE.lat + m / 111_320, lng: BASE.lng });
const T0 = 1_700_000_000_000;

// ── The declared constants are the contract ──────────────────────────────────
{
  ok(PIN_MIN_WRITE_INTERVAL_MS === 60_000, 'the minimum write interval is 60s');
  ok(PIN_JUMP_METERS === 75, 'the jump override is 75m');
  ok(PIN_ACCURACY_CEILING_METERS > PIN_JUMP_METERS,
    'the accuracy ceiling exceeds the jump threshold, or the accuracy rule would be dead code');
  ok(TRACK_RETENTION_METERS === 100, 'track retention distance is 100m');
}

// ── No last fix ⇒ always write (including after a process restart) ───────────
{
  ok(shouldWritePin({ fix: { ...BASE, accuracyMeters: 10 }, lastFix: null, nowMs: T0 }).write,
    'a team with no last fix writes');
  ok(shouldWritePin({ fix: { ...BASE, accuracyMeters: 10 }, lastFix: undefined, nowMs: T0 }).write,
    'an undefined last fix writes (this is the post-restart case)');
}

// ── Inside the interval, stationary ⇒ suppressed ─────────────────────────────
{
  const lastFix = { ...BASE, atMs: T0 };
  const v = shouldWritePin({
    fix: { ...BASE, accuracyMeters: 12 },
    lastFix,
    nowMs: T0 + 20_000,      // one ping later
  });
  ok(!v.write, 'a stationary ping 20s after the last write is suppressed');

  // ...and the two pings after it, which is where the saving actually comes from.
  ok(!shouldWritePin({ fix: { ...BASE, accuracyMeters: 12 }, lastFix, nowMs: T0 + 40_000 }).write,
    'still suppressed at 40s');
  ok(!shouldWritePin({ fix: { ...BASE, accuracyMeters: 12 }, lastFix, nowMs: T0 + 59_999 }).write,
    'still suppressed at 59.999s');
}

// ── Once the interval elapses ⇒ write, even standing perfectly still ─────────
{
  const lastFix = { ...BASE, atMs: T0 };
  ok(shouldWritePin({ fix: { ...BASE, accuracyMeters: 12 }, lastFix, nowMs: T0 + 60_000 }).write,
    'a stationary ping writes once the interval has elapsed');
  ok(shouldWritePin({ fix: { ...BASE, accuracyMeters: 12 }, lastFix, nowMs: T0 + 600_000 }).write,
    'a long-stationary team still refreshes its pin');
}

// ── A significant jump writes immediately, inside the interval ───────────────
{
  const lastFix = { ...BASE, atMs: T0 };
  const v = shouldWritePin({
    fix: { ...north(200), accuracyMeters: 10 },
    lastFix,
    nowMs: T0 + 5_000,       // well inside the interval
  });
  ok(v.write, 'a 200m jump writes immediately despite the interval');

  ok(!shouldWritePin({ fix: { ...north(30), accuracyMeters: 10 }, lastFix, nowMs: T0 + 5_000 }).write,
    'a 30m move inside the interval is NOT a jump — this is what caps a walking team');
}

// ── A WALKING team is the case the interval exists for ──────────────────────
{
  // 28m per 20s ping is walking pace. Under a naive movement-only threshold this would
  // write on every single ping and save nothing; the interval is what bounds it.
  let writes = 0;
  let lastFix: { lat: number; lng: number; atMs: number } | null = null;
  for (let i = 0; i < 9; i++) {                    // 9 pings = 180s
    const fix = { ...north(28 * i), accuracyMeters: 12 };
    const nowMs = T0 + i * 20_000;
    const v = shouldWritePin({ fix, lastFix, nowMs });
    if (v.write) { writes++; lastFix = { lat: fix.lat, lng: fix.lng, atMs: nowMs }; }
  }
  // First ping (no last fix) + one per elapsed 60s window.
  ok(writes <= 4, `a walking team writes at most ~1/60s, got ${writes} over 9 pings`);
  ok(writes >= 3, `a walking team must still refresh regularly, got ${writes}`);
}

// ── Significance is judged against the fix's OWN error radius ────────────────
{
  const lastFix = { ...BASE, atMs: T0 };

  // A very fuzzy fix: 300m accuracy, capped at the ceiling. An 80m "move" is inside that
  // error and must not count as a jump.
  ok(!shouldWritePin({
    fix: { ...north(80), accuracyMeters: 300 },
    lastFix,
    nowMs: T0 + 5_000,
  }).write, 'an 80m change reported by a 300m-accuracy fix is not significant movement');

  // ...but a move beyond the CEILING is significant no matter how bad the fix claims to be.
  ok(shouldWritePin({
    fix: { ...north(PIN_ACCURACY_CEILING_METERS + 50), accuracyMeters: 5_000 },
    lastFix,
    nowMs: T0 + 5_000,
  }).write, 'a very low-confidence fix cannot suppress a move beyond the ceiling');
}

// ── Jitter from a stationary device does not defeat suppression ──────────────
{
  // The urban reality this rule exists for: a motionless phone reporting 20m accuracy
  // reports positions varying by 10-30m. A naive fixed 15m threshold would call that
  // movement and write on nearly every ping, saving nothing.
  const lastFix = { ...BASE, atMs: T0 };
  let wrote = 0;
  for (let i = 0; i < 5; i++) {
    const drift = (i % 2 === 0 ? 1 : -1) * 18;
    if (shouldWritePin({
      fix: { ...north(drift), accuracyMeters: 20 },
      lastFix,
      nowMs: T0 + (i + 1) * 5_000,
    }).write) wrote++;
  }
  ok(wrote === 0, `GPS jitter within the error radius never counts as movement, got ${wrote} writes`);
}

// ── Missing / malformed accuracy falls back to the fixed threshold ──────────
{
  const lastFix = { ...BASE, atMs: T0 };
  ok(!shouldWritePin({ fix: north(30), lastFix, nowMs: T0 + 5_000 }).write,
    'with no accuracy, a 30m move is judged against the fixed 75m threshold and suppressed');
  ok(shouldWritePin({ fix: north(200), lastFix, nowMs: T0 + 5_000 }).write,
    'with no accuracy, a 200m move still exceeds the fixed threshold');

  for (const bad of [NaN, Infinity, -5, null, 'wide' as unknown as number]) {
    const v = shouldWritePin({
      fix: { ...north(200), accuracyMeters: bad as number },
      lastFix,
      nowMs: T0 + 5_000,
    });
    ok(v.write, `a malformed accuracy (${String(bad)}) falls back to the fixed threshold, not to suppression`);
  }
}

// ── TOTALITY: every defect resolves to WRITE and never throws ────────────────
{
  const lastFix = { ...BASE, atMs: T0 };
  let threw = false;

  const cases: Array<[string, Parameters<typeof shouldWritePin>[0]]> = [
    ['non-finite incoming lat', { fix: { lat: NaN, lng: BASE.lng }, lastFix, nowMs: T0 + 1_000 }],
    ['non-finite incoming lng', { fix: { lat: BASE.lat, lng: Infinity }, lastFix, nowMs: T0 + 1_000 }],
    ['out-of-range incoming lat', { fix: { lat: 999, lng: BASE.lng }, lastFix, nowMs: T0 + 1_000 }],
    ['non-finite stored lat', { fix: BASE, lastFix: { lat: NaN, lng: BASE.lng, atMs: T0 }, nowMs: T0 + 1_000 }],
    ['non-finite stored timestamp', { fix: BASE, lastFix: { ...BASE, atMs: NaN }, nowMs: T0 + 1_000 }],
    ['stored timestamp in the future', { fix: BASE, lastFix: { ...BASE, atMs: T0 + 10_000_000 }, nowMs: T0 }],
    ['non-finite now', { fix: BASE, lastFix, nowMs: NaN }],
    ['missing fix entirely', { fix: undefined as never, lastFix, nowMs: T0 }],
    ['null options-ish input', { fix: null as never, lastFix: null, nowMs: T0 }],
  ];

  for (const [label, input] of cases) {
    try {
      const v = shouldWritePin(input);
      ok(v.write === true, `${label} ⇒ WRITE (fail open), not suppression`);
    } catch {
      threw = true;
      ok(false, `${label} threw instead of returning a verdict`);
    }
  }
  ok(!threw, 'the verdict never throws');

  // And the whole call with no argument at all.
  let bareThrew = false;
  try { shouldWritePin(undefined as never); } catch { bareThrew = true; }
  ok(!bareThrew, 'shouldWritePin tolerates a missing options object');
}

// ── A clock that goes backwards must not latch suppression forever ──────────
{
  // Phone clocks drift and NTP corrections jump. If `now` lands before the stored
  // timestamp, elapsed goes negative — which must read as "cannot tell", i.e. write.
  const v = shouldWritePin({
    fix: { ...BASE, accuracyMeters: 10 },
    lastFix: { ...BASE, atMs: T0 + 5_000 },
    nowMs: T0,
  });
  ok(v.write, 'a backwards clock resolves to write rather than suppressing indefinitely');
}

// ══ Track retention ══════════════════════════════════════════════════════════

// ── A stationary team retains nothing ───────────────────────────────────────
{
  const lastRetained = { ...BASE };
  let retained = 0;
  for (let i = 0; i < 20; i++) {
    if (shouldRetainTrackPoint({
      fix: { ...north((i % 2 === 0 ? 1 : -1) * 10), accuracyMeters: 12 },
      lastRetained,
    }).retain) retained++;
  }
  ok(retained === 0,
    `a stationary team appends no history points, got ${retained} — a movement heatmap must ` +
    'not grow a hot cell where people merely stood still');
}

// ── The first point is always retained ──────────────────────────────────────
{
  ok(shouldRetainTrackPoint({ fix: BASE, lastRetained: null }).retain,
    'with no retained point yet, the first one is kept');
  ok(shouldRetainTrackPoint({ fix: BASE, lastRetained: undefined }).retain,
    'an undefined reference point keeps the fix');
}

// ── A walking team retains at the retention distance ────────────────────────
{
  ok(!shouldRetainTrackPoint({ fix: north(50), lastRetained: BASE }).retain,
    '50m is below the retention distance');
  ok(shouldRetainTrackPoint({ fix: north(150), lastRetained: BASE }).retain,
    '150m exceeds the retention distance and is kept');
}

// ── Retention over a real walk: ~1 point per 100m, not per ping ─────────────
{
  // 4km of walking at 28m/ping = ~143 pings. At 100m retention that is ~40 points.
  let retained = 0;
  let ref: { lat: number; lng: number } | null = null;
  for (let i = 0; i < 143; i++) {
    const fix = north(28 * i);
    if (shouldRetainTrackPoint({ fix, lastRetained: ref }).retain) { retained++; ref = fix; }
  }
  ok(retained >= 35 && retained <= 45,
    `~4km of walking retains ~40 points, got ${retained} (was 143 — one per ping)`);
}

// ── Track retention is total too ────────────────────────────────────────────
{
  let threw = false;
  try {
    ok(shouldRetainTrackPoint({ fix: { lat: NaN, lng: 0 }, lastRetained: BASE }).retain,
      'a malformed fix retains rather than silently dropping history');
    ok(shouldRetainTrackPoint({ fix: BASE, lastRetained: { lat: NaN, lng: 0 } }).retain,
      'a malformed reference point retains');
    shouldRetainTrackPoint(undefined as never);
  } catch { threw = true; }
  ok(!threw, 'shouldRetainTrackPoint never throws');
}

console.log(`\nlocation-ping-economy: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
