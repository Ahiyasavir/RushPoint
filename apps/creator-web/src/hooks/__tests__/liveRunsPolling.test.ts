import { describe, expect, it } from 'vitest';
import type { LiveRunSummary } from '@rushpoint/shared';
import {
  LIVE_RUNS_POLL_MS,
  barMode,
  pollDelayFor,
  selectFeaturedRun,
  shouldShowBar,
} from '../liveRunsPolling';

function run(over: Partial<LiveRunSummary> & { runId: string }): LiveRunSummary {
  return {
    ownerUid: 'o1',
    gameId: 'g1',
    gameTitle: 'Game',
    accessCode: 'ABC123',
    participantCount: 0,
    launchedAt: null,
    unackedAlerts: 0,
    ...over,
  };
}

describe('liveRunsPolling — poll cadence', () => {
  it('polls every 10s while visible with subscribers', () => {
    expect(LIVE_RUNS_POLL_MS).toBe(10_000);
    expect(pollDelayFor({ hidden: false, subscribers: 1 })).toBe(10_000);
  });

  it('pauses (null) while the tab is hidden', () => {
    expect(pollDelayFor({ hidden: true, subscribers: 3 })).toBeNull();
  });

  it('pauses (null) when nothing is subscribed', () => {
    expect(pollDelayFor({ hidden: false, subscribers: 0 })).toBeNull();
  });
});

describe('liveRunsPolling — featured run selection', () => {
  it('returns null for no runs', () => {
    expect(selectFeaturedRun([])).toBeNull();
    expect(selectFeaturedRun(null)).toBeNull();
  });

  it('returns the only run', () => {
    const a = run({ runId: 'r1' });
    expect(selectFeaturedRun([a])).toBe(a);
  });

  it('prefers the most recently launched run, nulls last', () => {
    const older = run({ runId: 'r1', launchedAt: '2026-07-20T10:00:00.000Z' });
    const newer = run({ runId: 'r2', launchedAt: '2026-07-21T10:00:00.000Z' });
    const never = run({ runId: 'r3', launchedAt: null });
    expect(selectFeaturedRun([older, newer, never])).toBe(newer);
    expect(selectFeaturedRun([never, older])).toBe(older);
  });

  it('tie-breaks deterministically on runId', () => {
    const a = run({ runId: 'aaa', launchedAt: '2026-07-21T10:00:00.000Z' });
    const b = run({ runId: 'bbb', launchedAt: '2026-07-21T10:00:00.000Z' });
    expect(selectFeaturedRun([a, b])).toBe(a);
    expect(selectFeaturedRun([b, a])).toBe(a);
  });
});

describe('liveRunsPolling — bar visibility', () => {
  const featured = run({ runId: 'r1', gameId: 'g1' });

  it('is hidden when unauthenticated or there is no live run', () => {
    expect(shouldShowBar({ authed: false, featured, pathname: '/' })).toBe(false);
    expect(shouldShowBar({ authed: true, featured: null, pathname: '/' })).toBe(false);
  });

  it('is shown on ordinary routes', () => {
    expect(shouldShowBar({ authed: true, featured, pathname: '/' })).toBe(true);
    expect(shouldShowBar({ authed: true, featured, pathname: '/gallery' })).toBe(true);
    expect(shouldShowBar({ authed: true, featured, pathname: '/build/g1' })).toBe(true);
  });

  it('is hidden on the console of the featured run only', () => {
    expect(shouldShowBar({ authed: true, featured, pathname: '/run/g1/r1' })).toBe(false);
    expect(shouldShowBar({ authed: true, featured, pathname: '/run/g9/r9' })).toBe(true);
  });

  it('is hidden on the live-runs overview', () => {
    expect(shouldShowBar({ authed: true, featured, pathname: '/live' })).toBe(false);
  });
});

describe('liveRunsPolling — layout mode', () => {
  it('is compact inside the Builder workspace', () => {
    expect(barMode('/build/g1')).toBe('compact');
  });

  it('is full elsewhere', () => {
    expect(barMode('/')).toBe('full');
    expect(barMode('/gallery')).toBe('full');
    expect(barMode('/settings')).toBe('full');
  });
});
