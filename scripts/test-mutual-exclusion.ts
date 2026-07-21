// Pure-logic test for mutually exclusive task groups (change: mutually-exclusive-tasks).
// A stage may declare `exclusiveGroups`: sets of its own task ids of which a team may
// complete at most ONE — completing a member locks (skips) the rest. These helpers are
// the single source of truth shared by the Builder validator, the routing filter and the
// completeTaskForTeam enforcement, so they must be exactly specified. No emulator.
//   npx tsx scripts/test-mutual-exclusion.ts
import {
  effectiveExclusiveGroups,
  exclusiveGroupOf,
  resolveExclusions,
  blockedTaskIds,
  maxAttainableCompletions,
  validateExclusiveGroups,
} from '../packages/shared/src/mutualExclusion';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const eq = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const eq2 = (a: string[][], b: string[][]) => a.length === b.length && a.every((g, i) => eq(g, b[i]));
const stage = (ids: string[], groups?: { id: string; taskIds: string[] }[], requiredTaskCount?: number) => ({
  tasks: ids.map((id) => ({ id })),
  ...(groups ? { exclusiveGroups: groups } : {}),
  ...(requiredTaskCount !== undefined ? { requiredTaskCount } : {}),
});

// ── effectiveExclusiveGroups: normalization is where every "inert" rule lives ──
check('no groups ⇒ []', eq2(effectiveExclusiveGroups(stage(['a', 'b'])), []));
check('empty groups array ⇒ []', eq2(effectiveExclusiveGroups(stage(['a', 'b'], [])), []));
check('plain group survives', eq2(
  effectiveExclusiveGroups(stage(['a', 'b', 'c'], [{ id: 'g', taskIds: ['a', 'b'] }])), [['a', 'b']]));
check('unknown ids stripped', eq2(
  effectiveExclusiveGroups(stage(['a', 'b'], [{ id: 'g', taskIds: ['a', 'b', 'zz'] }])), [['a', 'b']]));
check('group of 1 after stripping ⇒ inert', eq2(
  effectiveExclusiveGroups(stage(['a'], [{ id: 'g', taskIds: ['a', 'zz'] }])), []));
check('group of 1 ⇒ inert', eq2(
  effectiveExclusiveGroups(stage(['a', 'b'], [{ id: 'g', taskIds: ['a'] }])), []));
check('empty group ⇒ inert', eq2(
  effectiveExclusiveGroups(stage(['a', 'b'], [{ id: 'g', taskIds: [] }])), []));
check('duplicate id inside one group deduped ⇒ inert', eq2(
  effectiveExclusiveGroups(stage(['a', 'b'], [{ id: 'g', taskIds: ['a', 'a'] }])), []));
// A contested id belongs to the FIRST group; the second is then left with one id
// and goes inert (the schema says a task may appear in at most one group).
check('first group wins a contested id', eq2(
  effectiveExclusiveGroups(stage(['a', 'b', 'c'], [
    { id: 'g1', taskIds: ['a', 'b'] },
    { id: 'g2', taskIds: ['b', 'c'] },
  ])), [['a', 'b']]),
  JSON.stringify(effectiveExclusiveGroups(stage(['a', 'b', 'c'], [
    { id: 'g1', taskIds: ['a', 'b'] }, { id: 'g2', taskIds: ['b', 'c'] }]))));
check('two disjoint groups both survive', eq2(
  effectiveExclusiveGroups(stage(['a', 'b', 'c', 'd'], [
    { id: 'g1', taskIds: ['a', 'b'] },
    { id: 'g2', taskIds: ['c', 'd'] },
  ])), [['a', 'b'], ['c', 'd']]));
check('member order follows stage task order', eq2(
  effectiveExclusiveGroups(stage(['a', 'b', 'c'], [{ id: 'g', taskIds: ['c', 'a'] }])), [['a', 'c']]));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
check('malformed (non-array) taskIds ⇒ inert', eq2(
  effectiveExclusiveGroups({ tasks: [{ id: 'a' }], exclusiveGroups: [{ id: 'g', taskIds: undefined }] } as any), []));

// ── exclusiveGroupOf ──
const s3 = stage(['a', 'b', 'c'], [{ id: 'g', taskIds: ['a', 'b'] }]);
check('group of a member', eq(exclusiveGroupOf(s3, 'a') ?? [], ['a', 'b']));
check('ungrouped task ⇒ null', exclusiveGroupOf(s3, 'c') === null);
check('unknown task ⇒ null', exclusiveGroupOf(s3, 'zz') === null);

// ── resolveExclusions: the ids completeTaskForTeam must auto-skip ──
check('siblings of a', eq(resolveExclusions(s3, 'a'), ['b']));
check('siblings of b', eq(resolveExclusions(s3, 'b'), ['a']));
check('ungrouped ⇒ []', eq(resolveExclusions(s3, 'c'), []));
check('unknown ⇒ []', eq(resolveExclusions(s3, 'zz'), []));
check('3 way group ⇒ two siblings, stage order', eq(
  resolveExclusions(stage(['a', 'b', 'c'], [{ id: 'g', taskIds: ['c', 'b', 'a'] }]), 'b'), ['a', 'c']));
