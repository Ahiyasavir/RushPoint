import { describe, it, expect } from 'vitest';
import { canReceiveTaskAssignment } from './consentGate';

describe('canReceiveTaskAssignment', () => {
  it('allows a launched team (the only eligible state)', () => {
    expect(canReceiveTaskAssignment({ launched: true })).toBe(true);
  });

  it('refuses a held team whose launched flag is false', () => {
    expect(canReceiveTaskAssignment({ launched: false })).toBe(false);
  });

  it('refuses a team with no launched flag at all', () => {
    expect(canReceiveTaskAssignment({})).toBe(false);
  });

  // TOTAL / never-throws: anything that is not the literal boolean `true` is
  // ineligible, and no input shape may make the predicate throw.
  it.each([
    undefined,
    null,
    { launched: undefined },
    { launched: null },
    { launched: 'true' },
    { launched: 1 },
    { launched: {} },
    'garbage',
    42,
  ])('refuses garbage input without throwing: %o', (input) => {
    expect(canReceiveTaskAssignment(input as never)).toBe(false);
  });
});
