// updateGame's contract for `wizardSteps` (change: quick-setup-wizard).
//
// The callable itself needs an emulator, so what is pinned here is the DECISION the
// callable delegates to: given a payload value and the stages being saved, what gets
// written? Two rules carry it, and both are lessons this repo already paid for:
//
//   • MALFORMED IS LOUD. A client that invents a shape is refused with
//     invalid-argument, never silently stored — the sanitizer-allowlist doctrine.
//   • DANGLING IS QUIET. A step pointing at a mission the creator just deleted is
//     DROPPED, not refused. Refusing would freeze autosave on a pointer the creator
//     never authored, which is exactly how one rejected optional field once locked a
//     creator out of saving at all (change: builder-clear-optional-field).
import { describe, it, expect } from 'vitest';
import type { Stage } from '@rushpoint/shared';
import { normalizeWizardSteps, pruneWizardSteps } from '@rushpoint/shared';

const stages: Stage[] = [
  {
    id: 's1', order: 0, title: 'שלב 1',
    tasks: [{
      id: 't1', title: 'משימה', type: 'field', coordinates: { lat: 0, lng: 0 },
      difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 5,
    }],
  } as Stage,
];

const valid = {
  id: 'qs-t1-coordinates', stageId: 's1', taskId: 't1',
  targetFieldPath: 'coordinates', instructionPrompt: 'שימו סיכה על המפה', isRequired: true,
};

describe('updateGame wizardSteps normalization', () => {
  it('leaves the stored steps alone when the field is not sent', () => {
    expect(normalizeWizardSteps(undefined)).toBeUndefined();
  });

  it('treats an explicit null as a clear', () => {
    expect(normalizeWizardSteps(null)).toEqual([]);
  });

  it('keeps a valid array, exactly as declared', () => {
    expect(normalizeWizardSteps([valid])).toEqual([valid]);
  });

  it('refuses anything that is not an array of steps', () => {
    expect(normalizeWizardSteps('steps')).toBeNull();
    expect(normalizeWizardSteps([42])).toBeNull();
    expect(normalizeWizardSteps([{ ...valid, id: '' }])).toBeNull();
    expect(normalizeWizardSteps([{ ...valid, targetFieldPath: '  ' }])).toBeNull();
    expect(normalizeWizardSteps([{ ...valid, isRequired: 'yes' }])).toBeNull();
  });

  it('does not let an unknown member ride along onto the document', () => {
    const [stored] = normalizeWizardSteps([{ ...valid, ownerUid: 'someone-else' }]) ?? [];
    expect(stored).not.toHaveProperty('ownerUid');
  });

  it('drops a step whose mission was deleted instead of refusing the save', () => {
    const steps = normalizeWizardSteps([valid, { ...valid, id: 'orphan', taskId: 'deleted' }]) ?? [];
    expect(steps).toHaveLength(2);
    expect(pruneWizardSteps(steps, stages).map((s) => s.id)).toEqual(['qs-t1-coordinates']);
  });

  it('keeps a game-level step, which has nothing to dangle', () => {
    const steps = normalizeWizardSteps([{ id: 'name', targetFieldPath: 'title' }]) ?? [];
    expect(pruneWizardSteps(steps, stages)).toHaveLength(1);
  });
});
