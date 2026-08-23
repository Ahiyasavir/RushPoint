import { describe, expect, it } from 'vitest';
import { parseScoreDelta } from '../scoreAdjustment';

describe('parseScoreDelta', () => {
  it('accepts a plain, signed or spaced whole number', () => {
    expect(parseScoreDelta('50')).toBe(50);
    expect(parseScoreDelta('+50')).toBe(50);
    expect(parseScoreDelta('-50')).toBe(-50);
    expect(parseScoreDelta('  25  ')).toBe(25);
  });

  it('accepts the unicode minus a Hebrew keyboard produces', () => {
    expect(parseScoreDelta('−10')).toBe(-10);
    expect(parseScoreDelta('‒10')).toBe(-10);
  });

  // The bug: `parseInt(v) || 0` turned garbage into a zero-delta adjustment that
  // still hit adjustTeamScore AND wrote an audit-log entry.
  it('rejects input that is not a number instead of submitting a zero delta', () => {
    for (const bad of ['', '   ', 'abc', '+', '-', '1e5!', 'NaN', '--5']) {
      expect(parseScoreDelta(bad), bad).toBeNull();
    }
    expect(parseScoreDelta(null)).toBeNull();
    expect(parseScoreDelta(undefined)).toBeNull();
  });

  it('rejects a trailing-garbage number rather than silently truncating it', () => {
    // parseInt('50abc') was 50; a typo must not become a scoring decision.
    expect(parseScoreDelta('50abc')).toBeNull();
    expect(parseScoreDelta('5 0')).toBeNull();
  });

  it('rejects an explicit zero: it is a no-op that still writes an audit entry', () => {
    expect(parseScoreDelta('0')).toBeNull();
    expect(parseScoreDelta('+0')).toBeNull();
    expect(parseScoreDelta('-0')).toBeNull();
  });

  it('rounds a fractional entry to a whole number of points', () => {
    expect(parseScoreDelta('10.6')).toBe(11);
    expect(parseScoreDelta('-10.6')).toBe(-11);
  });

  it('clamps an absurd entry to the allowed range', () => {
    expect(parseScoreDelta('999999999')).toBe(100000);
    expect(parseScoreDelta('-999999999')).toBe(-100000);
  });
});
