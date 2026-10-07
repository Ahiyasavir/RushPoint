// The claim step of requestNextTask (found 2026-10-07 by the browser sim with 3 teams): the stage
// index and the routed mission were read BEFORE the claim transaction, and the transaction only
// checked "is anything else already in flight". A slow call that finished after the team had
// already COMPLETED that mission wrote it back to `assigned` inside a stage that had since closed
// (record: completedAt set, status 'assigned'). The phone then showed a mission completeTask
// refuses ("This stage is not active yet"), and the team was stuck for good.
import { describe, expect, it } from 'vitest';
import { decideClaim } from './claimDecision';

const stage = (status: string, tasks: [string, string][]) => ({ status, tasks: tasks.map(([taskId, s]) => ({ taskId, status: s })) });

describe('decideClaim', () => {
  it('claims an unassigned mission in the active stage', () => {
    expect(decideClaim([stage('active', [['a', 'unassigned'], ['b', 'unassigned']])], 0, 'a')).toEqual({ kind: 'claim', localIdx: 0 });
  });
  it('hands back what is already in flight (a concurrent assignment won)', () => {
    expect(decideClaim([stage('active', [['a', 'unassigned'], ['b', 'assigned']])], 0, 'a')).toEqual({ kind: 'existing', taskId: 'b' });
  });
  it('never re-assigns a mission the team already COMPLETED', () => {
    expect(decideClaim([stage('active', [['a', 'completed'], ['b', 'unassigned']])], 0, 'a')).toEqual({ kind: 'stale' });
  });
  it('never claims into a stage that has closed since the routing read', () => {
    expect(decideClaim([stage('completed', [['a', 'unassigned']]), stage('active', [['b', 'unassigned']])], 0, 'a')).toEqual({ kind: 'stale' });
  });
  it('never re-opens a skipped mission', () => {
    expect(decideClaim([stage('active', [['a', 'skipped']])], 0, 'a')).toEqual({ kind: 'stale' });
  });
  it('total on missing stage or mission', () => {
    expect(decideClaim([], 0, 'a')).toEqual({ kind: 'stale' });
    expect(decideClaim([stage('active', [['b', 'unassigned']])], 0, 'a')).toEqual({ kind: 'stale' });
  });
});
