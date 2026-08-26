import { describe, expect, it } from 'vitest';
import {
  TEAMS_POLL_BASE_MS,
  TEAMS_POLL_MAX_MS,
  teamsFingerprint,
  teamsPollDelayFor,
} from '../runConsolePolling';

describe('teamsPollDelayFor', () => {
  it('polls at the base interval while the board is changing', () => {
    expect(teamsPollDelayFor({ hidden: false, runStatus: 'live', quietPolls: 0 }))
      .toBe(TEAMS_POLL_BASE_MS);
  });

  it('pauses entirely while the tab is hidden — nobody is looking', () => {
    expect(teamsPollDelayFor({ hidden: true, runStatus: 'live', quietPolls: 0 })).toBeNull();
  });

  it('pauses on a finished run — its teams can never change again', () => {
    expect(teamsPollDelayFor({ hidden: false, runStatus: 'finished', quietPolls: 0 })).toBeNull();
  });

  it('backs off as the board stays quiet, and never past the cap', () => {
    const d1 = teamsPollDelayFor({ hidden: false, runStatus: 'live', quietPolls: 4 })!;
    const d2 = teamsPollDelayFor({ hidden: false, runStatus: 'live', quietPolls: 12 })!;
    expect(d1).toBeGreaterThan(TEAMS_POLL_BASE_MS);
    expect(d2).toBeGreaterThan(d1);
    expect(teamsPollDelayFor({ hidden: false, runStatus: 'live', quietPolls: 9999 }))
      .toBe(TEAMS_POLL_MAX_MS);
  });

  it('is monotonic — more quiet never polls sooner', () => {
    let prev = 0;
    for (let q = 0; q < 60; q++) {
      const d = teamsPollDelayFor({ hidden: false, runStatus: 'live', quietPolls: q })!;
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d).toBeLessThanOrEqual(TEAMS_POLL_MAX_MS);
      prev = d;
    }
  });

  it('treats an unknown/absent status as live rather than pausing a real run', () => {
    expect(teamsPollDelayFor({ hidden: false, runStatus: undefined, quietPolls: 0 }))
      .toBe(TEAMS_POLL_BASE_MS);
    expect(teamsPollDelayFor({ hidden: false, runStatus: null, quietPolls: 0 }))
      .toBe(TEAMS_POLL_BASE_MS);
  });

  it('a negative or non-finite quiet count degrades to the base interval', () => {
    expect(teamsPollDelayFor({ hidden: false, runStatus: 'live', quietPolls: -5 }))
      .toBe(TEAMS_POLL_BASE_MS);
    expect(teamsPollDelayFor({ hidden: false, runStatus: 'live', quietPolls: NaN }))
      .toBe(TEAMS_POLL_BASE_MS);
  });
});

describe('teamsFingerprint', () => {
  const team = (over: Record<string, unknown> = {}) => ({
    id: 't1', status: 'active', score: 10,
    stages: [{ order: 0, status: 'active', tasks: [{ taskId: 'a', status: 'completed' }] }],
    ...over,
  });

  it('is stable for an unchanged board', () => {
    expect(teamsFingerprint([team()])).toBe(teamsFingerprint([team()]));
  });

  it('changes when a score changes', () => {
    expect(teamsFingerprint([team()])).not.toBe(teamsFingerprint([team({ score: 11 })]));
  });

  it('changes when a team status changes', () => {
    expect(teamsFingerprint([team()])).not.toBe(teamsFingerprint([team({ status: 'finished' })]));
  });

  it('changes when a task within a stage advances', () => {
    const moved = team({
      stages: [{ order: 0, status: 'active', tasks: [{ taskId: 'a', status: 'assigned' }] }],
    });
    expect(teamsFingerprint([team()])).not.toBe(teamsFingerprint([moved]));
  });

  it('changes when a team joins or leaves', () => {
    expect(teamsFingerprint([team()]))
      .not.toBe(teamsFingerprint([team(), team({ id: 't2' })]));
  });

  it('does not depend on the order rows arrive in', () => {
    const a = team(), b = team({ id: 't2', score: 3 });
    expect(teamsFingerprint([a, b])).toBe(teamsFingerprint([b, a]));
  });

  // A fingerprint that throws would take down the console's only view of the field.
  it('never throws on malformed or empty input', () => {
    expect(() => teamsFingerprint([])).not.toThrow();
    expect(() => teamsFingerprint(null as never)).not.toThrow();
    expect(() => teamsFingerprint(undefined as never)).not.toThrow();
    expect(() => teamsFingerprint([{} as never, null as never])).not.toThrow();
    expect(() => teamsFingerprint([{ stages: 'nope' } as never])).not.toThrow();
  });
});
