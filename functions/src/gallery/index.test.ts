import { expect, test, describe } from 'vitest';
import { publicTextMatch } from './index';

describe('publicTextMatch — gallery/library text filter', () => {
  test('matches case-insensitively across the provided fields', () => {
    expect(publicTextMatch(['Old City Hunt', 'a walk through history'], 'city')).toBe(true);
    expect(publicTextMatch(['Old City Hunt', 'a walk through history'], 'HISTORY')).toBe(true);
  });

  test('no match returns false', () => {
    expect(publicTextMatch(['Old City Hunt', 'history'], 'beach')).toBe(false);
  });

  test('a missing/undefined/null field never throws (resilience for malformed docs)', () => {
    expect(publicTextMatch([undefined, 'desc'], 'desc')).toBe(true);
    expect(publicTextMatch([undefined, null], 'anything')).toBe(false);
    expect(publicTextMatch([], 'anything')).toBe(false);
  });

  test('an empty/whitespace query matches everything', () => {
    expect(publicTextMatch([undefined], '   ')).toBe(true);
  });
});
