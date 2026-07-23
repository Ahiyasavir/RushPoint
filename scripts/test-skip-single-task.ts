// Pure-logic tests — skipping ONE mission for ONE team (change: skip-single-task).
//
// The only skip the platform had was `skipStage`, which wipes out every remaining
// task of the team's active stage. These assertions pin the per-task decision:
// which task may be skipped, whether the stage ends, and — the part that actually
// strands teams — how much the team's own `requiredTaskCount` has to come down so
// the stage stays winnable after a task is taken out of its route.
//
// Every case is a pure function of (authored stage, that team's per-task statuses,
// that team's stored requirement). No emulator, no Firebase. Runs via `npm test`
// (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import { planTaskSkip } from '../packages/shared/src/taskSkip';
import type { SkipTaskStage } from '../packages/shared/src/taskSkip';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}
function eqJson(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

type Status = 'unassigned' | 'assigned' | 'completed' | 'skipped';

/** A stage of `ids`, optionally with exclusive groups. */
function stage(ids: string[], groups?: { id: string; taskIds: string[] }[]): SkipTaskStage {
  return { tasks: ids.map((id) => ({ id })), ...(groups ? { exclusiveGroups: groups } : {}) };
}
function statuses(map: Record<string, Status>): Record<string, Status> {
  return map;
}

console.log('\nskip-single-task — planTaskSkip');

// ── 1. The motivating case: a 3-of-3 stage must NOT become unfinishable ────────
{
  const p = planTaskSkip({
    stage: stage(['a', 'b', 'c']),
    statusByTaskId: statuses({ a: 'assigned', b: 'unassigned', c: 'unassigned' }),
    requiredTaskCount: 3,
  }, 'a');
  ok('3-of-3, skip the held task: the plan is accepted', p.ok === true, p.reason);
  eq('3-of-3, skip a: the requirement drops to 2', p.requiredTaskCount, 2);
  eq('3-of-3, skip a: the drop is reported', p.requirementLowered, true);
  eq('3-of-3, skip a: the stage does NOT complete', p.stageCompletes, false);
  eq('3-of-3, skip a: the held station slot must be released', p.heldSlot, true);
  eqJson('3-of-3, skip a: b and c remain playable, in stage order', p.remainingTaskIds, ['b', 'c']);
  eq('3-of-3, skip a: attainable completions after the skip', p.attainableAfter, 2);
  eq('3-of-3, skip a: nothing is banked yet', p.completedCount, 0);
}

// ── 2. A partial stage keeps its requirement when the skip does not threaten it ─
{
  const p = planTaskSkip({
    stage: stage(['a', 'b', 'c']),
    statusByTaskId: statuses({ a: 'assigned', b: 'unassigned', c: 'unassigned' }),
    requiredTaskCount: 2,
  }, 'a');
  eq('2-of-3, skip a: the requirement stays at 2', p.requiredTaskCount, 2);
  eq('2-of-3, skip a: nothing was lowered', p.requirementLowered, false);
  eq('2-of-3, skip a: the stage does NOT complete', p.stageCompletes, false);
}
{
  const p = planTaskSkip({
    stage: stage(['a', 'b', 'c']),
    statusByTaskId: statuses({ a: 'completed', b: 'assigned', c: 'unassigned' }),
    requiredTaskCount: 2,
  }, 'b');
  eq('2-of-3 with one banked, skip b: requirement stays at 2', p.requiredTaskCount, 2);
  eq('2-of-3 with one banked, skip b: c can still finish the stage', p.stageCompletes, false);
  eqJson('2-of-3 with one banked, skip b: only c remains', p.remainingTaskIds, ['c']);
  eq('2-of-3 with one banked, skip b: the completion is counted', p.completedCount, 1);
}

// ── 3. A skip that lands on an ALREADY satisfied stage completes it ────────────
{
  const p = planTaskSkip({
    stage: stage(['a', 'b', 'c']),
    statusByTaskId: statuses({ a: 'completed', b: 'completed', c: 'assigned' }),
    requiredTaskCount: 2,
  }, 'c');
  eq('2-of-3 already satisfied, skip the leftover: the stage completes', p.stageCompletes, true);
  eq('2-of-3 already satisfied: the requirement is untouched', p.requiredTaskCount, 2);
  eqJson('2-of-3 already satisfied: nothing remains playable', p.remainingTaskIds, []);
}

// ── 4. Skipping the only playable task completes the stage ────────────────────
{
  const p = planTaskSkip({
    stage: stage(['a']),
    statusByTaskId: statuses({ a: 'assigned' }),
    requiredTaskCount: undefined,
  }, 'a');
  eq('single-task stage, skip it: the stage completes', p.stageCompletes, true);
  eq('single-task stage: the requirement falls to 0, never below', p.requiredTaskCount, 0);
  eq('single-task stage: the drop is reported', p.requirementLowered, true);
  ok('single-task stage: the requirement is never negative', p.requiredTaskCount >= 0);
}

// ── 5. Exclusive groups: a group yields at most ONE completion ─────────────────
{
  const g = stage(['a', 'b', 'c'], [{ id: 'g1', taskIds: ['a', 'b'] }]);
  const p = planTaskSkip({
    stage: g,
    statusByTaskId: statuses({ a: 'assigned', b: 'unassigned', c: 'unassigned' }),
    requiredTaskCount: 2,
  }, 'a');
  eq('group {a,b} + c requiring 2, skip a: requirement stays 2 (b still yields the group)',
    p.requiredTaskCount, 2);
  eq('group {a,b} + c, skip a: attainable is still 2', p.attainableAfter, 2);
  eq('group {a,b} + c, skip a: the stage does not complete', p.stageCompletes, false);

  const p2 = planTaskSkip({
    stage: g,
    statusByTaskId: statuses({ a: 'skipped', b: 'assigned', c: 'unassigned' }),
    requiredTaskCount: 2,
  }, 'b');
  eq('group {a,b} + c, both alternatives skipped: requirement falls to 1', p2.requiredTaskCount, 1);
  eq('group {a,b} + c, both alternatives skipped: the drop is reported', p2.requirementLowered, true);
  eqJson('group {a,b} + c, both alternatives skipped: only c remains', p2.remainingTaskIds, ['c']);
  eq('group {a,b} + c, both alternatives skipped: c can still finish the stage',
    p2.stageCompletes, false);
}
{
  // A group whose ONE completion is already banked still contributes exactly 1,
  // so skipping the (already locked) sibling must not lower anything.
  const g = stage(['a', 'b', 'c'], [{ id: 'g1', taskIds: ['a', 'b'] }]);
  const p = planTaskSkip({
    stage: g,
    statusByTaskId: statuses({ a: 'completed', b: 'unassigned', c: 'assigned' }),
    requiredTaskCount: 2,
  }, 'b');
  eq('group with a banked winner, skip the loser: requirement stays 2', p.requiredTaskCount, 2);
  eq('group with a banked winner, skip the loser: the stage is not over (c is left)',
    p.stageCompletes, false);
}

// ── 6. Refusals — reported, never thrown ──────────────────────────────────────
{
  const base = {
    stage: stage(['a', 'b']),
    statusByTaskId: statuses({ a: 'completed', b: 'skipped' }),
    requiredTaskCount: 1,
  };
  const unknown = planTaskSkip(base, 'zzz');
  eq('unknown task id is refused', unknown.ok, false);
  eq('unknown task id names the reason', unknown.reason, 'taskNotInStage');
  const done = planTaskSkip(base, 'a');
  eq('an already completed task is refused', done.ok, false);
  eq('an already completed task names the reason', done.reason, 'taskAlreadyTerminal');
  const already = planTaskSkip(base, 'b');
  eq('an already skipped task is refused (a repeat skip is a no-op)', already.ok, false);
  eq('an already skipped task names the reason', already.reason, 'taskAlreadyTerminal');
  ok('a refusal never claims a station slot', !unknown.heldSlot && !done.heldSlot && !already.heldSlot);
  ok('a refusal never claims the stage completed',
    !unknown.stageCompletes && !done.stageCompletes && !already.stageCompletes);
}

// ── 7. heldSlot is true ONLY for an assigned record ────────────────────────────
{
  const s = stage(['a', 'b']);
  const held = planTaskSkip({ stage: s, statusByTaskId: statuses({ a: 'assigned', b: 'unassigned' }) }, 'a');
  const queued = planTaskSkip({ stage: s, statusByTaskId: statuses({ a: 'assigned', b: 'unassigned' }) }, 'b');
  eq('an assigned record holds a station slot', held.heldSlot, true);
  eq('an unassigned record holds nothing', queued.heldSlot, false);
  eq('a queued task may be skipped too', queued.ok, true);
}

// ── 8. An absent requirement means "all tasks" ────────────────────────────────
{
  const p = planTaskSkip({
    stage: stage(['a', 'b', 'c']),
    statusByTaskId: statuses({ a: 'unassigned', b: 'unassigned', c: 'unassigned' }),
  }, 'c');
  eq('unset requirement is treated as every task, then lowered to 2', p.requiredTaskCount, 2);
  eq('unset requirement: the drop is reported', p.requirementLowered, true);
  eq('unset requirement: the stage does not complete', p.stageCompletes, false);
}

// ── 9. Garbage in — total, finite, never negative, never NaN ──────────────────
{
  const junkCases: { label: string; input: Parameters<typeof planTaskSkip>[0] }[] = [
    {
      label: 'requirement NaN',
      input: { stage: stage(['a', 'b']), statusByTaskId: statuses({ a: 'assigned', b: 'unassigned' }), requiredTaskCount: NaN },
    },
    {
      label: 'requirement negative',
      input: { stage: stage(['a', 'b']), statusByTaskId: statuses({ a: 'assigned', b: 'unassigned' }), requiredTaskCount: -4 },
    },
    {
      label: 'requirement above the task count',
      input: { stage: stage(['a', 'b']), statusByTaskId: statuses({ a: 'assigned', b: 'unassigned' }), requiredTaskCount: 99 },
    },
    {
      label: 'requirement not a number',
      input: { stage: stage(['a', 'b']), statusByTaskId: statuses({ a: 'assigned', b: 'unassigned' }), requiredTaskCount: '2' as unknown as number },
    },
    {
      label: 'no tasks array',
      input: { stage: {} as SkipTaskStage, statusByTaskId: {}, requiredTaskCount: 2 },
    },
    {
      label: 'null exclusive groups',
      input: {
        stage: { tasks: [{ id: 'a' }], exclusiveGroups: null as unknown as [] },
        statusByTaskId: statuses({ a: 'assigned' }),
      },
    },
    {
      label: 'statuses absent entirely',
      input: { stage: stage(['a', 'b']), statusByTaskId: {} as Record<string, Status> },
    },
  ];
  for (const c of junkCases) {
    let threw: string | null = null;
    let out: ReturnType<typeof planTaskSkip> | null = null;
    try { out = planTaskSkip(c.input, 'a'); } catch (e) { threw = (e as Error).message; }
    ok(`${c.label}: does not throw`, threw === null, threw ?? '');
    if (!out) continue;
    ok(`${c.label}: the requirement is a finite non-negative number`,
      Number.isFinite(out.requiredTaskCount) && out.requiredTaskCount >= 0,
      String(out.requiredTaskCount));
    ok(`${c.label}: attainableAfter is a finite non-negative number`,
      Number.isFinite(out.attainableAfter) && out.attainableAfter >= 0,
      String(out.attainableAfter));
    ok(`${c.label}: completedCount is a finite non-negative number`,
      Number.isFinite(out.completedCount) && out.completedCount >= 0,
      String(out.completedCount));
    ok(`${c.label}: remainingTaskIds is an array`, Array.isArray(out.remainingTaskIds));
  }
}

// ── 10. Purity — the inputs are never mutated ────────────────────────────────
{
  const s = stage(['a', 'b', 'c'], [{ id: 'g1', taskIds: ['a', 'b'] }]);
  const st = statuses({ a: 'assigned', b: 'unassigned', c: 'unassigned' });
  const beforeStage = JSON.stringify(s);
  const beforeStatuses = JSON.stringify(st);
  planTaskSkip({ stage: s, statusByTaskId: st, requiredTaskCount: 3 }, 'a');
  eq('the authored stage is not mutated', JSON.stringify(s), beforeStage);
  eq('the team status map is not mutated', JSON.stringify(st), beforeStatuses);
}

// ── 11. The skipped task is never reported as still playable ──────────────────
{
  const p = planTaskSkip({
    stage: stage(['a', 'b', 'c']),
    statusByTaskId: statuses({ a: 'assigned', b: 'completed', c: 'skipped' }),
    requiredTaskCount: 1,
  }, 'a');
  ok('the just-skipped task is absent from remainingTaskIds', !p.remainingTaskIds.includes('a'));
  ok('a completed task is absent from remainingTaskIds', !p.remainingTaskIds.includes('b'));
  ok('a previously skipped task is absent from remainingTaskIds', !p.remainingTaskIds.includes('c'));
  eq('nothing playable is left, so the stage completes', p.stageCompletes, true);
}

console.log('');
if (failures > 0) {
  console.error(`✗ skip-single-task: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ skip-single-task: all assertions passed');
