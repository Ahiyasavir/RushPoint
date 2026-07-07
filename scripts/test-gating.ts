// Pure-logic tests for unlockable tasks (isUnlocked / validateUnlockGraph).
// Change: unlockable-tasks. Run by scripts/run-unit-tests.mjs via `npm test`.
// No emulator needed.
import { isUnlocked, validateUnlockGraph } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── isUnlocked truth table ────────────────────────────────────────────────────
ok(isUnlocked({}, []) === true, 'absent gate → unlocked');
ok(isUnlocked({ unlockAfterTaskIds: undefined }, []) === true, 'undefined gate → unlocked');
ok(isUnlocked({ unlockAfterTaskIds: [] }, []) === true, 'empty gate → unlocked');
ok(isUnlocked({ unlockAfterTaskIds: 'a' as unknown as string[] }, []) === true,
  'non-array gate → unlocked (defensive)');
ok(isUnlocked({ unlockAfterTaskIds: ['a'] }, ['a']) === true, 'single prerequisite met → unlocked');
ok(isUnlocked({ unlockAfterTaskIds: ['a', 'b'] }, ['b', 'a', 'c']) === true, 'all prerequisites met → unlocked');
ok(isUnlocked({ unlockAfterTaskIds: ['a'] }, []) === false, 'unmet prerequisite → locked');
ok(isUnlocked({ unlockAfterTaskIds: ['a', 'b'] }, ['a']) === false, 'partially-met (AND semantics) → locked');
ok(isUnlocked({ unlockAfterTaskIds: ['ghost'] }, ['a', 'b']) === false,
  'unknown prerequisite id never silently unlocks → locked');

// ── validateUnlockGraph ───────────────────────────────────────────────────────
const task = (id: string, unlockAfterTaskIds?: string[]) => ({
  id, title: id, type: 'field' as const, difficulty: 5, estimatedMinutes: 5,
  pointValue: 10, maxConcurrentTeams: 3, ...(unlockAfterTaskIds ? { unlockAfterTaskIds } : {}),
});

// No gates at all → clean.
{
  const r = validateUnlockGraph({ tasks: [task('a'), task('b')] });
  ok(r.errors.length === 0 && r.warnings.length === 0, 'ungated stage → no errors, no warnings');
}

// Self-reference → error.
{
  const r = validateUnlockGraph({ tasks: [task('a', ['a'])] });
  ok(r.errors.length > 0, 'self-reference → error');
}

// Unknown / cross-stage id (not among this stage's tasks) → error.
{
  const r = validateUnlockGraph({ tasks: [task('a', ['other-stage-task'])] });
  ok(r.errors.length > 0, 'unknown/cross-stage prerequisite id → error');
}

// 2-cycle → error.
{
  const r = validateUnlockGraph({ tasks: [task('a', ['b']), task('b', ['a'])] });
  ok(r.errors.length > 0, '2-cycle → error');
}

// 3-cycle → error.
{
  const r = validateUnlockGraph({ tasks: [task('a', ['c']), task('b', ['a']), task('c', ['b'])] });
  ok(r.errors.length > 0, '3-cycle → error');
}

// Valid diamond DAG (a → b, a → c, b+c → d) → no errors.
{
  const r = validateUnlockGraph({
    tasks: [task('a'), task('b', ['a']), task('c', ['a']), task('d', ['b', 'c'])],
  });
  ok(r.errors.length === 0, 'valid diamond DAG → no errors');
  ok(r.warnings.length === 0, 'valid diamond DAG → no warnings');
}

// A chain is fine too (a → b → c) — no errors.
{
  const r = validateUnlockGraph({ tasks: [task('a'), task('b', ['a']), task('c', ['b'])] });
  ok(r.errors.length === 0, 'linear chain → no errors');
}

// requiredTaskCount above the number of REACHABLE tasks → warning.
{
  const r = validateUnlockGraph({ tasks: [task('a'), task('b')], requiredTaskCount: 3 });
  ok(r.warnings.length > 0, 'requiredTaskCount > task count → warning');
}
{
  // a is free; b↔c form a cycle (error) so only 1 task is reachable — the
  // requiredTaskCount:2 warning fires alongside the cycle error.
  const r = validateUnlockGraph({
    tasks: [task('a'), task('b', ['c']), task('c', ['b'])], requiredTaskCount: 2,
  });
  ok(r.errors.length > 0, 'cycle inside a partial stage → still an error');
  ok(r.warnings.length > 0, 'requiredTaskCount > reachable (cycle blocks 2 of 3) → warning');
}
{
  const r = validateUnlockGraph({
    tasks: [task('a'), task('b', ['a']), task('c', ['b'])], requiredTaskCount: 2,
  });
  ok(r.warnings.length === 0, 'requiredTaskCount within reachable count → no warning');
}

console.log(failed === 0
  ? `\n✅ ALL GATING TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
