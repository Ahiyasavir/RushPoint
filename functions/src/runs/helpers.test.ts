import { describe, it, expect } from 'vitest';
import type { Game, RunStageRecord, RunTaskRecord } from '@rushpoint/shared';
import { applyStageCompletion } from './helpers';

// Unit coverage for the extracted stage-completion helper — the single source of
// truth that both completeTaskForTeam and sweepExpiredInFlight now delegate to.
// Pure logic (no Firestore), so it runs in the fast vitest lane.

const NOW = '2026-01-01T00:00:00.000Z';

function task(taskId: string, status: RunTaskRecord['status'], earnedScore = 0): RunTaskRecord {
  return { taskId, taskIndex: 0, status, earnedScore };
}
function stageRec(
  stageId: string,
  status: RunStageRecord['status'],
  tasks: RunTaskRecord[],
  requiredTaskCount?: number,
): RunStageRecord {
  return { stageId, order: 0, status, tasks, ...(requiredTaskCount != null ? { requiredTaskCount } : {}) };
}
// Minimal game — the helper only reads game.stages[].id / .isFinal and the
// next stage's scheduled-release gate (releaseAt / releaseAfterMinutes).
function game(
  stages: Array<{ id: string; isFinal?: boolean; releaseAfterMinutes?: number; releaseAt?: string }>,
): Game {
  return {
    stages: stages.map((s, i) => ({
      id: s.id, order: i, title: s.id, tasks: [],
      ...(s.isFinal ? { isFinal: true } : {}),
      ...(s.releaseAfterMinutes != null ? { releaseAfterMinutes: s.releaseAfterMinutes } : {}),
      ...(s.releaseAt != null ? { releaseAt: s.releaseAt } : {}),
    })),
  } as unknown as Game;
}

describe('applyStageCompletion', () => {
  it('(a) requiredTaskCount met: completes the stage, auto-skips + reports held assigned leftovers', () => {
    const stages = [
      stageRec('s0', 'active', [task('t1', 'completed', 10), task('t2', 'assigned')], 1),
      stageRec('s1', 'locked', [task('t3', 'unassigned')]),
    ];
    const res = applyStageCompletion(stages, 0, game([{ id: 's0' }, { id: 's1' }]), NOW, NOW);

    expect(res.completed).toBe(true);
    expect(res.heldAssignedTaskIds).toEqual(['t2']); // the assigned leftover holds a station slot
    expect(stages[0].status).toBe('completed');
    expect(stages[0].completedAt).toBe(NOW);
    expect(stages[0].earnedScore).toBe(10);
    expect(stages[0].tasks[1].status).toBe('skipped'); // leftover auto-skipped
    expect(stages[1].status).toBe('active'); // next stage (no gate) unlocks
    expect(stages[1].startedAt).toBe(NOW);
  });

  it('(b) a scheduled-release-gated next stage stays locked; an ungated one unlocks', () => {
    // Gated next: releaseAfterMinutes far in the future relative to launch=NOW.
    const gated = [
      stageRec('s0', 'active', [task('t1', 'completed', 5)], 1),
      stageRec('s1', 'locked', [task('t2', 'unassigned')]),
    ];
    const gres = applyStageCompletion(gated, 0, game([{ id: 's0' }, { id: 's1', releaseAfterMinutes: 1000 }]), NOW, NOW);
    expect(gres.completed).toBe(true);
    expect(gated[1].status).toBe('locked'); // gate not open → stays locked

    // Ungated next: unlocks.
    const open = [
      stageRec('s0', 'active', [task('t1', 'completed', 5)], 1),
      stageRec('s1', 'locked', [task('t2', 'unassigned')]),
    ];
    applyStageCompletion(open, 0, game([{ id: 's0' }, { id: 's1' }]), NOW, NOW);
    expect(open[1].status).toBe('active');
  });

  it('(c) a final stage completes but unlocks nothing', () => {
    const stages = [
      stageRec('s0', 'active', [task('t1', 'completed', 7)], 1),
      stageRec('s1', 'locked', [task('t2', 'unassigned')]),
    ];
    const res = applyStageCompletion(stages, 0, game([{ id: 's0', isFinal: true }, { id: 's1' }]), NOW, NOW);
    expect(res.completed).toBe(true);
    expect(stages[0].status).toBe('completed');
    expect(stages[1].status).toBe('locked'); // final stage never advances
  });

  it('(d) a stage that is neither required-met nor all-terminal is untouched', () => {
    const stages = [
      stageRec('s0', 'active', [task('t1', 'completed', 3), task('t2', 'assigned')], 2),
    ];
    const before = JSON.stringify(stages);
    const res = applyStageCompletion(stages, 0, game([{ id: 's0' }]), NOW, NOW);
    expect(res.completed).toBe(false);
    expect(res.heldAssignedTaskIds).toEqual([]);
    expect(JSON.stringify(stages)).toBe(before); // no mutation at all
  });
});
