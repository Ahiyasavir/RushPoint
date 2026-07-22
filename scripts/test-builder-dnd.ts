// Pure-logic suite for Builder task drag & drop (Wave A, Task 7).
// Covers the two helpers that protect the feature's invariants:
//   • clampRequiredTaskCount — a stage can never require more tasks than it has
//   • moveTaskBetweenStages  — intra/inter-stage moves that re-clamp BOTH stages
// DOM-free; run by scripts/run-unit-tests.mjs (`npm test`).
//   npx tsx scripts/test-builder-dnd.ts
import {
  clampRequiredTaskCount, moveTaskBetweenStages, normalizeGroups, setTaskGroup,
  removeTaskFromGroups, groupIndexOfTask, type ReorderStage, type GroupLike,
} from '../apps/creator-web/src/lib/reorder';
import { isValidDropTarget } from '../apps/creator-web/src/components/StageRail';
// Imported from SOURCE (never the built shared dist) so this lane needs no build
// step and can never assert against a stale artifact — same rule as
// scripts/test-mutual-exclusion.ts.
import { effectiveExclusiveGroups, maxAttainableCompletions } from '../packages/shared/src/mutualExclusion';

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

// ═══════════════════════════════════════════════════════════════════════════
// Wave D — exclusive-group presentation helpers (change: builder-dnd-groups).
// The data model itself lives in packages/shared/src/mutualExclusion.ts and is
// NOT touched; these are the Builder-side authoring helpers that keep the
// authored array in a shape the model reads the way the creator expects.
// ═══════════════════════════════════════════════════════════════════════════

const g = (id: string, ...taskIds: string[]): GroupLike => ({ id, taskIds });
const gstr = (gs: GroupLike[] | undefined) =>
  gs === undefined ? 'undefined' : gs.map((x) => `${x.id}:[${x.taskIds.join(',')}]`).join(' ');

// ── 7. normalizeGroups ──────────────────────────────────────────────────────
{
  const all = ['t1', 't2', 't3'];
  check('normalize: unknown task ids are dropped',
    gstr(normalizeGroups([g('g1', 't1', 'zz', 't2')], all)) === 'g1:[t1,t2]',
    gstr(normalizeGroups([g('g1', 't1', 'zz', 't2')], all)));
  check('normalize: duplicate ids inside one group collapse',
    gstr(normalizeGroups([g('g1', 't1', 't1', 't2')], all)) === 'g1:[t1,t2]');
  check('normalize: an id claimed by an earlier group leaves the later one',
    gstr(normalizeGroups([g('g1', 't1', 't2'), g('g2', 't2', 't3')], all)) === 'g1:[t1,t2] g2:[t3]',
    gstr(normalizeGroups([g('g1', 't1', 't2'), g('g2', 't2', 't3')], all)));
  check('normalize: an emptied group is dropped',
    gstr(normalizeGroups([g('g1', 't1'), g('g2', 'zz')], all)) === 'g1:[t1]',
    gstr(normalizeGroups([g('g1', 't1'), g('g2', 'zz')], all)));
  check('normalize: an all-empty result is undefined (clears the field)',
    normalizeGroups([g('g1', 'zz'), g('g2')], all) === undefined);
  check('normalize: undefined in, undefined out', normalizeGroups(undefined, all) === undefined);
  {
    // A 1-member group is KEPT (the creator is mid-edit) but the model treats it
    // as inert — the modal shows it greyed rather than deleting it under them.
    const kept = normalizeGroups([g('g1', 't1')], all);
    check('normalize: a 1-member group survives', gstr(kept) === 'g1:[t1]');
    check('normalize: ...but is inert per effectiveExclusiveGroups',
      effectiveExclusiveGroups({ tasks: all.map((id) => ({ id })), exclusiveGroups: kept }).length === 0);
  }
}

