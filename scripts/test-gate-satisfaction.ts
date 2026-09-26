// An operator's single-mission skip keeps the missions that depend on it
// (change: skip-keeps-the-stage)
//
// Confirmed in production, run oNaUvNrCWRia4Y1b9xOO (2026-09-22): ONE `task_skipped` ("staff skip")
// on f13163ca "קומו ונעלה ציון!" was logged with `stageCompleted: true`, and the team's whole stage 1
// ended skipped. Stage 1 is a chain:
//
//   f13163ca  video   unlockAfter: []
//   2b83fd50  quiz    unlockAfter: [f13163ca]
//   c42b88d4  photo   unlockAfter: [2b83fd50, f13163ca]
//
// `applyStageCompletion` retires "unreachable" tasks first, and `unreachableTaskIds` treated ONLY
// completed/assigned as alive, so a skipped head retired the whole chain and the stage completed.
// That retirement exists for the exclusive-group loser (change unreachable-task-strand) and must keep
// working for it.
import {
  satisfiesGate, gateSatisfiedTaskIds, unreachableTaskIds, isUnlocked,
} from '../packages/shared/src/gating';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const CHAIN = [
  { id: 'f13163ca', unlockAfterTaskIds: [] as string[] },
  { id: '2b83fd50', unlockAfterTaskIds: ['f13163ca'] },
  { id: 'c42b88d4', unlockAfterTaskIds: ['2b83fd50', 'f13163ca'] },
];

console.log('\n— which records satisfy a gate —');
ok('completed satisfies', satisfiesGate({ status: 'completed' }));
ok('an OPERATOR skip satisfies', satisfiesGate({ status: 'skipped', skipCause: 'operator' }));
for (const cause of ['exclusive', 'expired', 'unreachable', 'stageSatisfied', 'operatorStage']) {
  ok(`a ${cause} skip does NOT satisfy`, !satisfiesGate({ status: 'skipped', skipCause: cause }));
}
ok('a legacy skip with no cause does NOT satisfy (records written before this change keep their meaning)',
  !satisfiesGate({ status: 'skipped' }));
ok('assigned / unassigned do not satisfy', !satisfiesGate({ status: 'assigned' }) && !satisfiesGate({ status: 'unassigned' }));
ok('garbage does not satisfy and does not throw',
  !satisfiesGate(null as never) && !satisfiesGate(undefined as never) && !satisfiesGate('x' as never));

console.log('\n— the satisfied-id list across a team\'s stages —');
const stages = [
  { tasks: [{ taskId: 'a', status: 'completed' }, { taskId: 'b', status: 'skipped', skipCause: 'operator' }] },
  { tasks: [{ taskId: 'c', status: 'skipped', skipCause: 'exclusive' }, { taskId: 'd', status: 'assigned' }] },
];
ok('completed + operator-skipped ids, nothing else', eq(gateSatisfiedTaskIds(stages as never), ['a', 'b']),
  JSON.stringify(gateSatisfiedTaskIds(stages as never)));
ok('malformed stages yield []', eq(gateSatisfiedTaskIds(null as never), []) && eq(gateSatisfiedTaskIds([{}] as never), []));

console.log('\n— THE BUG: skipping the head of the production chain retires nothing —');
const afterSkip = { f13163ca: 'skipped', '2b83fd50': 'unassigned', c42b88d4: 'unassigned' } as const;
const causes = { f13163ca: 'operator' } as const;
ok('no task is unreachable after an OPERATOR skip of the head',
  eq(unreachableTaskIds(CHAIN, afterSkip, causes), []), JSON.stringify(unreachableTaskIds(CHAIN, afterSkip, causes)));
ok('the next link unlocks from the satisfied ids', isUnlocked(CHAIN[1], ['f13163ca']));

console.log('\n— what must NOT change —');
ok('an EXCLUSIVE loss of the head still retires the whole chain (unreachable-task-strand)',
  eq(unreachableTaskIds(CHAIN, afterSkip, { f13163ca: 'exclusive' }), ['2b83fd50', 'c42b88d4']));
ok('a legacy skipped head with no recorded cause still retires it, exactly as before',
  eq(unreachableTaskIds(CHAIN, afterSkip), ['2b83fd50', 'c42b88d4']));
ok('an expired head still retires it (a time window on a stop is authored intent)',
  eq(unreachableTaskIds(CHAIN, afterSkip, { f13163ca: 'expired' }), ['2b83fd50', 'c42b88d4']));
ok('a completed head leaves everything reachable',
  eq(unreachableTaskIds(CHAIN, { f13163ca: 'completed', '2b83fd50': 'unassigned', c42b88d4: 'unassigned' }), []));
ok('skipping the MIDDLE link keeps the last one reachable (its other prerequisite is done)',
  eq(unreachableTaskIds(CHAIN,
    { f13163ca: 'completed', '2b83fd50': 'skipped', c42b88d4: 'unassigned' },
    { '2b83fd50': 'operator' }), []));

if (failures > 0) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall passed');
process.exit(0);
