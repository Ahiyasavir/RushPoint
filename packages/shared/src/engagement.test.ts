// Time on site accounting (change: admin-engagement-and-outreach).
//
// The client is the only thing that can observe "this tab was actually in front of a
// human", so the client reports the number — which means the number is UNTRUSTED. These
// rules are what stop a broken clock, a sleeping laptop, or a hostile client from writing
// a thousand hours into someone's total. Pure, so every edge is pinned without Firestore.
import { describe, it, expect } from 'vitest';
import {
  clampEngagementDelta,
  MAX_ENGAGEMENT_FLUSH_MS,
  engagementParts,
} from './engagement';

describe('clampEngagementDelta', () => {
  it('passes an ordinary flush through unchanged', () => {
    expect(clampEngagementDelta(60_000)).toBe(60_000);
  });

  it('caps a flush at the maximum, however large the claim', () => {
    expect(clampEngagementDelta(MAX_ENGAGEMENT_FLUSH_MS + 1)).toBe(MAX_ENGAGEMENT_FLUSH_MS);
    expect(clampEngagementDelta(999 * 60 * 60 * 1000)).toBe(MAX_ENGAGEMENT_FLUSH_MS);
  });

  it('accepts exactly the maximum', () => {
    expect(clampEngagementDelta(MAX_ENGAGEMENT_FLUSH_MS)).toBe(MAX_ENGAGEMENT_FLUSH_MS);
  });

  it('floors negatives at zero, so time can never be subtracted', () => {
    expect(clampEngagementDelta(-1)).toBe(0);
    expect(clampEngagementDelta(-999999)).toBe(0);
  });

  it('treats every non finite or non numeric claim as zero, never NaN', () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, '60000', {}, []]) {
      const out = clampEngagementDelta(bad as never);
      expect(Number.isFinite(out)).toBe(true);
      expect(out).toBe(0);
    }
  });

  it('rounds a fractional millisecond to an integer', () => {
    expect(Number.isInteger(clampEngagementDelta(1234.7))).toBe(true);
  });
});

describe('engagementParts', () => {
  it('splits milliseconds into whole hours and remaining minutes', () => {
    expect(engagementParts(2 * 3600_000 + 15 * 60_000)).toEqual({ hours: 2, minutes: 15 });
  });

  it('reports under a minute as zero and zero, never a blank', () => {
    expect(engagementParts(5_000)).toEqual({ hours: 0, minutes: 0 });
  });

  it('reports exactly one hour as one hour and no minutes', () => {
    expect(engagementParts(3600_000)).toEqual({ hours: 1, minutes: 0 });
  });

  it('never returns 60 minutes; it rolls into the hour', () => {
    const p = engagementParts(3599_999);
    expect(p.minutes).toBeLessThan(60);
  });

  it('is total for absent or corrupt input rather than throwing', () => {
    for (const bad of [undefined, null, NaN, -5, 'x']) {
      expect(engagementParts(bad as never)).toEqual({ hours: 0, minutes: 0 });
    }
  });

  it('handles a very large but legitimate total', () => {
    expect(engagementParts(100 * 3600_000)).toEqual({ hours: 100, minutes: 0 });
  });
});
