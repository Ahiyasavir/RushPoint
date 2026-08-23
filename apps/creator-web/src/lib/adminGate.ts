// Client-side admin-page gate (change: admin-user-activity-dashboard). UX only —
// the real security boundary is the server's `assertAdmin` on `listPlatformUsers`;
// a forged/stale client claim can never produce real data because Functions
// re-verifies the ID token itself. This just decides whether to render the
// access-denied state instead of flashing a loading table at a non-admin.
export function isAdminClaim(claims: Record<string, unknown> | null | undefined): boolean {
  return claims?.admin === true;
}