check('inert group ⇒ no siblings', eq(
  resolveExclusions(stage(['a', 'b'], [{ id: 'g', taskIds: ['a'] }]), 'a'), []));

// ── blockedTaskIds ──
const s4 = stage(['a', 'b', 'c', 'd'], [
  { id: 'g1', taskIds: ['a', 'b'] },
  { id: 'g2', taskIds: ['c', 'd'] },
]);
check('nothing completed ⇒ nothing blocked', eq(blockedTaskIds(s4, []), []));
check('a completed ⇒ b blocked', eq(blockedTaskIds(s4, ['a']), ['b']));
check('a + c completed ⇒ b + d blocked', eq(blockedTaskIds(s4, ['a', 'c']), ['b', 'd']));
check('a completed does not block a itself', !blockedTaskIds(s4, ['a']).includes('a'));
check('both members completed (legacy run) ⇒ neither blocked', eq(blockedTaskIds(s4, ['a', 'b']), []));
check('ungrouped completion blocks nothing', eq(
  blockedTaskIds(stage(['a', 'b', 'c'], [{ id: 'g', taskIds: ['a', 'b'] }]), ['c']), []));
check('blocked ids are in stage order', eq(
  blockedTaskIds(stage(['a', 'b', 'c'], [{ id: 'g', taskIds: ['a', 'b', 'c'] }]), ['b']), ['a', 'c']));
check('unknown completed id ignored', eq(blockedTaskIds(s4, ['zz']), []));
check('idempotent under duplicate completed ids', eq(blockedTaskIds(s4, ['a', 'a']), ['b']));

// ── maxAttainableCompletions + the requiredTaskCount interaction ──
check('no groups ⇒ all tasks attainable', maxAttainableCompletions(stage(['a', 'b', 'c'])) === 3);
check('one group of 2 of 3 ⇒ 2', maxAttainableCompletions(s3) === 2);
check('two groups of 2 of 4 ⇒ 2', maxAttainableCompletions(s4) === 2);
check('inert group does not lower the ceiling',
  maxAttainableCompletions(stage(['a', 'b'], [{ id: 'g', taskIds: ['a'] }])) === 2);

// ── validateExclusiveGroups ──
const v = (st: Parameters<typeof validateExclusiveGroups>[0]) => validateExclusiveGroups(st);
check('clean stage ⇒ no findings', v(s4).errors.length === 0 && v(s4).warnings.length === 0);
check('no groups ⇒ no findings',
  v(stage(['a', 'b'])).errors.length === 0 && v(stage(['a', 'b'])).warnings.length === 0);
const dup = v(stage(['a', 'b', 'c'], [
  { id: 'g1', taskIds: ['a', 'b'] },
  { id: 'g2', taskIds: ['b', 'c'] },
]));
check('task in two groups ⇒ error', dup.errors.length === 1, JSON.stringify(dup));
check('duplicate group id ⇒ error', v(stage(['a', 'b', 'c', 'd'], [
  { id: 'g', taskIds: ['a', 'b'] },
  { id: 'g', taskIds: ['c', 'd'] },
])).errors.some((e) => e.includes('g')));
check('same task twice in one group ⇒ error', v(stage(['a', 'b'], [
  { id: 'g', taskIds: ['a', 'a', 'b'] },
])).errors.length === 1);
check('unknown id ⇒ warning not error', (() => {
  const r = v(stage(['a', 'b'], [{ id: 'g', taskIds: ['a', 'b', 'zz'] }]));
  return r.errors.length === 0 && r.warnings.length === 1;
})());
check('group smaller than 2 ⇒ warning not error', (() => {
  const r = v(stage(['a', 'b'], [{ id: 'g', taskIds: ['a'] }]));
  return r.errors.length === 0 && r.warnings.length === 1;
})());
check('requiredTaskCount above the ceiling ⇒ warning', (() => {
  const r = v(stage(['a', 'b', 'c', 'd'], [
    { id: 'g1', taskIds: ['a', 'b'] },
    { id: 'g2', taskIds: ['c', 'd'] },
  ], 3));
  return r.errors.length === 0 && r.warnings.length === 1;
})());
check('requiredTaskCount at the ceiling ⇒ clean', v(stage(['a', 'b', 'c', 'd'], [
  { id: 'g1', taskIds: ['a', 'b'] },
  { id: 'g2', taskIds: ['c', 'd'] },
], 2)).warnings.length === 0);
// An UNSET requiredTaskCount must never warn: "pick one of these three" is the
// normal authoring shape, and applyStageCompletion's allTerminal test completes the
// stage once the losers are skipped. Only an EXPLICIT count above the ceiling is a
// mistake worth surfacing (it silently ends the stage with fewer completions).
check('unset requiredTaskCount + a group ⇒ no warning',
  v(stage(['a', 'b', 'c'], [{ id: 'g', taskIds: ['a', 'b'] }])).warnings.length === 0);

console.log(`\n${failures === 0 ? 'ALL MUTUAL-EXCLUSION TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
