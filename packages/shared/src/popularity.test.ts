// Popularity ranking — pure-logic contract (change: gallery-popularity-ranking).
//
// This is the ONE definition of "best first" for the public gallery and the task
// library. The server stores the score on publicGames/publicTasks so Firestore can
// order by it, and the client re-sorts the window it gets back — both through the
// functions asserted here, so the two can never drift.
//
// The calibration constants are policy, so they are asserted as *properties*
// (a use is worth 3 likes; 10x engagement is exactly +1.0; 80 days of newness
// offsets exactly one order of magnitude) rather than as magic numbers.

import { describe, it, expect } from 'vitest';
import {
  POPULARITY_USE_WEIGHT,
  POPULARITY_LIKE_WEIGHT,
  POPULARITY_EPOCH_MS,
  POPULARITY_DAY_BONUS,
  POPULARITY_TIE_DAYS,
  popularityScore,
  comparePopularity,
  relevanceTier,
  rankGalleryResults,
} from './popularity';

const DAY = 86_400_000;
const at = (days: number) => POPULARITY_EPOCH_MS + days * DAY;

describe('popularityScore — signal weighting', () => {
  it('weights a use above a like at equal magnitude', () => {
    const uses = popularityScore({ uses: 10, likes: 0, createdAtMs: POPULARITY_EPOCH_MS });
    const likes = popularityScore({ uses: 0, likes: 10, createdAtMs: POPULARITY_EPOCH_MS });
    expect(uses).toBeGreaterThan(likes);
  });

  it('prices one use at exactly POPULARITY_USE_WEIGHT likes', () => {
    const a = popularityScore({ uses: 4, likes: 0, createdAtMs: POPULARITY_EPOCH_MS });
    const b = popularityScore({ uses: 0, likes: 4 * POPULARITY_USE_WEIGHT, createdAtMs: POPULARITY_EPOCH_MS });
    expect(a).toBeCloseTo(b, 9);
    expect(POPULARITY_USE_WEIGHT).toBeGreaterThan(POPULARITY_LIKE_WEIGHT);
  });

  it('is monotonic in both signals', () => {
    const base = popularityScore({ uses: 5, likes: 5, createdAtMs: POPULARITY_EPOCH_MS });
    expect(popularityScore({ uses: 6, likes: 5, createdAtMs: POPULARITY_EPOCH_MS })).toBeGreaterThan(base);
    expect(popularityScore({ uses: 5, likes: 6, createdAtMs: POPULARITY_EPOCH_MS })).toBeGreaterThan(base);
  });
});

describe('popularityScore — logarithmic compression', () => {
  it('adds exactly 1.0 per ten-fold increase in weighted engagement', () => {
    const lo = popularityScore({ uses: 10, likes: 0, createdAtMs: POPULARITY_EPOCH_MS });
    const hi = popularityScore({ uses: 100, likes: 0, createdAtMs: POPULARITY_EPOCH_MS });
    const higher = popularityScore({ uses: 1000, likes: 0, createdAtMs: POPULARITY_EPOCH_MS });
    expect(hi - lo).toBeCloseTo(1, 6);
    expect(higher - hi).toBeCloseTo(1, 6);
  });

  it('scores a brand-new, never-engaged item at exactly its newness offset', () => {
    expect(popularityScore({ uses: 0, likes: 0, createdAtMs: POPULARITY_EPOCH_MS })).toBe(0);
    expect(popularityScore({ uses: 0, likes: 0, createdAtMs: at(40) })).toBeCloseTo(40 * POPULARITY_DAY_BONUS, 6);
  });
});

