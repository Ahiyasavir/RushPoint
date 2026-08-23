// Pure Storage-prefix derivation (change: storage-rules-hardening).
//
// Every Storage deletion in this codebase is a PREFIX delete
// (`bucket().deleteFiles({ prefix })`). A prefix that collapses to something
// broader than intended does not fail loudly — it deletes someone else's
// objects, or the whole bucket. So the prefix strings are derived by pure,
// total functions and asserted here, with no emulator and no bucket.

import { expect, test, describe } from 'vitest';
import { runPhotoPrefix, gameMediaPrefix, gamePurgePrefixes } from './storagePaths';

describe('runPhotoPrefix', () => {
  test('is the run-scoped participant-upload prefix, trailing slash included', () => {
    expect(runPhotoPrefix('run-1')).toBe('runs/run-1/');
  });

  test('the trailing slash is mandatory — without it "runs/run-1" also matches "runs/run-10"', () => {
    expect(runPhotoPrefix('run-1').endsWith('/')).toBe(true);
  });

  // THE INVARIANT THAT MATTERS: an empty/blank/nullish id must never produce a
  // prefix that widens to the whole bucket ('runs/' would delete EVERY run's
  // photos). Fail loud instead.
  const BAD_IDS: Array<[unknown, string]> = [
    ['', 'empty'], ['   ', 'blank'], [undefined, 'undefined'], [null, 'null'],
  ];
  test.each(BAD_IDS)(
    'refuses a %s runId rather than widening the prefix (%s)',
    (bad: unknown) => {
      expect(() => runPhotoPrefix(bad as string)).toThrow();
    },
  );

  test('refuses an id containing a slash (prefix escape)', () => {
    expect(() => runPhotoPrefix('../..')).toThrow();
    expect(() => runPhotoPrefix('a/b')).toThrow();
  });
});

describe('gameMediaPrefix', () => {
  test('scopes to one game when a gameId is given', () => {
    expect(gameMediaPrefix('owner-1', 'game-1')).toBe('gameMedia/owner-1/games/game-1/');
  });

  test('omitting the gameId purges the creator\'s WHOLE media tree (right to erasure)', () => {
    expect(gameMediaPrefix('owner-1')).toBe('gameMedia/owner-1/');
  });

  test('an empty gameId is NOT silently treated as "whole tree"', () => {
    // A bug that turned a one-game purge into an account-wide purge would be
    // silent and irreversible. Explicit-undefined is the only whole-tree form.
    expect(() => gameMediaPrefix('owner-1', '')).toThrow();
  });

  const BAD_OWNERS: Array<[unknown, string]> = [
    ['', 'empty'], ['   ', 'blank'], [undefined, 'undefined'],
  ];
  test.each(BAD_OWNERS)(
    'refuses a %s ownerUid (%s) rather than matching every creator',
    (bad: unknown) => {
      expect(() => gameMediaPrefix(bad as string)).toThrow();
    },
  );

  test('refuses ids containing a slash', () => {
    expect(() => gameMediaPrefix('a/b')).toThrow();
    expect(() => gameMediaPrefix('owner-1', 'g/1')).toThrow();
  });
});

describe('gamePurgePrefixes — everything a game purge must delete', () => {
  test('covers every run\'s uploads AND the creator-authored media for that game', () => {
    expect(gamePurgePrefixes('owner-1', 'game-1', ['run-a', 'run-b'])).toEqual([
      'runs/run-a/',
      'runs/run-b/',
      'gameMedia/owner-1/games/game-1/',
    ]);
  });

  test('a game with no runs still purges its authored media (the known leak class)', () => {
    expect(gamePurgePrefixes('owner-1', 'game-1', [])).toEqual([
      'gameMedia/owner-1/games/game-1/',
    ]);
  });

  test('duplicate runIds are de-duplicated', () => {
    expect(gamePurgePrefixes('o', 'g', ['r', 'r'])).toEqual(['runs/r/', 'gameMedia/o/games/g/']);
  });

  test('no returned prefix is ever a bucket-wide root', () => {
    for (const p of gamePurgePrefixes('o', 'g', ['r'])) {
      expect(p).not.toBe('');
      expect(p).not.toBe('/');
      expect(p.split('/').filter(Boolean).length).toBeGreaterThanOrEqual(2);
    }
  });
});
