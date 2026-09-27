// Pure-logic tests — what the Builder should say about a save still in flight
// (change: save-tells-the-truth).
//
// THE REPORTED DEFECT. "Changes were not saved in real time when there was a
// connectivity problem. The user got no clear indication of this, and the sync only
// happened after turning cellular data on."
//
// The Firebase callable SDK's default timeout is SEVENTY SECONDS. On a dead connection
// the Builder set status 'saving', showed "שומר…" beside a pulsing dot, and then said
// nothing at all until the promise finally rejected over a minute later. For that whole
// minute it was indistinguishable from a Builder saving normally, because "saving" is
// the word for both - so the creator kept typing into something they believed was
// persisting.
//
// THE FAIL-SAFE DIRECTION IS "DO NOT CRY WOLF". This drives a status line, not a gate.
// An unusable clock, a missing timestamp or a browser that reports nothing about
// connectivity all resolve to the ordinary in-progress state. Escalating on bad
// evidence would train a creator to ignore the one message that matters.
//
// AND IT MAY NEVER GATE. CLAUDE.md is explicit that `navigator.onLine` reads false on
// working connections, so it informs and never blocks - which is why there is no
// "should we send?" answer anywhere in this module. The save always goes out.
import {
  saveHealth, SAVE_SLOW_AFTER_MS, SAVE_STALLED_AFTER_MS, type SaveHealthLevel,
} from '../apps/creator-web/src/lib/saveHealth';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}

const T0 = 1_000_000;
const at = (elapsedMs: number, online?: boolean): SaveHealthLevel => saveHealth({
  status: 'saving', startedAtMs: T0, nowMs: T0 + elapsedMs, online,
}).level;

console.log('\nsave-health — what the Builder should say');

// ── 1. A quick save looks exactly as it does today ───────────────────────────
{
  eq('a save that just started is an ordinary save', at(0), 'saving');
  eq('a save one second in is an ordinary save', at(1_000), 'saving');
  eq('a save just under the slow threshold is an ordinary save',
    at(SAVE_SLOW_AFTER_MS - 1), 'saving');
}

// ── 2. Escalation, on elapsed time, long before the SDK's 70s timeout ────────
{
  eq('at the slow threshold the Builder says it is still trying', at(SAVE_SLOW_AFTER_MS), 'slow');
  eq('past the slow threshold it is still `slow`', at(SAVE_SLOW_AFTER_MS + 1), 'slow');
  eq('just under the stalled threshold it is still `slow`', at(SAVE_STALLED_AFTER_MS - 1), 'slow');
  eq('at the stalled threshold it names the connection', at(SAVE_STALLED_AFTER_MS), 'stalled');
  eq('a minute in it is still `stalled`', at(60_000), 'stalled');

  // The whole point: the creator learns something is wrong in SECONDS, not after the
  // SDK's 70,000ms deadline.
  ok(`the stalled threshold fires far before the SDK timeout :: ${SAVE_STALLED_AFTER_MS}ms vs 70000ms`,
    SAVE_STALLED_AFTER_MS < 70_000 / 2);
  ok('the thresholds are ordered and positive',
    SAVE_SLOW_AFTER_MS > 0 && SAVE_SLOW_AFTER_MS < SAVE_STALLED_AFTER_MS);
}

// ── 3. Offline is reported AT ONCE, and outranks the elapsed clock ───────────
{
  eq('offline is reported immediately, without waiting for a threshold', at(0, false), 'offline');
  eq('offline outranks `slow`', at(SAVE_SLOW_AFTER_MS, false), 'offline');
  eq('offline outranks `stalled`', at(60_000, false), 'offline');
  eq('being online does not suppress the elapsed escalation', at(SAVE_STALLED_AFTER_MS, true), 'stalled');
  // A browser that reports NOTHING must not be assumed offline. `navigator.onLine`
  // is absent in some embedded webviews, and guessing would raise a false alarm on
  // every save.
  eq('unknown connectivity is not offline', at(0, undefined), 'saving');
}

// ── 4. Only a save in flight escalates ───────────────────────────────────────
{
  for (const status of ['saved', 'unsaved', 'failed'] as const) {
    const v = saveHealth({ status, startedAtMs: T0, nowMs: T0 + 60_000, online: false });
    eq(`status "${status}" is passed through, never escalated`, v.level, status);
  }
  // A 'saving' status with no start time cannot be timed. Ordinary, not alarming.
  eq('a save with no start time is an ordinary save',
    saveHealth({ status: 'saving', startedAtMs: null, nowMs: T0, online: true }).level, 'saving');
}