describe('popularityScore — newness lets new content surface without a cron', () => {
  it('offsets exactly one order of magnitude of engagement per POPULARITY_TIE_DAYS', () => {
    // Incumbent: published at the epoch, 10x the engagement of the newcomer.
    const incumbent = popularityScore({ uses: 100, likes: 0, createdAtMs: POPULARITY_EPOCH_MS });
    // Newcomer: POPULARITY_TIE_DAYS later, one tenth the engagement. They tie.
    const newcomer = popularityScore({ uses: 10, likes: 0, createdAtMs: at(POPULARITY_TIE_DAYS) });
    expect(newcomer).toBeCloseTo(incumbent, 6);
  });

  it('lets a newer item with less lifetime engagement out-rank an old incumbent', () => {
    const incumbent = popularityScore({ uses: 100, likes: 0, createdAtMs: POPULARITY_EPOCH_MS });
    const newcomer = popularityScore({ uses: 20, likes: 0, createdAtMs: at(POPULARITY_TIE_DAYS) });
    expect(newcomer).toBeGreaterThan(incumbent);
  });

  it('does NOT let a zero-engagement newcomer beat a merely slightly older popular item', () => {
    const recentHit = popularityScore({ uses: 50, likes: 20, createdAtMs: at(300) });
    const emptyToday = popularityScore({ uses: 0, likes: 0, createdAtMs: at(307) });
    expect(recentHit).toBeGreaterThan(emptyToday);
  });

  it('is time-invariant: the score depends only on the item, never on "now"', () => {
    // The no-cron property. If the score referenced the current clock it would go
    // stale the instant it was stored and would need periodic recomputation.
    const signals = { uses: 7, likes: 3, createdAtMs: at(12) };
    const first = popularityScore(signals);
    const second = popularityScore(signals);
    expect(second).toBe(first);
    // …and popularityScore takes no clock argument at all.
    expect(popularityScore.length).toBe(1);
  });
});

describe('popularityScore — total, never NaN', () => {
  const bad = [NaN, Infinity, -Infinity, -5, undefined];
  it('clamps hostile counts to their neutral value', () => {
    for (const v of bad) {
      const s = popularityScore({ uses: v as number, likes: v as number, createdAtMs: POPULARITY_EPOCH_MS });
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBe(0);
    }
  });

  it('treats a missing or pre-epoch createdAt as the epoch', () => {
    expect(popularityScore({ uses: 10, likes: 0 })).toBe(
      popularityScore({ uses: 10, likes: 0, createdAtMs: POPULARITY_EPOCH_MS }),
    );
    expect(popularityScore({ uses: 10, likes: 0, createdAtMs: POPULARITY_EPOCH_MS - 999 * DAY })).toBe(
      popularityScore({ uses: 10, likes: 0, createdAtMs: POPULARITY_EPOCH_MS }),
    );
    expect(popularityScore({ uses: 10, likes: 0, createdAtMs: NaN })).toBe(
      popularityScore({ uses: 10, likes: 0, createdAtMs: POPULARITY_EPOCH_MS }),
    );
  });

  it('never returns a non-finite value for any seeded random input', () => {
    let seed = 1337;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 400; i++) {
      const s = popularityScore({
        uses: Math.floor(rnd() * 5000) - 100,
        likes: Math.floor(rnd() * 5000) - 100,
        createdAtMs: POPULARITY_EPOCH_MS + Math.floor((rnd() - 0.2) * 400 * DAY),
      });
      expect(Number.isFinite(s)).toBe(true);
    }
  });
});

describe('comparePopularity — deterministic total order', () => {
  const item = (id: string, popularity: number, uses = 0, likes = 0) => ({ id, popularity, uses, likes });

  it('orders by score descending', () => {
    expect(comparePopularity(item('a', 2), item('b', 1))).toBeLessThan(0);
    expect(comparePopularity(item('a', 1), item('b', 2))).toBeGreaterThan(0);
  });

  it('breaks a score tie by uses, then likes, then id', () => {
    expect(comparePopularity(item('a', 1, 5, 0), item('b', 1, 4, 99))).toBeLessThan(0);
    expect(comparePopularity(item('a', 1, 5, 1), item('b', 1, 5, 2))).toBeGreaterThan(0);
    expect(comparePopularity(item('a', 1, 5, 5), item('b', 1, 5, 5))).toBeLessThan(0);
  });

  it('treats a missing score as zero (legacy documents rank last, not NaN)', () => {
    expect(comparePopularity(item('a', 0.1), { id: 'b' })).toBeLessThan(0);
  });

  it('pinnedLast always ranks after a non-pinned item, regardless of popularity', () => {
    const pinned = { ...item('pinned', 999, 999, 999), pinnedLast: true };
    const ordinary = item('ordinary', 0, 0, 0);
    expect(comparePopularity(pinned, ordinary)).toBeGreaterThan(0);
    expect(comparePopularity(ordinary, pinned)).toBeLessThan(0);
  });

  it('two pinnedLast items still order between themselves normally', () => {
    const a = { ...item('a', 2), pinnedLast: true };
    const b = { ...item('b', 1), pinnedLast: true };
    expect(comparePopularity(a, b)).toBeLessThan(0);
  });

  it('is antisymmetric, transitive, and never zero for distinct ids', () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const sample = Array.from({ length: 40 }, (_, i) =>
      item(`id-${i}`, Math.round(rnd() * 3 * 10) / 10, Math.floor(rnd() * 4), Math.floor(rnd() * 4)));
    for (const a of sample) {
      for (const b of sample) {
        const ab = comparePopularity(a, b);
        const ba = comparePopularity(b, a);
        if (a.id === b.id) expect(ab).toBe(0);
        else {
          expect(ab).not.toBe(0);
          expect(Math.sign(ab)).toBe(-Math.sign(ba));
        }
      }
    }
    const sorted = [...sample].sort(comparePopularity);
    for (let i = 0; i + 1 < sorted.length; i++) {
      expect(comparePopularity(sorted[i], sorted[i + 1])).toBeLessThan(0);
    }
  });
});

