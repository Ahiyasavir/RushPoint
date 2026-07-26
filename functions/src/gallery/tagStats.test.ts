// RED→GREEN unit test for the PURE tag-count merge/diff helper that backs the
// "popular tags" denormalization (change: gallery-popular-tags).
//
// `mergeTagCounts` is the whole hazard surface reduced to a total function of
// data: a publish adds the tags it now carries and removes the ones it dropped,
// counts must never go negative, keys are case-folded + deduped, and an entry
// that reaches zero disappears (so a tag nobody uses can't linger in the doc
// forever). Proving it here means `bumpTagStats` only has to wrap it in a
// transaction — the arithmetic is already trusted.

import { describe, expect, test } from 'vitest';
import { mergeTagCounts } from './tagStats';

describe('mergeTagCounts — the pure count merge/diff', () => {
  test('adds increment counts from an empty base', () => {
    const out = mergeTagCounts({}, ['Park', 'Nature'], []);
    expect(out.park).toEqual({ tag: 'Park', n: 1 });
    expect(out.nature).toEqual({ tag: 'Nature', n: 1 });
  });

  test('adds increment an existing count, keeping the stored casing', () => {
    const out = mergeTagCounts({ park: { tag: 'Park', n: 2 } }, ['park'], []);
    expect(out.park).toEqual({ tag: 'Park', n: 3 });
  });

  test('removes decrement the count', () => {
    const out = mergeTagCounts({ park: { tag: 'Park', n: 3 } }, [], ['PARK']);
    expect(out.park.n).toBe(2);
  });

  test('a count never goes negative — an over-remove floors at 0 and drops', () => {
    const out = mergeTagCounts({ park: { tag: 'Park', n: 1 } }, [], ['park', 'park', 'park']);
    expect(out.park).toBeUndefined();
  });

  test('an entry that reaches exactly 0 is dropped, not left at 0', () => {
    const out = mergeTagCounts({ park: { tag: 'Park', n: 1 } }, [], ['park']);
    expect(out).toEqual({});
  });

  test('keys are lowercased and case-insensitively de-duped within one call', () => {
    const out = mergeTagCounts({}, ['Park', 'PARK', 'park'], []);
    expect(Object.keys(out)).toEqual(['park']);
    expect(out.park.n).toBe(1); // three spellings of one tag = one add
  });

  test('a base entry and an add that differ only in case merge onto one key', () => {
    const out = mergeTagCounts({ Park: { tag: 'Park', n: 2 } }, ['park'], []);
    expect(Object.keys(out)).toEqual(['park']);
    expect(out.park.n).toBe(3);
  });

  test('adds and removes in the same call both apply', () => {
    const out = mergeTagCounts(
      { park: { tag: 'Park', n: 2 }, city: { tag: 'City', n: 1 } },
      ['nature'],
      ['city'],
    );
    expect(out.park.n).toBe(2);
    expect(out.nature.n).toBe(1);
    expect(out.city).toBeUndefined();
  });

  test('tolerates empty / undefined inputs without throwing', () => {
    expect(mergeTagCounts({}, [], [])).toEqual({});
    expect(mergeTagCounts(undefined as never, undefined as never, undefined as never)).toEqual({});
    expect(mergeTagCounts(undefined as never, ['A'], undefined as never)).toEqual({ a: { tag: 'A', n: 1 } });
  });

  test('a malformed stored entry (non-positive / blank) is dropped from the base', () => {
    const out = mergeTagCounts(
      { park: { tag: 'Park', n: 0 }, junk: { tag: '   ', n: 5 } },
      ['Park'],
      [],
    );
    expect(out.park).toEqual({ tag: 'Park', n: 1 }); // 0-base ignored, add makes it 1
    expect(out.junk).toBeUndefined(); // blank tag normalizes away
  });
});
