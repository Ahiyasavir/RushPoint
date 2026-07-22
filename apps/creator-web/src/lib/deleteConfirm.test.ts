// Type-to-confirm predicate for the Dashboard delete danger zone
// (change: recoverable-game-deletion).
//
// The incident was deleting the WRONG game, so a fixed confirmation word
// ("DELETE") is useless: it reads identically on every card. The creator types
// the game's own TITLE, which is the only thing that discriminates between two
// cards. Pure so it is testable without a component runner.
import { describe, it, expect } from 'vitest';
import { matchesGameDeleteConfirmation } from './deleteConfirm';

describe('matchesGameDeleteConfirmation', () => {
  it('accepts the exact title', () => {
    expect(matchesGameDeleteConfirmation('Old City Treasure Hunt', 'Old City Treasure Hunt')).toBe(true);
  });

  it('ignores surrounding whitespace on either side', () => {
    expect(matchesGameDeleteConfirmation('  Old City Treasure Hunt \t', 'Old City Treasure Hunt')).toBe(true);
    expect(matchesGameDeleteConfirmation('Old City Treasure Hunt', '  Old City Treasure Hunt  ')).toBe(true);
  });

  it('rejects a different game title (the wrong-card case)', () => {
    expect(matchesGameDeleteConfirmation('Old City Treasure Hunt', 'Sansana Night Game')).toBe(false);
  });

  it('rejects a prefix or a partial match', () => {
    expect(matchesGameDeleteConfirmation('Old City', 'Old City Treasure Hunt')).toBe(false);
    expect(matchesGameDeleteConfirmation('Old City Treasure Hunt Extra', 'Old City Treasure Hunt')).toBe(false);
  });

  it('is case sensitive', () => {
    expect(matchesGameDeleteConfirmation('old city treasure hunt', 'Old City Treasure Hunt')).toBe(false);
  });

  it('never matches when the title is empty or blank', () => {
    expect(matchesGameDeleteConfirmation('', '')).toBe(false);
    expect(matchesGameDeleteConfirmation('   ', '   ')).toBe(false);
    expect(matchesGameDeleteConfirmation('', undefined)).toBe(false);
  });

  it('handles a Hebrew title (the default console language)', () => {
    expect(matchesGameDeleteConfirmation(' ציד האוצר בעיר העתיקה ', 'ציד האוצר בעיר העתיקה')).toBe(true);
    expect(matchesGameDeleteConfirmation('ציד האוצר', 'ציד האוצר בעיר העתיקה')).toBe(false);
  });
});
