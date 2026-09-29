import { describe, expect, it } from 'vitest';
import { buildRoutePicker } from '../routePicker';

// route-team-to-mission: the picker the organizer uses to send ONE team to ANY mission. Every
// mission of every stage is listed with its state, and a blocked one carries EXACTLY what blocks
// it (the server recomputes the same list, packages/shared/src/routeBlockers.ts).
const NOW = Date.parse('2026-09-28T10:00:00.000Z');
const stages = [
  { id: 's1', title: 'One', tasks: [
    { id: 'x', title: 'X' }, { id: 'y', title: 'Y' },
    { id: 'z', title: 'Z', unlockAfterTaskIds: ['x', 'y'] },
  ] },
  { id: 's2', title: 'Two', tasks: [{ id: 'later', title: 'Later' }] },
];
const team = {
  stages: [
    { stageId: 's1', status: 'active', tasks: [
      { taskId: 'x', status: 'completed' }, { taskId: 'y', status: 'assigned' }, { taskId: 'z', status: 'unassigned' },
    ] },
    { stageId: 's2', status: 'locked', tasks: [{ taskId: 'later', status: 'unassigned' }] },
  ],
};
const run = { status: 'live', launchedAt: '2026-09-28T09:00:00.000Z', taskCounts: {} };

describe('buildRoutePicker', () => {
  const picker = buildRoutePicker({ stages, team, run, nowMs: NOW });
  const m = (id: string) => picker.flatMap((s) => s.missions).find((x) => x.taskId === id)!;

  it('lists every mission of every stage, in order', () => {
    expect(picker.map((s) => s.stageId)).toEqual(['s1', 's2']);
    expect(picker.flatMap((s) => s.missions.map((x) => x.taskId))).toEqual(['x', 'y', 'z', 'later']);
  });
  it('marks done and current, which are not choices', () => {
    expect(m('x').state).toBe('done');
    expect(m('y').state).toBe('current');
    expect(m('x').selectable).toBe(false);
    expect(m('y').selectable).toBe(false);
  });
  it('a blocked mission is a choice and carries exactly its blockers', () => {
    expect(m('z').state).toBe('blocked');
    expect(m('z').selectable).toBe(true);
    expect(m('z').blockers.waivable).toEqual([{ kind: 'prerequisites', missing: ['y'] }]);
  });
  it('another stage is blocked by "otherStage" only', () => {
    expect(m('later').state).toBe('blocked');
    expect(m('later').blockers.waivable.map((b) => b.kind)).toEqual(['otherStage']);
  });
  it('a closed mission is shown as unavailable, never a choice', () => {
    const p = buildRoutePicker({ stages, team, run: { ...run, taskStatusOverrides: { z: 'closed' } }, nowMs: NOW });
    const z = p[0].missions.find((x) => x.taskId === 'z')!;
    expect(z.state).toBe('unavailable');
    expect(z.selectable).toBe(false);
  });
  it('an open mission with nothing in the way is "available"', () => {
    const t2 = { stages: [{ ...team.stages[0], tasks: [
      { taskId: 'x', status: 'completed' }, { taskId: 'y', status: 'completed' }, { taskId: 'z', status: 'unassigned' },
    ] }, team.stages[1]] };
    const z = buildRoutePicker({ stages, team: t2, run, nowMs: NOW })[0].missions.find((x) => x.taskId === 'z')!;
    expect(z.state).toBe('available');
    expect(z.blockers.waivable).toEqual([]);
  });
  it('names missing prerequisites by title for the confirm', () => {
    expect(m('z').missingTitles).toEqual(['Y']);
  });
  it('is total over junk', () => {
    expect(() => buildRoutePicker(null as never)).not.toThrow();
    expect(buildRoutePicker(null as never)).toEqual([]);
  });
});
