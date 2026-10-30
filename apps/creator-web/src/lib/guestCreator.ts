// Build first, sign up at launch (change: creator-acquisition-and-return).
//
// A visitor who has to make an account before they have made anything is being asked to pay before
// they have seen the goods; most leave. So the landing page lets them start building at once as an
// ANONYMOUS Firebase user (the same mechanism every player already uses), and the account is asked
// for at the one moment it is plainly worth it: when the game goes out to real people. Linking the
// account keeps the uid, so the half-built game is simply theirs.
//
// The gate is a client one on purpose: an anonymous user could already launch and publish before
// this change (every player is one), so a server gate would add no protection, and it would break
// every test and load script that drives the API as an anonymous creator.

export type AuthMode = 'in' | 'up';
export type AccountAction = 'launch' | 'publish' | 'testDrive';

const RETURNING_KEY = 'rp-has-account';

/** A guest is an anonymous Firebase user. Total: anything else is not a guest. */
export function isGuest(user: { isAnonymous?: boolean } | null | undefined): boolean {
  return user?.isAnonymous === true;
}

/** A stranger is shown sign UP; a browser that has signed in before is shown sign in. */
export function defaultAuthMode(hasSignedInBefore: boolean): AuthMode {
  return hasSignedInBefore ? 'in' : 'up';
}

/** Which actions need a real account. A test drive never does: it is how a guest feels the reward. */
export function accountGateFor(action: AccountAction, guest: boolean): 'go' | 'needsAccount' {
  if (!guest) return 'go';
  return action === 'testDrive' ? 'go' : 'needsAccount';
}

/** "Build a game" from the site opens the wizard only for someone with nothing yet: anyone else has a
 *  game to go back to, and a fresh name prompt on top of it would bury exactly that. */
export function startIntentOpensWizard(gameCount: number): boolean {
  return gameCount === 0;
}

export function hasSignedInBefore(): boolean {
  try { return localStorage.getItem(RETURNING_KEY) === '1'; } catch { return false; }
}
export function markSignedIn(): void {
  try { localStorage.setItem(RETURNING_KEY, '1'); } catch { /* storage off */ }
}

// ── When a guest is asked to save (Ahiya, 30.10: "no one may lose their work") ──
// Soft once, when the composed game first opens (the "it is already 80% yours" moment, skippable);
// required after GUEST_FREE_EDITS saved edits, so a guest who declines loses at most a few minutes.
export const GUEST_FREE_EDITS = 3;
export type GuestSaveMoment = 'none' | 'soft' | 'required';

export function guestSaveMoment(input: { guest: boolean; edits: unknown; softSeen: boolean }): GuestSaveMoment {
  if (!input.guest) return 'none';
  const edits = typeof input.edits === 'number' && Number.isFinite(input.edits) ? input.edits : 0;
  if (edits >= GUEST_FREE_EDITS) return 'required';
  return input.softSeen ? 'none' : 'soft';
}

const editsKey = (gameId: string) => `rp-guest-edits:${gameId}`;
const softKey = (gameId: string) => `rp-guest-soft:${gameId}`;
export function readGuestEdits(gameId: string): number {
  try { return Number(localStorage.getItem(editsKey(gameId)) ?? '0') || 0; } catch { return 0; }
}
export function bumpGuestEdits(gameId: string): number {
  const n = readGuestEdits(gameId) + 1;
  try { localStorage.setItem(editsKey(gameId), String(n)); } catch { /* storage off */ }
  return n;
}
export function softAskSeen(gameId: string): boolean {
  try { return localStorage.getItem(softKey(gameId)) === '1'; } catch { return false; }
}
export function markSoftAskSeen(gameId: string): void {
  try { localStorage.setItem(softKey(gameId), '1'); } catch { /* storage off */ }
}
