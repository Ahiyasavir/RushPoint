// Server-side tag guard (change: game-task-tags).
//
// createGame / updateGame / publishGame all run every client-supplied tag list
// through `normalizeTags` before it reaches Firestore — previously `updateGame`
// did a bare `updates.tags = tags`, so a client could store an unbounded list that
// every gallery reader then downloaded. This suite asserts the guard on the exact
// function those callables invoke, adversarially and emulator-free.

import { describe, test, expect } from 'vitest';
import { normalizeTags, MAX_TAGS, MAX_TAG_LEN } from '@rushpoint/shared';

const wellFormed = (tags: string[]) =>
  Array.isArray(tags)
  && tags.length <= MAX_TAGS
  && tags.every((t) => typeof t === 'string' && t.length > 0 && t.length <= MAX_TAG_LEN)
  && new Set(tags.map((t) => t.toLowerCase())).size === tags.length;

describe('server-side tag normalization', () => {
  test('a 10 000-tag payload cannot be stored', () => {
    const hostile = Array.from({ length: 10000 }, (_, i) => `tag${i}`);
    const out = normalizeTags(hostile);
    expect(out.length).toBe(MAX_TAGS);
    expect(wellFormed(out)).toBe(true);
  });

  test('a 1 MB tag cannot be stored', () => {
    const out = normalizeTags(['x'.repeat(1_000_000)]);
    expect(out).toHaveLength(1);
    expect(out[0].length).toBe(MAX_TAG_LEN);
  });

  test('a 10 000-tag list smuggled inside ONE comma-joined element is still clamped', () => {
    const out = normalizeTags([Array.from({ length: 10000 }, (_, i) => `t${i}`).join(',')]);
    expect(out.length).toBe(MAX_TAGS);
  });

  test('non-string members are discarded, not stringified', () => {
    const out = normalizeTags(['ok', 1, null, undefined, {}, [], 'fine'] as unknown as string[]);
    expect(out).toEqual(['ok', 'fine']);
    expect(out.some((t) => t.includes('[object'))).toBe(false);
  });

  test('wrong-typed and absent payloads never throw — the save must not fail', () => {
    for (const bad of [undefined, null, 42, true, {}, { tags: ['a'] }] as unknown as string[][]) {
      expect(() => normalizeTags(bad)).not.toThrow();
      expect(normalizeTags(bad)).toEqual([]);
    }
  });

  test('re-normalizing is a no-op, so create + update + publish can all apply it', () => {
    const once = normalizeTags('Park, park, חוץ,  old   city , ,');
    expect(once).toEqual(['Park', 'חוץ', 'old city']);
    expect(normalizeTags(once)).toEqual(once);
    expect(normalizeTags(normalizeTags(once))).toEqual(once);
  });

  test('a list stored before the guard existed is cleaned on its next publish', () => {
    const legacy = ['  A  ', 'a', '', 'B'.repeat(80), ...Array.from({ length: 40 }, (_, i) => `x${i}`)];
    const out = normalizeTags(legacy);
    expect(wellFormed(out)).toBe(true);
    expect(out[0]).toBe('A');
  });
});
