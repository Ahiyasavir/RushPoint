import { describe, it, expect } from 'vitest';
import { isSoloSelfGuidedRun, soloRunReadyToAutoFinalize } from './soloAutoFinalize';

describe('isSoloSelfGuidedRun', () => {
  it('is true for the instant-play shape (selfGuided + single participant)', () => {
    expect(isSoloSelfGuidedRun({ selfGuided: true, participantCount: 1, status: 'live' })).toBe(true);
  });

  it('defaults an absent participantCount to a single participant', () => {
    expect(isSoloSelfGuidedRun({ selfGuided: true, status: 'live' })).toBe(true);
  });

  it('is false when the run is not self-guided (a normal organizer run)', () => {
    // The safety-critical case: a launched, non-self-guided run must NEVER be a candidate.
    expect(isSoloSelfGuidedRun({ selfGuided: false, participantCount: 1, status: 'live' })).toBe(false);
    expect(isSoloSelfGuidedRun({ participantCount: 1, status: 'live' })).toBe(false);
  });

  it('is false when there is more than one participant', () => {
    expect(isSoloSelfGuidedRun({ selfGuided: true, participantCount: 2, status: 'live' })).toBe(false);
  });

  it('is false for an undefined run doc', () => {
    expect(isSoloSelfGuidedRun(undefined)).toBe(false);
  });
});

describe('soloRunReadyToAutoFinalize', () => {
  const solo = { selfGuided: true, participantCount: 1, status: 'live' } as const;

  it('is true for a solo self-guided run whose single team just finished', () => {
    expect(soloRunReadyToAutoFinalize(solo, 1, 'finished')).toBe(true);
  });

  it('is false while the sole team is still active', () => {
    expect(soloRunReadyToAutoFinalize(solo, 1, 'active')).toBe(false);
  });

  it('is false once the run is already finished (idempotency backstop)', () => {
    expect(soloRunReadyToAutoFinalize({ ...solo, status: 'finished' }, 1, 'finished')).toBe(false);
  });

  it('is false when the run is not self-guided, even if a single team finished', () => {
    // Regression guard: a normal organizer run must wait for manual finalizeRun.
    expect(
      soloRunReadyToAutoFinalize({ selfGuided: false, participantCount: 1, status: 'live' }, 1, 'finished'),
    ).toBe(false);
  });

  it('is false when more than one team exists (multi-team run)', () => {
    expect(soloRunReadyToAutoFinalize(solo, 2, 'finished')).toBe(false);
  });

  it('is false when there are zero teams', () => {
    expect(soloRunReadyToAutoFinalize(solo, 0, undefined)).toBe(false);
  });

  it('is false when participantCount indicates a multi-participant run', () => {
    expect(
      soloRunReadyToAutoFinalize({ selfGuided: true, participantCount: 3, status: 'live' }, 1, 'finished'),
    ).toBe(false);
  });
});
