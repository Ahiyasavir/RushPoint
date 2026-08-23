// Builder header stage/mission breadcrumb (change: builder-clarity-mission-hierarchy).
// Pure derivation, testable without a component runner — see builderBreadcrumb.ts.
import { describe, it, expect } from 'vitest';
import { builderBreadcrumbState, type BreadcrumbStage } from './builderBreadcrumb';

const PLACEHOLDERS = { untitledStage: 'Untitled stage', untitledMission: 'Untitled mission' };

const STAGES: BreadcrumbStage[] = [
  { id: 's1', title: 'Old City', tasks: [{ id: 't1', title: 'Find the gate' }, { id: 't2', title: 'Find the fountain' }] },
  { id: 's2', title: '', tasks: [{ id: 't3', title: '' }] },
];

describe('builderBreadcrumbState', () => {
  it('returns stage-only when no mission is open (wizard closed)', () => {
    const r = builderBreadcrumbState(STAGES, 's1', null, PLACEHOLDERS);
    expect(r).toEqual({ stageNumber: 1, stageName: 'Old City', mission: null });
  });

  it('returns stage + mission when the wizard is open, with a 1-based mission index within its stage', () => {
    const r = builderBreadcrumbState(STAGES, 's1', 't2', PLACEHOLDERS);
    expect(r).toEqual({
      stageNumber: 1,
      stageName: 'Old City',
      mission: { number: 2, name: 'Find the fountain' },
    });
  });

  it('falls back to the untitled-stage placeholder for an empty stage title', () => {
    const r = builderBreadcrumbState(STAGES, 's2', null, PLACEHOLDERS);
    expect(r?.stageName).toBe('Untitled stage');
  });

  it('falls back to the untitled-mission placeholder for an empty mission title', () => {
    const r = builderBreadcrumbState(STAGES, 's2', 't3', PLACEHOLDERS);
    expect(r?.mission).toEqual({ number: 1, name: 'Untitled mission' });
  });

  it('reports the correct 1-based index for the second stage in the game', () => {
    const r = builderBreadcrumbState(STAGES, 's2', null, PLACEHOLDERS);
    expect(r?.stageNumber).toBe(2);
  });

  it('returns null when the stage id matches nothing (e.g. a brand new empty game)', () => {
    expect(builderBreadcrumbState(STAGES, 'missing', null, PLACEHOLDERS)).toBeNull();
    expect(builderBreadcrumbState(STAGES, null, null, PLACEHOLDERS)).toBeNull();
  });

  it('omits the mission segment when the open task id does not belong to the current stage', () => {
    const r = builderBreadcrumbState(STAGES, 's1', 't3', PLACEHOLDERS);
    expect(r?.mission).toBeNull();
  });
});
