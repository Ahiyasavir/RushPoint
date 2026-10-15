// change: self-healing-entry. The phone reports each lost sign-in so the server can SEE what it was
// blind to on 14.10 (no user agent, no client errors: the early warning at 27.9 was invisible). The
// payload is untrusted input from an anonymous phone, so it is a closed, size-capped shape.
import { describe, expect, test } from 'vitest';
import { parseClientEvent, MAX_USER_AGENT_LEN } from './clientEvents';

const valid = { kind: 'authLost', outcome: 'reinstated', phase: 'join', msSinceSignIn: 11000, userAgent: 'Mozilla/5.0 (iPhone)' };

describe('parseClientEvent', () => {
  test('accepts a well-formed authLost report', () => {
    expect(parseClientEvent(valid)).toEqual(valid);
  });

  test('accepts every outcome and phase the phone sends', () => {
    for (const outcome of ['reinstated', 'freshSignIn', 'failed']) {
      for (const phase of ['join', 'play']) {
        expect(parseClientEvent({ ...valid, outcome, phase })).not.toBeNull();
      }
    }
  });

  test('refuses an unknown kind, outcome or phase', () => {
    expect(parseClientEvent({ ...valid, kind: 'whatever' })).toBeNull();
    expect(parseClientEvent({ ...valid, outcome: 'maybe' })).toBeNull();
    expect(parseClientEvent({ ...valid, phase: 'lobby' })).toBeNull();
  });

  test('refuses an oversized user agent rather than storing it', () => {
    expect(parseClientEvent({ ...valid, userAgent: 'x'.repeat(MAX_USER_AGENT_LEN + 1) })).toBeNull();
  });

  test('refuses extra fields: nothing unexpected reaches the log', () => {
    expect(parseClientEvent({ ...valid, displayName: 'a child' })).toBeNull();
  });

  test('a missing or nonsensical time becomes -1, never a crash', () => {
    expect(parseClientEvent({ ...valid, msSinceSignIn: 'soon' })?.msSinceSignIn).toBe(-1);
    expect(parseClientEvent({ ...valid, msSinceSignIn: -5 })?.msSinceSignIn).toBe(-1);
    expect(parseClientEvent({ ...valid, msSinceSignIn: Number.NaN })?.msSinceSignIn).toBe(-1);
  });

  test('is total: malformed input is refused, never thrown', () => {
    for (const bad of [undefined, null, 42, 'x', [], {}]) {
      expect(() => parseClientEvent(bad)).not.toThrow();
      expect(parseClientEvent(bad)).toBeNull();
    }
  });
});