// ── 5. Do not cry wolf — every unusable clock reads as ordinary ─────────────
{
  const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null, 'x'];
  for (const v of bad) {
    eq(`an unusable startedAt (${String(v)}) reads as an ordinary save`,
      saveHealth({ status: 'saving', startedAtMs: v as number, nowMs: T0 + 60_000, online: true }).level,
      'saving');
    eq(`an unusable now (${String(v)}) reads as an ordinary save`,
      saveHealth({ status: 'saving', startedAtMs: T0, nowMs: v as number, online: true }).level,
      'saving');
  }
  // A clock that went backwards (device time change, tab resume) is not evidence
  // of a long save.
  eq('a backwards clock reads as an ordinary save',
    saveHealth({ status: 'saving', startedAtMs: T0, nowMs: T0 - 5_000, online: true }).level, 'saving');
}

// ── 6. The verdict carries the elapsed time so the copy can use it ──────────
{
  const v = saveHealth({ status: 'saving', startedAtMs: T0, nowMs: T0 + 12_345, online: true });
  eq('elapsedMs is reported', v.elapsedMs, 12_345);
  eq('and it is null when it cannot be measured',
    saveHealth({ status: 'saving', startedAtMs: null, nowMs: T0, online: true }).elapsedMs, null);
  ok('a healthy save is not flagged as needing attention',
    saveHealth({ status: 'saving', startedAtMs: T0, nowMs: T0, online: true }).needsAttention === false);
  ok('a stalled save IS flagged as needing attention',
    saveHealth({ status: 'saving', startedAtMs: T0, nowMs: T0 + 60_000, online: true }).needsAttention === true);
  ok('an offline save is flagged as needing attention', saveHealth({
    status: 'saving', startedAtMs: T0, nowMs: T0, online: false,
  }).needsAttention === true);
  ok('a FAILED save is flagged as needing attention', saveHealth({
    status: 'failed', startedAtMs: T0, nowMs: T0, online: true,
  }).needsAttention === true);
  ok('a SAVED state needs no attention', saveHealth({
    status: 'saved', startedAtMs: T0, nowMs: T0, online: true,
  }).needsAttention === false);
}

// ── 7. Totality — this renders on every keystroke's autosave ────────────────
{
  for (const b of [null, undefined, 42, 'x', [], true]) {
    let threw = false;
    let v: { level: string } | null = null;
    try { v = saveHealth(b as never); } catch { threw = true; }
    ok(`a ${String(typeof b)} input does not throw and yields a level`,
      !threw && !!v && typeof v.level === 'string' && v.level.length > 0, JSON.stringify(v));
  }
}

// ── 8. The invariant, swept ─────────────────────────────────────────────────
{
  let seed = 0x7a1c9e35;
  const rnd = (n: number): number => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed % n;
  };
  const SWEEPS = 5000;
  let violations = 0;
  const seen: Record<string, number> = {};
  for (let i = 0; i < SWEEPS; i++) {
    const elapsed = rnd(90_000);
    const online = [true, false, undefined][rnd(3)];
    const v = saveHealth({ status: 'saving', startedAtMs: T0, nowMs: T0 + elapsed, online });
    seen[v.level] = (seen[v.level] ?? 0) + 1;
    // Escalation is MONOTONIC in elapsed time: a longer wait never reports a
    // calmer state than a shorter one at the same connectivity.
    const rank: Record<string, number> = { saving: 0, slow: 1, stalled: 2, offline: 3 };
    const earlier = saveHealth({ status: 'saving', startedAtMs: T0, nowMs: T0 + Math.floor(elapsed / 2), online });
    if (rank[v.level] < rank[earlier.level]) violations++;
    // Offline always outranks everything the clock could say.
    if (online === false && v.level !== 'offline') violations++;
    // A healthy save is never flagged.
    if (v.level === 'saving' && v.needsAttention) violations++;
  }
  ok(`escalation is monotonic and offline always wins :: ${SWEEPS} sweeps`,
    violations === 0, `${violations} violation(s)`);
  ok(`the sweep reached every level :: ${JSON.stringify(seen)}`, Object.keys(seen).length === 4);
}

console.log('');
if (failures > 0) {
  console.error(`✗ save-health: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ save-health: all assertions passed');
