// Pure-logic tests for the @rushpoint/data REPOSITORY CONTRACT — the suite that
// every implementation of the data layer must pass (in-memory today, Firestore
// this phase, Postgres next). Two implementations passing the same suite is what
// makes the storage swap behaviour-neutral by construction rather than by hope.
//
// This file is the FAST LANE: it runs the contract against the in-memory
// reference implementation, so it needs no emulator, no Postgres and no network.
// Run by scripts/run-unit-tests.mjs via `npm test` (auto-discovered).
//
// It also runs the contract against a DELIBERATELY BROKEN implementation and
// asserts that the suite FAILS on it. A contract suite that passes vacuously is
// worse than no suite at all, so non-vacuity is itself a gate here.
//
// SAFETY: no sockets, no filesystem, no emulator, no clock, no randomness.
import { runRepositoryContract } from '../packages/data/test/contract';
import { InMemoryRepository, NaiveClaimRepository } from '../packages/data/test/inMemory';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

async function main(): Promise<void> {
  // ── 1. The reference implementation must pass the whole contract ──────────
  const reference = await runRepositoryContract(
    async () => new InMemoryRepository(),
    'in-memory reference',
    // The reference models Firestore's absent-vs-null distinction, so the
    // engine-specific half of the Patch suite is switched on for it.
    { absentDistinctFromNull: true },
  );

  for (const failure of reference.failures) console.error(`  ✗ ${failure}`);
  for (const n of reference.notes) console.log(`  · ${n}`);

  ok(reference.failed === 0,
    `the in-memory reference passes the contract (${reference.failed} assertion(s) failed)`);
  ok(reference.passed > 40,
    `the contract actually asserted something substantial (${reference.passed} assertions)`);

  // ── 2. NON-VACUITY: a broken implementation must FAIL the contract ────────
  // NaiveClaimRepository differs in exactly one way — claimTaskSlot counts
  // occupancy, yields, then writes without conflict checking. That is the
  // check-then-write bug `Run.taskCounts` kept producing. If this ever comes
  // back clean, the contention test has stopped testing.
  const broken = await runRepositoryContract(
    async () => new NaiveClaimRepository(),
    'naive check-then-write (expected to FAIL)',
    { absentDistinctFromNull: true },
  );

  ok(broken.failed > 0,
    'the contract FAILS a check-then-write claimTaskSlot (the suite is not vacuous)');
  ok(broken.failures.some((f) => /exactly capacity|NEVER exceeds capacity/.test(f)),
    `the failure is specifically the capacity breach, got: ${broken.failures.slice(0, 3).join(' | ') || '(none)'}`);
  // Everything else must still pass, or the "broken" run proves nothing about
  // WHICH invariant the contention test caught.
  ok(broken.failures.every((f) => /^claim-contention|^claim-release-cycle/.test(f)),
    `only the claim scenarios fail on the naive implementation, got: ${broken.failures.filter((f) => !/^claim/.test(f)).join(' | ') || '(only claim scenarios)'}`);

  console.log(`\n  reference: ${reference.passed} contract assertions passed, ${reference.failed} failed`);
  console.log(`  naive:     ${broken.passed} passed, ${broken.failed} failed (failure is EXPECTED)`);
}

main().then(() => {
  console.log(`\ndata-contract: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, (e) => {
  console.error('data-contract: suite threw', e);
  process.exit(1);
});
