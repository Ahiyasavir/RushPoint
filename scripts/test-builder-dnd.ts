// Pure-logic suite for Builder task drag & drop (Wave A, Task 7).
// Covers the two helpers that protect the feature's invariants:
//   • clampRequiredTaskCount — a stage can never require more tasks than it has
//   • moveTaskBetweenStages  — intra/inter-stage moves that re-clamp BOTH stages
// DOM-free; run by scripts/run-unit-tests.mjs (`npm test`).
//   npx tsx scripts/test-builder-dnd.ts
import { clampRequiredTaskCount, moveTaskBetweenStages, type ReorderStage } from '../apps/creator-web/src/lib/reorder';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

type S = ReorderStage & { title: string };
const stage = (id: string, taskIds: string[], requiredTaskCount?: number): S => ({
  id, title: id, requiredTaskCount, tasks: taskIds.map((t) => ({ id: t })),
});
const ids = (s: ReorderStage) => s.tasks.map((t) => t.id).join(',');

// ── 1. clampRequiredTaskCount ───────────────────────────────────────────────
check('clamp: undefined stays undefined', clampRequiredTaskCount(undefined, 5) === undefined);
check('clamp: below count is preserved', clampRequiredTaskCount(2, 5) === 2);
check('clamp: equal to count means "all" (undefined)', clampRequiredTaskCount(5, 5) === undefined);
check('clamp: above count collapses to undefined', clampRequiredTaskCount(7, 5) === undefined);
check('clamp: zero / negative collapse to undefined',
  clampRequiredTaskCount(0, 5) === undefined && clampRequiredTaskCount(-3, 5) === undefined);
check('clamp: NaN collapses to undefined', clampRequiredTaskCount(Number.NaN, 5) === undefined);
check('clamp: fractional floors', clampRequiredTaskCount(2.9, 5) === 2);
check('clamp: empty stage collapses to undefined', clampRequiredTaskCount(1, 0) === undefined);

// ── 2. moveTaskBetweenStages — same-stage reorder ───────────────────────────
{
  const before: S[] = [stage('A', ['t1', 't2', 't3'])];
  const after = moveTaskBetweenStages(before, 'A', 't1', 'A', 2);
  check('same-stage move reorders in place', ids(after[0]) === 't2,t3,t1', ids(after[0]));
  check('same-stage move does not mutate input', ids(before[0]) === 't1,t2,t3');
  const noop = moveTaskBetweenStages(before, 'A', 't1', 'A', 0);
  check('same-stage move to its own index is identity', noop === before);
}

// ── 3. moveTaskBetweenStages — cross-stage move ─────────────────────────────
{
  const before: S[] = [stage('A', ['t1', 't2', 't3']), stage('B', ['u1', 'u2'])];
  const at1 = moveTaskBetweenStages(before, 'A', 't2', 'B', 1);
  check('cross move removes from source', ids(at1[0]) === 't1,t3', ids(at1[0]));
  check('cross move inserts at toIndex', ids(at1[1]) === 'u1,t2,u2', ids(at1[1]));

  const appended = moveTaskBetweenStages(before, 'A', 't2', 'B');
  check('cross move without toIndex appends', ids(appended[1]) === 'u1,u2,t2', ids(appended[1]));

  check('cross move does not mutate input',
    ids(before[0]) === 't1,t2,t3' && ids(before[1]) === 'u1,u2');
}

// ── 4. requiredTaskCount re-clamping on both sides ──────────────────────────
{
  // Source required 3 of 3 tasks would become 3-of-2 → unwinnable, must clear.
  const before: S[] = [stage('A', ['t1', 't2', 't3'], 3), stage('B', ['u1'], undefined)];
  const after = moveTaskBetweenStages(before, 'A', 't3', 'B');
  check('source required is re-clamped when it no longer fits', after[0].requiredTaskCount === undefined,
    String(after[0].requiredTaskCount));
}
{
  // Source required 1 of 3 still fits after shrinking to 2.
  const before: S[] = [stage('A', ['t1', 't2', 't3'], 1), stage('B', ['u1'])];
  const after = moveTaskBetweenStages(before, 'A', 't3', 'B');
  check('source required that still fits is preserved', after[0].requiredTaskCount === 1,
    String(after[0].requiredTaskCount));
}
{
  // Destination required 1 of 2 stays valid when it grows to 3.
  const before: S[] = [stage('A', ['t1', 't2']), stage('B', ['u1', 'u2'], 1)];
  const after = moveTaskBetweenStages(before, 'A', 't1', 'B');
  check('destination required survives growth', after[1].requiredTaskCount === 1,
    String(after[1].requiredTaskCount));
}
{
  // Destination required 2 of 2 becomes 2-of-3 — still valid, kept as-is.
  const before: S[] = [stage('A', ['t1', 't2']), stage('B', ['u1', 'u2'], 2)];
  const after = moveTaskBetweenStages(before, 'A', 't1', 'B');
  check('destination required equal to old length stays valid after growth',
    after[1].requiredTaskCount === 2, String(after[1].requiredTaskCount));
}
{
  // A same-stage reorder must not disturb the count.
  const before: S[] = [stage('A', ['t1', 't2', 't3'], 2)];
  const after = moveTaskBetweenStages(before, 'A', 't1', 'A', 2);
  check('same-stage reorder preserves requiredTaskCount', after[0].requiredTaskCount === 2);
}

// ── 5. Guards — never empty a stage, never act on unknown ids ───────────────
{
  const before: S[] = [stage('A', ['t1']), stage('B', ['u1', 'u2'])];
  check('moving a stage\'s last task is a no-op', moveTaskBetweenStages(before, 'A', 't1', 'B') === before);
}
{
  const before: S[] = [stage('A', ['t1', 't2']), stage('B', ['u1'])];
  check('unknown source stage is a no-op', moveTaskBetweenStages(before, 'Z', 't1', 'B') === before);
  check('unknown destination stage is a no-op', moveTaskBetweenStages(before, 'A', 't1', 'Z') === before);
  check('unknown task id is a no-op', moveTaskBetweenStages(before, 'A', 'nope', 'B') === before);
}

// ── 6. Referential stability for untouched stages ──────────────────────────
{
  const before: S[] = [stage('A', ['t1', 't2']), stage('B', ['u1']), stage('C', ['v1'])];
  const after = moveTaskBetweenStages(before, 'A', 't1', 'B');
  check('untouched stage keeps its identity', after[2] === before[2]);
  check('touched stages are new objects', after[0] !== before[0] && after[1] !== before[1]);
}

console.log(`\n${failures === 0 ? 'ALL BUILDER-DND TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
