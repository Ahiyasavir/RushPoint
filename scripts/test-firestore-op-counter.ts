// Pure-logic tests for Firestore operation counting + the per-run quota projection
// (change: spark-tier-location-load). Run by scripts/run-unit-tests.mjs via `npm test`.
//
// WHY THIS EXISTS: `updateLocation` costs 2 writes + 2 reads on EVERY ping, and the
// participant app pings every 20s per controller device. At 120 participants over 75
// minutes that is ~54,000 writes and ~54,000 reads from location alone, against Spark
// ceilings of 20,000 writes and 50,000 reads per day. Before changing that, the cost has
// to become a measured number rather than an estimate — otherwise "we fixed it" is a
// claim nobody can check, and a future regression that reintroduces per-ping load is
// invisible until a live run dies mid-play (which is exactly what happened on 2026-08-26).
//
// THE ASSERTION THAT MATTERS MOST is attribution under CONCURRENCY. A naive
// "current callable" global reads correctly in a single-threaded test and is silently
// wrong the moment two callables interleave across an await — which is the only condition
// under which the number is worth having. AsyncLocalStorage is what makes it correct, so
// the interleaving test below is the one that would catch a regression to a global.
//
// SECOND: the counter is instrumentation on the hottest path in the backend. It must be
// inert when disabled and it must never be able to fail a Firestore call. A measurement
// tool that can take down a live run is worse than no measurement at all.
//
// No emulator.  npx tsx scripts/test-firestore-op-counter.ts
import {
  createOpTally,
  projectRunCost,
  SPARK_DAILY_QUOTA,
} from '../packages/shared/src/firestoreOpBudget';
import { createOpCounter } from '../functions/src/opCounter';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

/** Yield to the macrotask queue so two "callables" genuinely interleave. */
const tick = () => new Promise((r) => setTimeout(r, 0));

