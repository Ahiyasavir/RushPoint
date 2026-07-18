import { describe, it, expect } from 'vitest';
import * as functions from 'firebase-functions';
import { StoredDocError } from '@rushpoint/shared';
import { parseStored } from './validation';

// The functions-side adapter that maps a pure StoredDocError (thrown by the
// shared read-boundary parsers) to an `internal` HttpsError — mirroring how
// `validate()` maps a ValidationError to `invalid-argument`.
describe('parseStored', () => {
  it('maps a StoredDocError to an internal HttpsError naming docType + field', () => {
    try {
      parseStored(() => {
        throw new StoredDocError('RunTeam', 'score', 'must be a finite number');
      });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(functions.https.HttpsError);
      expect((e as functions.https.HttpsError).code).toBe('internal');
      expect((e as Error).message).toContain('RunTeam');
      expect((e as Error).message).toContain('score');
    }
  });

  it('returns the parsed value on success', () => {
    expect(parseStored(() => 42)).toBe(42);
  });

  it('re-raises a non-StoredDocError unchanged', () => {
    const boom = new Error('boom');
    expect(() => parseStored(() => { throw boom; })).toThrow(boom);
  });
});
