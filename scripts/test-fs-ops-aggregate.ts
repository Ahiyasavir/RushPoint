// Pure-logic tests for the fsops log aggregator (change: spark-tier-location-load).
// Run by scripts/run-unit-tests.mjs via `npm test`.
//
// This is the component that turns "the emulator printed a lot of lines" into the number a
// quota decision rests on. Two failure modes matter and both are asserted here:
//
//   1. SILENT UNDER-REPORTING. A parser that quietly skips lines it does not understand
//      reports a smaller, happier number and looks identical to one that read everything.
//      That is the exact shape of the alt-text trap in CLAUDE.md — a check that examined
//      nothing prints the same "all clear" as a check that examined everything. So the
//      parser returns `unparsed`, and the count is asserted.
//   2. OVER-COUNTING from unrelated lines that merely contain the marker word.
//
// No emulator.  npx tsx scripts/test-fs-ops-aggregate.ts
import {
  parseFsOpsRecords,
  aggregateFsOps,
  formatFsOps,
  FSOPS_MARKER,
} from './lib/fsOpsAggregate.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── The happy path: structured JSON, as functions.logger emits it ────────────
{
  const log = [
    'i  functions: Beginning execution of "updateLocation"',
    '>  {"severity":"INFO","message":"fsops","callable":"updateLocation","reads":2,"writes":2}',
    '>  {"severity":"INFO","message":"fsops","callable":"updateLocation","reads":2,"writes":2}',
    '>  {"severity":"INFO","message":"fsops","callable":"completeTask","reads":5,"writes":3}',
    'i  functions: Finished "updateLocation" in 41ms',
  ].join('\n');

  const { records, unparsed } = parseFsOpsRecords(log);
  ok(records.length === 3, 'every fsops record is found');
  ok(unparsed === 0, 'nothing on those lines was left unparsed');

  const agg = aggregateFsOps(records);
  ok(agg.byCallable.updateLocation?.calls === 2, 'invocations are counted, not just ops');
  ok(agg.byCallable.updateLocation?.reads === 4, 'reads sum across invocations');
  ok(agg.byCallable.updateLocation?.writes === 4, 'writes sum across invocations');
  ok(agg.byCallable.completeTask?.calls === 1, 'a second callable is tallied separately');
  ok(agg.total.reads === 9 && agg.total.writes === 7, 'totals sum across callables');
  ok(agg.total.calls === 3, 'the total call count is the denominator for per-call figures');
}

// ── Field order must not matter ──────────────────────────────────────────────
{
  const log = '>  {"writes":7,"callable":"getGame","message":"fsops","reads":1}';
  const { records } = parseFsOpsRecords(log);
  ok(records[0]?.callable === 'getGame', 'a reordered payload still parses');
  ok(records[0]?.reads === 1 && records[0]?.writes === 7, 'reordered fields keep their meaning');
}

// ── A line mentioning the marker but carrying no record is reported, not dropped ──
{
  // The distinction that matters: this is NOT counted as a record (over-counting), and it
  // IS counted as unparsed (so the caller knows the denominator is imperfect).
  const log = [
    'i  some prose that happens to mention fsops but carries no payload',
    '>  {"severity":"INFO","message":"fsops","callable":"ok","reads":1,"writes":0}',
  ].join('\n');
  const { records, unparsed } = parseFsOpsRecords(log);
  ok(records.length === 1, 'the marker word alone does not manufacture a record');
  ok(unparsed === 1, 'the unreadable line is REPORTED rather than silently skipped');
}

// ── Lines without the marker are ignored entirely ────────────────────────────
{
  const log = [
    '>  {"severity":"INFO","message":"callStart","callable":"updateLocation","reads":9,"writes":9}',
    'i  unrelated emulator chatter',
  ].join('\n');
  const { records, unparsed } = parseFsOpsRecords(log);
  ok(records.length === 0, 'a different log message is not mistaken for a cost record');
  ok(unparsed === 0, 'and it is not counted as unparsed either — it was never a candidate');
}

// ── Empty / absent input is total, never throwing ────────────────────────────
{
  let threw = false;
  try {
    ok(parseFsOpsRecords('').records.length === 0, 'empty text yields no records');
    ok(parseFsOpsRecords(undefined as never).records.length === 0, 'undefined text yields no records');
    const agg = aggregateFsOps(undefined as never);
    ok(agg.total.calls === 0, 'aggregating nothing yields zeroes, not NaN');
    ok(typeof formatFsOps(agg) === 'string', 'formatting an empty aggregate still renders');
  } catch { threw = true; }
  ok(!threw, 'the aggregator never throws on absent input');
}

// ── Malformed numbers do not become NaN in the total ─────────────────────────
{
  const log = '>  {"message":"fsops","callable":"x","reads":"lots","writes":2}';
  const { records, unparsed } = parseFsOpsRecords(log);
  // Either it is rejected outright or parsed as a number — what it must NEVER do is
  // contribute NaN, which would poison the total and every comparison against it.
  const agg = aggregateFsOps(records);
  ok(Number.isFinite(agg.total.reads), 'a non-numeric reads value never produces NaN');
  ok(records.length + unparsed === 1, 'the line is accounted for one way or the other');
}

// ── The rendered table prints its denominator ────────────────────────────────
{
  const agg = aggregateFsOps([
    { callable: 'updateLocation', reads: 2, writes: 2 },
    { callable: 'updateLocation', reads: 2, writes: 2 },
  ]);
  const out = formatFsOps(agg);
  ok(out.includes('updateLocation'), 'the table names the callable');
  ok(out.includes('2.00r / 2.00w'), 'per-call averages are shown');
  ok(/\s2\s/.test(out), 'the call count it divided by is shown alongside');
}

ok(FSOPS_MARKER === 'fsops', 'the marker is the stable string the emitter writes');

console.log(`\nfs-ops-aggregate: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