// This lane compiles to CJS, so top-level await is unavailable — the async assertions
// live in main() and the file ends by awaiting it.
async function main(): Promise<void> {

// ── The tally: reads and writes are separate, never a combined op count ───────
{
  const tally = createOpTally();
  tally.record('updateLocation', 'read', 1);
  tally.record('updateLocation', 'write', 2);
  tally.record('completeTask', 'read', 5);

  const snap = tally.snapshot();
  ok(snap.byCallable.updateLocation?.reads === 1, 'reads are tallied per callable');
  ok(snap.byCallable.updateLocation?.writes === 2, 'writes are tallied per callable');
  ok(snap.byCallable.completeTask?.reads === 5, 'a second callable tallies independently');
  ok(snap.byCallable.completeTask?.writes === 0, 'a callable with no writes reports 0, not absent');

  // Reported separately is the whole point: a combined "operations" number hides which
  // ceiling is the binding one, and reads and writes have DIFFERENT daily ceilings.
  ok(snap.total.reads === 6, 'total reads sum across callables');
  ok(snap.total.writes === 2, 'total writes sum across callables');
  ok(!('operations' in (snap.total as object)), 'reads and writes are never merged into one figure');
}

// ── An unattributed op is still counted, and visibly so ───────────────────────
{
  // Work outside any callable (a trigger, a schedule, boot code) must not vanish from the
  // total — an op that is hard to attribute still spends quota.
  const tally = createOpTally();
  tally.record(undefined, 'read', 3);
  const snap = tally.snapshot();
  ok(snap.total.reads === 3, 'an unattributed read still reaches the total');
  ok(
    Object.keys(snap.byCallable).length === 1 && !('undefined' in snap.byCallable),
    'unattributed work gets a real bucket name, not the string "undefined"',
  );
}

// ── Attribution under CONCURRENT interleaving (the one a global would fail) ───
{
  const counter = createOpCounter({ enabled: true });

  // Two callables, deliberately interleaved across awaits. If attribution rode a mutable
  // module-level "current callable", B's assignment would clobber A's before A resumed and
  // every op after the first await would be charged to the wrong callable.
  const a = counter.run('updateLocation', async () => {
    counter.count('read', 1);
    await tick();
    counter.count('write', 1);   // must STILL be updateLocation after the await
    await tick();
    counter.count('write', 1);
  });
  const b = counter.run('completeTask', async () => {
    await tick();
    counter.count('read', 10);
    await tick();
    counter.count('read', 10);
  });
  await Promise.all([a, b]);

  const snap = counter.snapshot();
  ok(snap.byCallable.updateLocation?.reads === 1, 'interleaved: updateLocation keeps its read');
  ok(snap.byCallable.updateLocation?.writes === 2, 'interleaved: writes after an await stay with their callable');
  ok(snap.byCallable.completeTask?.reads === 20, 'interleaved: the other callable keeps its own reads');
  ok(snap.byCallable.completeTask?.writes === 0, 'interleaved: no cross-contamination of writes');
  ok(snap.total.reads === 21 && snap.total.writes === 2, 'interleaved totals are exact');
}

// ── Nested context: an inner callable does not leak into the outer one ────────
{
  const counter = createOpCounter({ enabled: true });
  await counter.run('outer', async () => {
    counter.count('read', 1);
    await counter.run('inner', async () => {
      await tick();
      counter.count('read', 1);
    });
    counter.count('read', 1);     // back in `outer`
  });
  const snap = counter.snapshot();
  ok(snap.byCallable.outer?.reads === 2, 'the outer context resumes after a nested run');
  ok(snap.byCallable.inner?.reads === 1, 'the nested context is charged separately');
}

// ── Per-INVOCATION counts, so a multi-process runtime can still be measured ──
{
  // The process-global tally is unreadable under the Functions emulator, which runs a
  // RuntimeWorkerPool (several Node processes): work done by one worker never reaches
  // another worker's tally, and a callable asked for "the totals" answers from whichever
  // worker happened to serve it. Per-invocation counts sidestep the whole problem — each
  // invocation reports its OWN cost, and the aggregation happens offline from the logs.
  const counter = createOpCounter({ enabled: true });

  let seen: { reads: number; writes: number } | undefined;
  await counter.run('updateLocation', async () => {
    counter.count('read', 2);
    await tick();
    counter.count('write', 3);
    seen = counter.invocationCounts();
  });
  ok(seen?.reads === 2 && seen?.writes === 3, 'the invocation reports its own reads and writes');

  // A second invocation must start from zero, not inherit the first one's numbers.
  let second: { reads: number; writes: number } | undefined;
  await counter.run('updateLocation', async () => {
    counter.count('read', 1);
    second = counter.invocationCounts();
  });
  ok(second?.reads === 1 && second?.writes === 0, 'each invocation starts its own counts at zero');

  // ...while the process tally still accumulates across both.
  const snap = counter.snapshot();
  ok(snap.byCallable.updateLocation?.reads === 3, 'the process tally still sums across invocations');
  ok(snap.byCallable.updateLocation?.writes === 3, 'the process tally sums writes too');

  ok(counter.invocationCounts() === undefined, 'outside an invocation there are no invocation counts');
}

// ── Concurrent invocations do not pool their per-invocation counts ────────────
{
  const counter = createOpCounter({ enabled: true });
  let a: { reads: number } | undefined;
  let b: { reads: number } | undefined;
  await Promise.all([
    counter.run('a', async () => {
      counter.count('read', 1);
      await tick();
      counter.count('read', 1);
      a = counter.invocationCounts();
    }),
    counter.run('b', async () => {
      await tick();
      counter.count('read', 50);
      b = counter.invocationCounts();
    }),
  ]);
  ok(a?.reads === 2, 'concurrent invocation A keeps only its own count');
  ok(b?.reads === 50, 'concurrent invocation B keeps only its own count');
}

// ── Disabled: no invocation counts either ────────────────────────────────────
{
  const counter = createOpCounter({ enabled: false });
  let seen: unknown = 'unset';
  await counter.run('x', async () => {
    counter.count('read', 1);
    seen = counter.invocationCounts();
  });
  ok(seen === undefined, 'disabled: no per-invocation state is created');
}

// ── current() reports the active callable ────────────────────────────────────
{
  const counter = createOpCounter({ enabled: true });
  ok(counter.current() === undefined, 'outside any callable there is no current name');
  await counter.run('getWallet', async () => {
    await tick();
    ok(counter.current() === 'getWallet', 'current() survives an await');
  });
  ok(counter.current() === undefined, 'the context does not leak after the callable returns');
}

// ── Disabled is genuinely inert ──────────────────────────────────────────────
{
  const counter = createOpCounter({ enabled: false });
  await counter.run('updateLocation', async () => {
    counter.count('read', 1);
    counter.count('write', 99);
  });
  const snap = counter.snapshot();
  ok(snap.total.reads === 0 && snap.total.writes === 0, 'disabled: nothing is tallied');
  ok(Object.keys(snap.byCallable).length === 0, 'disabled: no per-operation state is retained');
  ok(counter.enabled === false, 'disabled: the counter reports itself as off');
}

// ── Disabled still runs the wrapped work and preserves its result and errors ──
{
  const counter = createOpCounter({ enabled: false });
  const value = await counter.run('getGame', async () => 'the-result');
  ok(value === 'the-result', 'disabled: the wrapped function still returns its value');

  let caught: unknown;
  try {
    await counter.run('getGame', async () => { throw new Error('boom'); });
  } catch (err) { caught = err; }
  ok(caught instanceof Error && (caught as Error).message === 'boom',
    'disabled: the wrapped function still propagates its error unchanged');
}

// ── Enabled must not change results or error propagation either ──────────────
{
  const counter = createOpCounter({ enabled: true });
  const value = await counter.run('getGame', async () => ({ ok: true }));
  ok((value as { ok: boolean }).ok === true, 'enabled: the wrapped function still returns its value');

  let caught: unknown;
  try {
    await counter.run('getGame', async () => { throw new Error('still thrown'); });
  } catch (err) { caught = err; }
  ok(caught instanceof Error && (caught as Error).message === 'still thrown',
    'enabled: an error from the wrapped function propagates unchanged');
}

// ── A defect in the counting path can NEVER fail the Firestore call ──────────
{
  // This is instrumentation bolted onto the hot path of a live game. If the sink throws,
  // the operation it was measuring must still succeed — otherwise the measurement tool
  // becomes the outage.
  const counter = createOpCounter({
    enabled: true,
    sink: () => { throw new Error('sink exploded'); },
  });

  let threw = false;
  try { counter.count('read', 1); } catch { threw = true; }
  ok(!threw, 'a throwing sink does not propagate out of count()');

  let runThrew = false;
  let ran = false;
  try {
    await counter.run('updateLocation', async () => { ran = true; counter.count('write', 1); });
  } catch { runThrew = true; }
  ok(!runThrew, 'a throwing sink does not fail the wrapped callable');
  ok(ran, 'the wrapped work still executed');
}

// ── reset() clears the tally ─────────────────────────────────────────────────
{
  const counter = createOpCounter({ enabled: true });
  await counter.run('x', async () => counter.count('read', 4));
  counter.reset();
  const snap = counter.snapshot();
  ok(snap.total.reads === 0, 'reset clears the totals');
  ok(Object.keys(snap.byCallable).length === 0, 'reset clears per-callable buckets');
}

// ── snapshot() is a copy, not a live handle ──────────────────────────────────
{
  const counter = createOpCounter({ enabled: true });
  await counter.run('x', async () => counter.count('read', 1));
  const first = counter.snapshot();
  await counter.run('x', async () => counter.count('read', 1));
  ok(first.total.reads === 1, 'an earlier snapshot is not mutated by later counting');
}

// ── The projection reports its DENOMINATOR, not a bare verdict ───────────────
{
  // CLAUDE.md's lesson, applied: "whenever a check counts things, print the denominator."
  // "120 players do not fit" is unfalsifiable; "8 teams measured, 75 writes each, scaled
  // to 120" is a claim someone can check and disagree with.
  const tally = createOpTally();
  tally.record('updateLocation', 'write', 600);   // 8 teams x 75
  tally.record('updateLocation', 'read', 80);
  tally.record('completeTask', 'write', 240);

  const p = projectRunCost({
    tallies: tally.snapshot(),
    measuredParticipants: 8,
    targetParticipants: 120,
  });

  ok(p.measuredParticipants === 8, 'the projection states how many participants were measured');
  ok(p.targetParticipants === 120, 'the projection states what it scaled to');
  ok(p.scaleFactor === 15, 'the scale factor is derived from the two counts');

  const loc = p.perCallable.find((r) => r.callable === 'updateLocation');
  ok(loc?.writes === 600, 'the projection carries the MEASURED per-callable count');
  ok(loc?.projectedWrites === 9000, 'and the scaled figure beside it');
  ok(p.projected.writes === 12600, 'projected writes sum across callables');
  ok(p.projected.reads === 1200, 'projected reads sum across callables');

  ok(p.quota.writes === SPARK_DAILY_QUOTA.writes, 'the quota it judged against is reported');
  ok(p.fitsWrites === true, '12,600 projected writes fit inside the 20,000 ceiling');
  ok(p.fitsReads === true, '1,200 projected reads fit inside the 50,000 ceiling');
  ok(p.fits === true, 'fits overall when both ceilings hold');
  ok(p.headroom.writes === 7400, 'write headroom is reported as a number');
}

// ── The projection reports a MISS honestly ───────────────────────────────────
{
  // Today's numbers. This must come out false — a projection that cannot say "no" is
  // not a measurement.
  const tally = createOpTally();
  tally.record('updateLocation', 'write', 450);  // 1 team x 225 pings x 2 writes
  tally.record('updateLocation', 'read', 450);

  const p = projectRunCost({
    tallies: tally.snapshot(),
    measuredParticipants: 1,
    targetParticipants: 120,
  });
  ok(p.projected.writes === 54_000, 'the unmitigated write cost projects to ~54k');
  ok(p.projected.reads === 54_000, 'the unmitigated read cost projects to ~54k');
  ok(p.fitsWrites === false, 'it reports that writes do NOT fit');
  ok(p.fitsReads === false, 'it reports that reads do NOT fit');
  ok(p.fits === false, 'it reports an overall miss');
  ok(p.headroom.writes < 0, 'negative headroom quantifies the overshoot rather than clamping to 0');
}

// ── Projection edge cases are total, never throwing ──────────────────────────
{
  const empty = createOpTally().snapshot();
  let threw = false;
  let p: ReturnType<typeof projectRunCost> | undefined;
  try {
    p = projectRunCost({ tallies: empty, measuredParticipants: 0, targetParticipants: 120 });
  } catch { threw = true; }
  ok(!threw, 'a zero measured-participant count does not divide by zero and throw');
  ok(p?.projected.writes === 0, 'an empty measurement projects to zero, not NaN');
  ok(Number.isFinite(p?.scaleFactor ?? NaN), 'the scale factor stays finite when nothing was measured');
}

} // end main

main().then(() => {
  console.log(`\nfirestore-op-counter: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
