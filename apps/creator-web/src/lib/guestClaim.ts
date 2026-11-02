// Carries a guest's games across signing in to an account they already had (change:
// creator-stays-to-the-end; functions/src/users/guestClaim.ts). The code is kept in localStorage, not the
// tab, so a password reset opened from an email still brings the game along.
const KEY = 'rp-guest-claim';

export function readGuestClaim(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function keepGuestClaim(code: string): void {
  try { localStorage.setItem(KEY, code); } catch { /* private mode: the caller sees no code stored */ }
}
export function dropGuestClaim(): void {
  try { localStorage.removeItem(KEY); } catch { /* */ }
}

/** True from the moment a real account holds a claim until the move has answered. The app waits behind
 *  this: the game is still in the guest's account, so opening it now can only say it does not exist. */
export function guestClaimPending(input: { signedIn: boolean; code: string | null; settled: boolean }): boolean {
  return input.signedIn && !!input.code && !input.settled;
}

/** Only a refusal that will never change ends the claim. A network failure keeps it for the next load. */
export function claimIsFinished(code: unknown): boolean {
  return typeof code === 'string' && ['not-found', 'permission-denied', 'deadline-exceeded', 'invalid-argument'].some((c) => code.endsWith(c));
}
