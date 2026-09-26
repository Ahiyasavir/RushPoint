import { describe, it, expect } from 'vitest';
import { sendBackTargets } from '../sendBackTargets';

// send-team-back: the console's picker offers exactly what returnTeamTo accepts, so an organizer
// is never shown a choice the server will refuse.
const game = [
  { id: 's1', title: 'First', tasks: [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Bravo' }] },
  { id: 's2', title: 'Second', tasks: [{ id: 'x', title: 'Xray' }, { id: 'y', title: 'Yankee' }] },
  { id: 's3', title: 'Third', tasks: [{ id: 'z', title: 'Zulu' }] },
];
const team = [
  { stageId: 's1', status: 'completed', tasks: [{ taskId: 'a', status: 'skipped' }, { taskId: 'b', status: 'completed' }] },
  { stageId: 's2', status: 'active', tasks: [{ taskId: 'x', status: 'assigned' }, { taskId: 'y', status: 'unassigned' }] },
  { stageId: 's3', status: 'locked', tasks: [{ taskId: 'z', status: 'unassigned' }] },
];

describe('sendBackTargets', () => {
  it('lists reached stages only, in game order, with titles', () => {
    const t = sendBackTargets(team, game);
    expect(t.map((s) => s.stageId)).toEqual(['s1', 's2']);
    expect(t[0].title).toBe('First');
  });
  it('a completed stage can be returned to as a whole', () => {
    expect(sendBackTargets(team, game)[0].stageSelectable).toBe(true);
  });
  it('the active stage can be returned to only when something in it was skipped', () => {
    expect(sendBackTargets(team, game)[1].stageSelectable).toBe(false);
  });
  it('completed and skipped missions are selectable; the current and unplayed ones are not', () => {
    const [s1, s2] = sendBackTargets(team, game);
    expect(s1.missions.map((m) => [m.taskId, m.status, m.selectable])).toEqual([
      ['a', 'skipped', true], ['b', 'done', true],
    ]);
    expect(s2.missions.map((m) => [m.taskId, m.status, m.selectable])).toEqual([
      ['x', 'current', false], ['y', 'open', false],
    ]);
  });
  it('reports when there is nothing to send back to', () => {
    const fresh = [{ stageId: 's1', status: 'active', tasks: [{ taskId: 'a', status: 'assigned' }] }];
    expect(sendBackTargets(fresh, game).every((s) => !s.stageSelectable && s.missions.every((m) => !m.selectable))).toBe(true);
  });
  it('is total over malformed input', () => {
    expect(sendBackTargets(null as never, null as never)).toEqual([]);
    expect(sendBackTargets([{}] as never, game)).toEqual([]);
  });
});