// ── 8. setTaskGroup ─────────────────────────────────────────────────────────
{
  const base = [g('g1', 't1', 't2'), g('g2', 't3')];
  check('setTaskGroup: assigning removes the task from every other group',
    gstr(setTaskGroup(base, 't1', 'g2')) === 'g1:[t2] g2:[t3,t1]',
    gstr(setTaskGroup(base, 't1', 'g2')));
  check('setTaskGroup: null removes it from all groups',
    gstr(setTaskGroup(base, 't1', null)) === 'g1:[t2] g2:[t3]',
    gstr(setTaskGroup(base, 't1', null)));
  check('setTaskGroup: assigning to the group it is already in is identity',
    setTaskGroup(base, 't1', 'g1') === base);
  check('setTaskGroup: null on an already-ungrouped task is identity',
    setTaskGroup(base, 't9', null) === base);
  check('setTaskGroup: a non-existent group id is a no-op',
    setTaskGroup(base, 't1', 'nope') === base);
  check('setTaskGroup: create=true makes the group and assigns in one call',
    gstr(setTaskGroup(undefined, 't1', 'new1', true)) === 'new1:[t1]',
    gstr(setTaskGroup(undefined, 't1', 'new1', true)));
  check('setTaskGroup: create=true also detaches from the old group',
    gstr(setTaskGroup(base, 't1', 'new1', true)) === 'g1:[t2] g2:[t3] new1:[t1]',
    gstr(setTaskGroup(base, 't1', 'new1', true)));
  check('setTaskGroup: input is not mutated', gstr(base) === 'g1:[t1,t2] g2:[t3]');
  {
    // At most one group, by construction — the property the radio UI relies on.
    let cur: GroupLike[] | undefined = [g('g1', 't1', 't2'), g('g2', 't3', 't4')];
    cur = setTaskGroup(cur, 't3', 'g1');
    cur = setTaskGroup(cur, 't1', 'g2');
    const counts = new Map<string, number>();
    for (const grp of cur ?? []) for (const id of grp.taskIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    check('setTaskGroup: no task ever ends up in two groups',
      [...counts.values()].every((n) => n === 1), gstr(cur));
  }
}

// ── 9. removeTaskFromGroups ─────────────────────────────────────────────────
{
  const base = [g('g1', 't1', 't2', 't3'), g('g2', 't4', 't1')];
  check('remove: strips the id from every group',
    gstr(removeTaskFromGroups(base, 't1')) === 'g1:[t2,t3] g2:[t4]',
    gstr(removeTaskFromGroups(base, 't1')));
  check('remove: a group reduced to 0 members disappears',
    gstr(removeTaskFromGroups([g('g1', 't1'), g('g2', 't2', 't3')], 't1')) === 'g2:[t2,t3]');
  check('remove: an unknown id is identity', removeTaskFromGroups(base, 'zz') === base);
  check('remove: undefined in, undefined out', removeTaskFromGroups(undefined, 't1') === undefined);
  {
    const shrunk = removeTaskFromGroups([g('g1', 't1', 't2')], 't1');
    check('remove: a group reduced to 1 member survives', gstr(shrunk) === 'g1:[t2]');
    check('remove: ...but no longer constrains anything',
      effectiveExclusiveGroups({ tasks: [{ id: 't2' }], exclusiveGroups: shrunk }).length === 0);
  }
}

// ── 10. moveTaskBetweenStages × exclusive groups (the intersection) ─────────
type GS = ReorderStage & { exclusiveGroups?: GroupLike[] };
const gstage = (id: string, taskIds: string[], groups?: GroupLike[], requiredTaskCount?: number): GS => ({
  id, requiredTaskCount, tasks: taskIds.map((t) => ({ id: t })), exclusiveGroups: groups,
});
{
  const before: GS[] = [
    gstage('A', ['t1', 't2', 't3'], [g('ga', 't1', 't2', 't3')]),
    gstage('B', ['u1', 'u2'], [g('gb', 'u1', 'u2')]),
  ];
  const after = moveTaskBetweenStages(before, 'A', 't2', 'B');
  check('cross move strips the task from the SOURCE stage groups',
    gstr(after[0].exclusiveGroups) === 'ga:[t1,t3]', gstr(after[0].exclusiveGroups));
  check('cross move leaves the DESTINATION groups untouched',
    after[1].exclusiveGroups === before[1].exclusiveGroups, gstr(after[1].exclusiveGroups));
  check('the arriving task is ungrouped in its new stage',
    !(after[1].exclusiveGroups ?? []).some((x) => x.taskIds.includes('t2')));
}
{
  // Source group reduced to a single member stops constraining anything.
  const before: GS[] = [gstage('A', ['t1', 't2', 't3'], [g('ga', 't1', 't2')]), gstage('B', ['u1'])];
  const after = moveTaskBetweenStages(before, 'A', 't2', 'B');
  check('a source group reduced to 1 member no longer constrains',
    effectiveExclusiveGroups(after[0] as never).length === 0, gstr(after[0].exclusiveGroups));
}
{
  // Regression guard for §4, re-asserted with groups present on both sides.
  const before: GS[] = [
    gstage('A', ['t1', 't2', 't3'], [g('ga', 't1', 't2')], 3),
    gstage('B', ['u1', 'u2'], [g('gb', 'u1', 'u2')], 2),
  ];
  const after = moveTaskBetweenStages(before, 'A', 't3', 'B');
  check('both stages are still requiredTaskCount-clamped with groups present',
    after[0].requiredTaskCount === undefined && after[1].requiredTaskCount === 2,
    `${after[0].requiredTaskCount} / ${after[1].requiredTaskCount}`);
}
{
  const before: GS[] = [gstage('A', ['t1', 't2', 't3'], [g('ga', 't1', 't2')])];
  const after = moveTaskBetweenStages(before, 'A', 't1', 'A', 2);
  check('same-stage reorder leaves exclusiveGroups referentially identical',
    after[0].exclusiveGroups === before[0].exclusiveGroups);
}
{
  const before: GS[] = [gstage('A', ['t1'], [g('ga', 't1')]), gstage('B', ['u1'])];
  check('moving the last task out is still refused and leaves groups untouched',
    moveTaskBetweenStages(before, 'A', 't1', 'B') === before);
}
{
  // A stage with no groups must not sprout an `exclusiveGroups` key.
  const before: GS[] = [gstage('A', ['t1', 't2']), gstage('B', ['u1'])];
  const after = moveTaskBetweenStages(before, 'A', 't1', 'B');
  check('a group-free source stage stays group-free',
    after[0].exclusiveGroups === undefined, gstr(after[0].exclusiveGroups));
}

// ── 11. Group presentation helpers ─────────────────────────────────────────
{
  const stageOf = (taskIds: string[], groups: GroupLike[]) =>
    ({ tasks: taskIds.map((id) => ({ id })), exclusiveGroups: groups });
  const s1 = stageOf(['t1', 't2', 't3', 't4'], [g('ga', 't1', 't2'), g('gb', 't3', 't4')]);
  const eff1 = effectiveExclusiveGroups(s1);
  check('groupIndexOfTask: returns the GROUP_STYLES index',
    groupIndexOfTask(eff1, 't1') === 0 && groupIndexOfTask(eff1, 't3') === 1);
  check('groupIndexOfTask: an ungrouped/unknown id is -1',
    groupIndexOfTask(eff1, 'zz') === -1);
  {
    // Badge letters must not shuffle when the creator reorders cards.
    const reordered = stageOf(['t3', 't1', 't4', 't2'], [g('ga', 't1', 't2'), g('gb', 't3', 't4')]);
    const eff2 = effectiveExclusiveGroups(reordered);
    check('groupIndexOfTask: the index is stable under a same-stage reorder',
      groupIndexOfTask(eff2, 't1') === 0 && groupIndexOfTask(eff2, 't3') === 1,
      `${groupIndexOfTask(eff2, 't1')} / ${groupIndexOfTask(eff2, 't3')}`);
  }
  {
    // A 7th group wraps the 6-colour palette but must still get its own index
    // (the LETTER is derived from the index and therefore never repeats).
    const ids7 = Array.from({ length: 14 }, (_, i) => `t${i}`);
    const groups7 = Array.from({ length: 7 }, (_, i) => g(`g${i}`, `t${i * 2}`, `t${i * 2 + 1}`));
    const eff7 = effectiveExclusiveGroups(stageOf(ids7, groups7));
    const idx = groupIndexOfTask(eff7, 't12');
    check('groupIndexOfTask: a 7th group gets index 6 (colour wraps, letter does not)',
      idx === 6 && idx % 6 === 0, String(idx));
  }
  {
    // The modal footer's ceiling must match what the warning uses post-move.
    const before: GS[] = [
      gstage('A', ['t1', 't2', 't3'], [g('ga', 't1', 't2')]),
      gstage('B', ['u1', 'u2']),
    ];
    const after = moveTaskBetweenStages(before, 'A', 't2', 'B');
    check('maxAttainableCompletions after a cross move matches the new stage shape',
      maxAttainableCompletions(after[0] as never) === 2, String(maxAttainableCompletions(after[0] as never)));
  }
}

// ── 12. Seeded invariant property sweep ────────────────────────────────────
// The cheapest possible guard against the exact bug class this change risks:
// an unwinnable stage, or a task claimed by two groups.
{
  let seed = 0x5eed1234;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0xffffffff;
  };
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length) % a.length];
  let bad = 0;
  let badDetail = '';
  for (let iter = 0; iter < 400; iter++) {
    const nStages = 2 + Math.floor(rnd() * 3);
    let stages: GS[] = Array.from({ length: nStages }, (_, si) => {
      const n = 1 + Math.floor(rnd() * 5);
      const taskIds = Array.from({ length: n }, (_, ti) => `s${si}t${ti}`);
      const groups: GroupLike[] = rnd() < 0.6
        ? [{ id: `s${si}g0`, taskIds: taskIds.filter(() => rnd() < 0.5) }]
        : [];
      return gstage(`S${si}`, taskIds, groups.length > 0 ? groups : undefined,
        rnd() < 0.5 ? 1 + Math.floor(rnd() * n) : undefined);
    });
    for (let op = 0; op < 8; op++) {
      const s = pick(stages);
      if (s.tasks.length === 0) continue;
      const taskId = pick(s.tasks).id;
      if (rnd() < 0.5) {
        const dest = pick(stages);
        stages = moveTaskBetweenStages(stages, s.id, taskId, dest.id,
          rnd() < 0.5 ? Math.floor(rnd() * 4) : undefined);
      } else {
        const cur = stages.find((x) => x.id === s.id)!;
        const gid = cur.exclusiveGroups?.[0]?.id ?? null;
        const next = setTaskGroup(cur.exclusiveGroups, taskId, rnd() < 0.3 ? null : (gid ?? `${cur.id}gN`), gid === null);
        stages = stages.map((x) => (x.id === cur.id ? { ...x, exclusiveGroups: next } : x));
      }
    }
    for (const s of stages) {
      const req = s.requiredTaskCount;
      if (typeof req === 'number' && req > s.tasks.length) {
        bad++; badDetail = `unwinnable ${s.id} req=${req} tasks=${s.tasks.length}`; break;
      }
      if (s.tasks.length === 0) { bad++; badDetail = `emptied ${s.id}`; break; }
      const seen = new Set<string>();
      for (const grp of s.exclusiveGroups ?? []) {
        for (const id of grp.taskIds) {
          if (seen.has(id)) { bad++; badDetail = `${id} in two groups of ${s.id}`; }
          seen.add(id);
        }
      }
      if (bad) break;
    }
    if (bad) break;
  }
  check('property: 400 seeded op sequences keep every stage winnable, non-empty and single-claim',
    bad === 0, badDetail);
}

