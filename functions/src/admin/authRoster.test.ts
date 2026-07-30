// Bounding rules for the platform-user Auth scan (change: admin-user-activity-dashboard).
//
// These two decisions are the whole reason `listPlatformUsers` cannot run away: which
// Auth accounts count as creators, and when to stop paging. Both are pure so they are
// pinned here rather than only implicitly exercised through the e2e suite — the failure
// they prevent (an unbounded scan of a participant pool that grows with every run ever
// played) is exactly the kind that only shows up at production scale.
import { describe, it, expect } from 'vitest';
import { isCreatorAccount, pageVerdict } from './authRoster';

describe('isCreatorAccount', () => {
  it('an account with an email is a creator', () => {
    expect(isCreatorAccount({ email: 'a@b.com', providerCount: 1 })).toBe(true);
  });

  it('an account with a provider but no email is still a creator', () => {
    // A federated sign-in can withhold the email; provider data still proves it is
    // not play-web's anonymous sign-in.
    expect(isCreatorAccount({ email: null, providerCount: 1 })).toBe(true);
  });

  it('an email with no provider data is a creator', () => {
    expect(isCreatorAccount({ email: 'a@b.com', providerCount: 0 })).toBe(true);
  });

  it('no email AND no provider data is anonymous, never a creator', () => {
    // This is exactly play-web's participant: uid == teamId, nothing else.
    expect(isCreatorAccount({ email: null, providerCount: 0 })).toBe(false);
  });

  it('an empty-string email does not smuggle an anonymous account in', () => {
    expect(isCreatorAccount({ email: '', providerCount: 0 })).toBe(false);
  });
});

describe('pageVerdict', () => {
  const base = { found: 0, wanted: 100, pages: 1, maxPages: 50, hasMorePages: true };

  it('keeps paging while under the target and pages remain', () => {
    expect(pageVerdict(base)).toEqual({ stop: false, complete: true });
  });

  it('stops as soon as one MORE than wanted is found', () => {
    // wanted+1 is enough: the caller slices to `wanted`, so further pages could not
    // change the result — they would be pure cost.
    expect(pageVerdict({ ...base, found: 101 })).toEqual({ stop: true, complete: true });
  });

  it('does NOT stop at exactly wanted, because "is there more" is still unknown', () => {
    expect(pageVerdict({ ...base, found: 100 })).toEqual({ stop: false, complete: true });
  });

  it('stops complete when Auth reports no further pages', () => {
    expect(pageVerdict({ ...base, hasMorePages: false })).toEqual({ stop: true, complete: true });
  });

  it('stops INCOMPLETE when the page cap is reached with pages still remaining', () => {
    expect(pageVerdict({ ...base, pages: 50 })).toEqual({ stop: true, complete: false });
  });

  it('the cap does not mark the scan incomplete when Auth had nothing left anyway', () => {
    expect(pageVerdict({ ...base, pages: 50, hasMorePages: false }))
      .toEqual({ stop: true, complete: true });
  });

  it('having enough wins over the cap (complete, not a cap-truncation)', () => {
    expect(pageVerdict({ ...base, found: 101, pages: 50 }))
      .toEqual({ stop: true, complete: true });
  });

  it('a wanted of 1 still needs 2 found before it can stop early', () => {
    expect(pageVerdict({ ...base, wanted: 1, found: 1 })).toEqual({ stop: false, complete: true });
    expect(pageVerdict({ ...base, wanted: 1, found: 2 })).toEqual({ stop: true, complete: true });
  });
});
