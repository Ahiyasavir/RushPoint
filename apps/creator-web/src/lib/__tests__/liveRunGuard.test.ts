import { describe, expect, it } from 'vitest';
import type { LiveRunSummary } from '@rushpoint/shared';
import { decideLaunchOverLiveRun, liveRunToResume } from '../liveRunGuard';

// Race to Zion 14.10 (D06, D09): the run had been launched on 12.10. On the morning, "הפעל ריצה"
// was pressed to open the game, and every press made a NEW live run and jumped to it, so from
// 08:42 to 09:25 the console showed an empty run while teams joined the real one.
function run(over: Partial<LiveRunSummary> & { runId: string }): LiveRunSummary {
  return {
    ownerUid: 'o1', gameId: 'g1', gameTitle: 'Race', accessCode: 'U33X9G',
    participantCount: 0, launchedAt: null, unackedAlerts: 0, ...over,
  };
}

describe('liveRunToResume: is there already a live run of this game to go back to?', () => {
  it('finds the game\'s live run', () => {
    const real = run({ runId: 'real', launchedAt: '2026-10-12T15:00:00.000Z' });
    expect(liveRunToResume('g1', [real])?.runId).toBe('real');
  });

  it('prefers the run with players over an empty newer one (the 14.10 morning)', () => {
    const real = run({ runId: 'real', launchedAt: '2026-10-12T15:00:00.000Z', participantCount: 60 });
    const dup = run({ runId: 'dup', launchedAt: '2026-10-14T05:42:00.000Z' });
    expect(liveRunToResume('g1', [dup, real])?.runId).toBe('real');
  });

  it('ignores a test run: rehearsing never blocks the real launch', () => {
    expect(liveRunToResume('g1', [run({ runId: 't', isTestDrive: true })])).toBeNull();
  });

  it('ignores another game\'s run', () => {
    expect(liveRunToResume('g1', [run({ runId: 'x', gameId: 'g2' })])).toBeNull();
  });

  it('is total: no runs, junk, or no game id is "nothing to resume"', () => {
    expect(liveRunToResume('g1', [])).toBeNull();
    expect(liveRunToResume('g1', null)).toBeNull();
    expect(liveRunToResume('', [run({ runId: 'a' })])).toBeNull();
  });
});

describe('decideLaunchOverLiveRun: the question asked at the launch press', () => {
  const copy = {
    existsBody: ({ when, players }: { when: string; players: number }) => `live since ${when} with ${players}`,
    openCta: 'open', anotherBody: 'another?', anotherCta: 'launch another',
  };
  const real = run({ runId: 'real', launchedAt: '2026-10-12T15:00:00.000Z', participantCount: 60 });
  const ask = (answers: boolean[], runs: () => Promise<LiveRunSummary[]>) => {
    const asked: string[] = [];
    const p = decideLaunchOverLiveRun({
      gameId: 'g1', fetchLiveRuns: runs, copy, formatWhen: (iso) => String(iso),
      confirm: async (m) => { asked.push(m); return answers.shift() ?? false; },
    });
    return { p, asked };
  };

  it('no live run: launches without asking anything', async () => {
    const { p, asked } = ask([], async () => []);
    expect(await p).toEqual({ kind: 'launch' });
    expect(asked).toEqual([]);
  });

  it('a live run exists: "open it" goes back to that run (the 14.10 morning)', async () => {
    const { p, asked } = ask([true], async () => [real]);
    expect(await p).toEqual({ kind: 'open', run: real });
    expect(asked[0]).toContain('60');
  });

  it('declining both questions launches nothing', async () => {
    const { p } = ask([false, false], async () => [real]);
    expect(await p).toEqual({ kind: 'cancel' });
  });

  it('a second live run is still possible, deliberately', async () => {
    const { p, asked } = ask([false, true], async () => [real]);
    expect(await p).toEqual({ kind: 'launch' });
    expect(asked).toHaveLength(2);
  });

  it('fails open: an unreadable run list never blocks a launch', async () => {
    const { p } = ask([], async () => { throw new Error('offline'); });
    expect(await p).toEqual({ kind: 'launch' });
  });
});