// ── 13. R1 — type-aware collision resolution ────────────────────────────────
// A rail entry stacks a stage SORTABLE ('stage', bare id) and a task DROP
// target ('stage-drop', prefixed id) on ONE node — identical centre. Plain
// closestCenter ties and breaks by registration order, silently no-oping one
// gesture. `isValidDropTarget` filters candidates by the ACTIVE drag type so
// the tie is removed and BOTH gestures land.
{
  // A dragged TASK may land on another task (reorder / cross-stage insert) or a
  // rail entry's stage-drop target, but NEVER the bare stage sortable — that is
  // exactly the co-located droppable that made the primary cross-stage move
  // no-op.
  check('drop: task → task is valid', isValidDropTarget('task', 'task') === true);
  check('drop: task → stage-drop is valid', isValidDropTarget('task', 'stage-drop') === true);
  check('drop: task → bare stage is REJECTED (R1 cross-stage move fix)',
    isValidDropTarget('task', 'stage') === false);

  // A dragged STAGE reorders only among bare stage sortables; the co-located
  // stage-drop target (and any task) is off-limits, so a reorder can't resolve
  // to a prefixed id and no-op.
  check('drop: stage → bare stage is valid', isValidDropTarget('stage', 'stage') === true);
  check('drop: stage → stage-drop is REJECTED (R1 reorder fix)',
    isValidDropTarget('stage', 'stage-drop') === false);
  check('drop: stage → task is rejected', isValidDropTarget('stage', 'task') === false);

  // A candidate with no declared type is never a valid target.
  check('drop: task → undefined type is rejected', isValidDropTarget('task', undefined) === false);
  check('drop: stage → undefined type is rejected', isValidDropTarget('stage', undefined) === false);

  // The essential invariant: for EITHER drag type, the two co-located rail
  // droppables can never BOTH be candidates, so there is no zero-distance tie.
  for (const active of ['task', 'stage'] as const) {
    const stageOk = isValidDropTarget(active, 'stage');
    const stageDropOk = isValidDropTarget(active, 'stage-drop');
    check(`drop: ${active} drag never accepts BOTH co-located rail droppables`,
      !(stageOk && stageDropOk), `${stageOk} / ${stageDropOk}`);
  }
}

console.log(`\n${failures === 0 ? 'ALL BUILDER-DND TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
