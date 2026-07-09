import { expect, test, describe } from 'vitest';
import type { RunFeedback } from '@rushpoint/shared';
import { validateFeedbackPayload, computeFeedbackSummary } from './feedbackSummary';

// A well-formed submission payload (what the client sends, pre-storage).
function payload(overrides: Record<string, unknown> = {}) {
  return {
    ratings: { overall: 5, content: 4, bonding: 5, difficulty: 2, smoothness: 3, recommend: 5 },
    issues: [],
    comment: 'loved it',
    lang: 'he',
    ...overrides,
  };
}

// A stored feedback doc (what computeFeedbackSummary aggregates over).
function doc(overrides: Partial<RunFeedback> = {}): RunFeedback {
  return {
    uid: 'u1',
    teamId: 't1',
    teamName: 'הנמרים',
    ratings: { overall: 5, content: 4, bonding: 5, difficulty: 2, smoothness: 3, recommend: 5 },
    issues: [],
    lang: 'he',
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe('validateFeedbackPayload', () => {
  test('accepts a full valid payload', () => {
    const out = validateFeedbackPayload(payload());
    expect(out.ratings.overall).toBe(5);
    expect(out.comment).toBe('loved it');
  });

  test('accepts a partial payload (some dimensions skipped)', () => {
    const out = validateFeedbackPayload({ ratings: { overall: 4 }, lang: 'en' });
    expect(out.ratings).toEqual({ overall: 4 });
    expect(out.comment).toBeUndefined();
  });

  test('accepts comment-only (no ratings) as content', () => {
    const out = validateFeedbackPayload({ ratings: {}, comment: 'a bug happened', lang: 'he' });
    expect(out.comment).toBe('a bug happened');
  });

  test('rejects an unknown rating key', () => {
    expect(() => validateFeedbackPayload(payload({ ratings: { vibes: 5 } }))).toThrow();
  });

  test('rejects an out-of-range 1–5 rating (overall 0 or 6)', () => {
    expect(() => validateFeedbackPayload(payload({ ratings: { overall: 0 } }))).toThrow();
    expect(() => validateFeedbackPayload(payload({ ratings: { overall: 6 } }))).toThrow();
  });

  test('rejects an out-of-range 1–3 rating (difficulty 4)', () => {
    expect(() => validateFeedbackPayload(payload({ ratings: { difficulty: 4 } }))).toThrow();
  });

  test('rejects a non-integer rating', () => {
    expect(() => validateFeedbackPayload(payload({ ratings: { overall: 3.5 } }))).toThrow();
  });

  test('rejects an unknown issue code', () => {
    expect(() => validateFeedbackPayload(payload({ issues: ['aliens'] }))).toThrow();
  });

  test('rejects a comment over 1000 chars', () => {
    expect(() => validateFeedbackPayload(payload({ comment: 'x'.repeat(1001) }))).toThrow();
  });

  test('rejects an entirely empty submission (no ratings, no issues, no comment)', () => {
    expect(() => validateFeedbackPayload({ ratings: {}, issues: [], comment: '  ', lang: 'he' })).toThrow();
  });
});

describe('computeFeedbackSummary', () => {
  test('zero responses → zeroed summary with no NaN', () => {
    const s = computeFeedbackSummary([], 10);
    expect(s.responseCount).toBe(0);
    expect(s.participantCount).toBe(10);
    expect(s.responseRate).toBe(0);
    expect(s.recommendScore).toBe(0);
    expect(s.commentCount).toBe(0);
    expect(Object.keys(s.ratings)).toHaveLength(0);
    // exhaustively assert nothing is NaN
    expect(JSON.stringify(s)).not.toContain('null');
    expect(Number.isNaN(s.responseRate)).toBe(false);
  });

  test('participantCount 0 does not divide by zero', () => {
    const s = computeFeedbackSummary([doc()], 0);
    expect(Number.isNaN(s.responseRate)).toBe(false);
    expect(s.responseRate).toBe(0);
  });

  test('averages only answered values per dimension (skip-aware)', () => {
    const s = computeFeedbackSummary(
      [doc({ ratings: { overall: 5 } }), doc({ uid: 'u2', ratings: { overall: 3 } })],
      2,
    );
    expect(s.responseCount).toBe(2);
    expect(s.responseRate).toBe(1);
    expect(s.ratings.overall!.avg).toBe(4);
    expect(s.ratings.overall!.count).toBe(2);
  });

  test('a dimension nobody answered is omitted (never NaN)', () => {
    const s = computeFeedbackSummary([doc({ ratings: { overall: 4 } })], 1);
    expect(s.ratings.content).toBeUndefined();
    expect(s.ratings.overall!.avg).toBe(4);
  });

  test('distribution counts each bucket', () => {
    const s = computeFeedbackSummary(
      [
        doc({ ratings: { overall: 5 } }),
        doc({ uid: 'u2', ratings: { overall: 5 } }),
        doc({ uid: 'u3', ratings: { overall: 2 } }),
      ],
      3,
    );
    // 1–5 scale → 5 buckets; two 5s and one 2
    expect(s.ratings.overall!.distribution[4]).toBe(2); // value 5 → index 4
    expect(s.ratings.overall!.distribution[1]).toBe(1); // value 2 → index 1
  });

  test('recommendScore is the share of 4–5 recommend answers', () => {
    const s = computeFeedbackSummary(
      [
        doc({ ratings: { recommend: 5 } }),
        doc({ uid: 'u2', ratings: { recommend: 4 } }),
        doc({ uid: 'u3', ratings: { recommend: 2 } }),
        doc({ uid: 'u4', ratings: {} }), // didn't answer recommend → not counted
      ],
      4,
    );
    // 2 of 3 who answered recommend gave ≥4
    expect(s.recommendScore).toBeCloseTo(2 / 3);
  });

  test('issueCounts tallies each issue code, commentCount counts non-empty comments', () => {
    const s = computeFeedbackSummary(
      [
        doc({ issues: ['gps', 'photo'], comment: 'x' }),
        doc({ uid: 'u2', issues: ['gps'], comment: '' }),
        doc({ uid: 'u3', issues: [] }),
      ],
      3,
    );
    expect(s.issueCounts.gps).toBe(2);
    expect(s.issueCounts.photo).toBe(1);
    expect(s.commentCount).toBe(1);
  });
});
