// Pure-logic test for cloneTemplateStages (change: admin-manage-game-templates).
// No emulator needed — run via `npx tsx scripts/test-clone-template-stages.ts`,
// auto-discovered by scripts/run-unit-tests.mjs (npm test).
import { cloneTemplateStages } from '../functions/src/lib/cloneTemplateStages';
import type { Stage } from '@rushpoint/shared';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

function baseStage(): Stage {
  return {
    id: 's1', order: 0, title: 'Stage 1', requiredTaskCount: 2,
    tasks: [
      {
        id: 't1', title: 'First', type: 'self_report', triggerMode: 'locationless',
        locationless: true, coordinates: { lat: 0, lng: 0 },
        difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 5,
      },
      {
        id: 't2', title: 'Second', type: 'self_report', triggerMode: 'locationless',
        locationless: true, coordinates: { lat: 0, lng: 0 },
        difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 5,
        unlockAfterTaskIds: ['t1'],
      },
      {
        id: 't3', title: 'Third', type: 'self_report', triggerMode: 'locationless',
        locationless: true, coordinates: { lat: 0, lng: 0 },
        difficulty: 1, estimatedMinutes: 1, pointValue: 10, maxConcurrentTeams: 5,
        unlockAfterTaskIds: ['t1', 't2'],
      },
    ],
    exclusiveGroups: [{ id: 'g1', taskIds: ['t2', 't3'] }],
  };
}

// ── 1. Every stage/task id is regenerated ──────────────────────────────────
{
  const [cloned] = cloneTemplateStages([baseStage()]);
  check('stage id regenerated', cloned.id !== 's1');
  const ids = cloned.tasks.map((t) => t.id);
  check('every task id regenerated', ids.every((id) => !['t1', 't2', 't3'].includes(id)), ids);
  check('no duplicate ids within the clone', new Set([cloned.id, ...ids]).size === 1 + ids.length);
}

// ── 2. unlockAfterTaskIds is remapped to the NEW ids, not left dangling ────
{
  const [cloned] = cloneTemplateStages([baseStage()]);
  const [c1, c2, c3] = cloned.tasks;
  check('t2 unlockAfterTaskIds points at cloned t1', c2.unlockAfterTaskIds?.[0] === c1.id,
    { got: c2.unlockAfterTaskIds, expected: c1.id });
  check('t3 unlockAfterTaskIds points at cloned t1 and t2',
    JSON.stringify([...(c3.unlockAfterTaskIds ?? [])].sort()) === JSON.stringify([c1.id, c2.id].sort()),
    c3.unlockAfterTaskIds);
  check('no cloned unlockAfterTaskIds reference an old (source) id',
    cloned.tasks.every((t) => (t.unlockAfterTaskIds ?? []).every((id) => !['t1', 't2', 't3'].includes(id))));
}

// ── 3. exclusiveGroups[].taskIds is remapped the same way ──────────────────
{
  const [cloned] = cloneTemplateStages([baseStage()]);
  const [c1, c2, c3] = cloned.tasks;
  const group = cloned.exclusiveGroups?.[0];
  check('exclusive group taskIds remapped to the new t2/t3 ids',
    JSON.stringify([...(group?.taskIds ?? [])].sort()) === JSON.stringify([c2.id, c3.id].sort()),
    group?.taskIds);
  check('exclusive group id itself is also regenerated', group?.id !== 'g1', group?.id);
  void c1;
}

// ── 4. A reference to an id absent from the source passes through unchanged
//      (fail-open — matches this codebase's convention for non-critical data) ─
{
  const dangling: Stage = {
    ...baseStage(),
    tasks: [
      { ...baseStage().tasks[0], unlockAfterTaskIds: ['no-such-task-id'] },
    ],
  };
  const [cloned] = cloneTemplateStages([dangling]);
  check('unresolved reference passes through unchanged',
    cloned.tasks[0].unlockAfterTaskIds?.[0] === 'no-such-task-id', cloned.tasks[0].unlockAfterTaskIds);
}

// ── 5. All non-id fields are preserved byte-for-byte ───────────────────────
{
  const [cloned] = cloneTemplateStages([baseStage()]);
  check('stage title preserved', cloned.title === 'Stage 1');
  check('stage requiredTaskCount preserved', cloned.requiredTaskCount === 2);
  check('task title/type/points preserved',
    cloned.tasks[0].title === 'First' && cloned.tasks[0].type === 'self_report' && cloned.tasks[0].pointValue === 10);
}

// ── 6. Two calls on the same input never collide ───────────────────────────
{
  const a = cloneTemplateStages([baseStage()]);
  const b = cloneTemplateStages([baseStage()]);
  const idsA = new Set([a[0].id, ...a[0].tasks.map((t) => t.id)]);
  const idsB = [b[0].id, ...b[0].tasks.map((t) => t.id)];
  check('two clones of the same input share no id', idsB.every((id) => !idsA.has(id)));
}

if (failures > 0) {
  console.error(`\n❌ ${failures} failure(s) in test-clone-template-stages.ts`);
  process.exit(1);
} else {
  console.log('\n✅ test-clone-template-stages.ts — all checks passed');
}