describe('relevanceTier — search relevance beats popularity', () => {
  const f = { id: 'x', title: 'Kotel Hunt', extras: ['A walk near the Kotel', 'jerusalem'] };

  it('ranks a title prefix above a title substring above another field', () => {
    expect(relevanceTier(f, 'kotel')).toBe(3);
    expect(relevanceTier(f, 'hunt')).toBe(2);
    expect(relevanceTier(f, 'jerusalem')).toBe(1);
    expect(relevanceTier(f, 'nothing here')).toBe(0);
  });

  it('is case and whitespace insensitive', () => {
    expect(relevanceTier(f, '  KOTEL  ')).toBe(3);
  });

  it('treats an empty query as an equal match for everything', () => {
    expect(relevanceTier(f, '')).toBe(relevanceTier({ id: 'y', title: 'Anything' }, ''));
    expect(relevanceTier(f, '   ')).toBeGreaterThan(0);
  });
});

describe('rankGalleryResults', () => {
  interface Row { id: string; title: string; description?: string; popularity: number; pinnedLast?: boolean }
  const adapt = (r: Row) => ({
    id: r.id, title: r.title, extras: [r.description], popularity: r.popularity, pinnedLast: r.pinnedLast,
  });

  it('sorts a pinnedLast row after every other match even with a matching query', () => {
    const rows: Row[] = [
      { id: 'qa', title: 'Kotel QA Playground', popularity: 999, pinnedLast: true },
      { id: 'real', title: 'Kotel Hunt', popularity: 0.01 },
    ];
    expect(rankGalleryResults(rows, 'kotel', adapt).map((r) => r.id)).toEqual(['real', 'qa']);
  });

  it('with an empty query, orders purely by popularity', () => {
    const rows: Row[] = [
      { id: 'lo', title: 'Quiet', popularity: 0.5 },
      { id: 'hi', title: 'Loud', popularity: 2.5 },
      { id: 'mid', title: 'Middling', popularity: 1.5 },
    ];
    expect(rankGalleryResults(rows, '', adapt).map((r) => r.id)).toEqual(['hi', 'mid', 'lo']);
  });

  it('puts a weak-but-popular match BELOW a strong unpopular match', () => {
    const rows: Row[] = [
      { id: 'popular', title: 'City Race', description: 'runs past the kotel', popularity: 9 },
      { id: 'exact', title: 'Kotel Hunt', popularity: 0.01 },
    ];
    expect(rankGalleryResults(rows, 'kotel', adapt).map((r) => r.id)).toEqual(['exact', 'popular']);
  });

  it('uses popularity as the tiebreak inside one relevance tier', () => {
    const rows: Row[] = [
      { id: 'cold', title: 'Kotel A', popularity: 0.2 },
      { id: 'hot', title: 'Kotel B', popularity: 4 },
    ];
    expect(rankGalleryResults(rows, 'kotel', adapt).map((r) => r.id)).toEqual(['hot', 'cold']);
  });

  it('drops non-matching rows when a query is present, and keeps everything when it is not', () => {
    const rows: Row[] = [
      { id: 'a', title: 'Kotel Hunt', popularity: 1 },
      { id: 'b', title: 'Beach Day', popularity: 5 },
    ];
    expect(rankGalleryResults(rows, 'kotel', adapt).map((r) => r.id)).toEqual(['a']);
    expect(rankGalleryResults(rows, '', adapt)).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const rows: Row[] = [
      { id: 'a', title: 'A', popularity: 1 },
      { id: 'b', title: 'B', popularity: 5 },
    ];
    const snapshot = rows.map((r) => r.id);
    rankGalleryResults(rows, '', adapt);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});
