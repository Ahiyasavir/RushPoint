// Client-side admin-page gate (change: admin-user-activity-dashboard). UX only —
// the real security boundary is the server's `assertAdmin` on `listPlatformUsers`;
// this just decides whether to show the access-denied state instead of a loading
// table. Pure so it is testable without a component runner.
import { describe, it, expect } from 'vitest';
import { isAdminClaim } from './adminGate';

describe('isAdminClaim', () => {
  it('is true only when admin is exactly boolean true', () => {
    expect(isAdminClaim({ admin: true })).toBe(true);
  });

  it('is false when the claim is absent', () => {
    expect(isAdminClaim({})).toBe(false);
  });

  it('is false when claims is undefined', () => {
    expect(isAdminClaim(undefined)).toBe(false);
  });

  it('is false when claims is null', () => {
    expect(isAdminClaim(null)).toBe(false);
  });

  it('is false when admin is explicitly false', () => {
    expect(isAdminClaim({ admin: false })).toBe(false);
  });

  it('is false when admin is a truthy string, not a boolean', () => {
    expect(isAdminClaim({ admin: 'true' })).toBe(false);
  });

  it('is false when admin is a truthy number', () => {
    expect(isAdminClaim({ admin: 1 })).toBe(false);
  });
});
