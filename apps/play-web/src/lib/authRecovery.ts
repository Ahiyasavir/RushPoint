// What to do when the participant's Firebase sign-in disappears (change: self-healing-entry).
//
// At המירוץ לציון (14.10.2026) iPhones lost their anonymous user seconds after sign-in: the SDK's
// storage poll read an empty store once and signed the page out locally, with no network and no
// error (reproduced on a real iPhone on 15.10). The app never noticed. These are the two decisions
// that now run when it happens. Pure and total (malformed input never throws), unit-tested by
// scripts/test-auth-recovery.ts; services/firebase.ts carries them out.

export type AuthLossVerdict = 'reinstate' | 'ignore';

/**
 * One auth-state event, judged. `reinstate` only for the race-day shape: a user we held became
 * null, we did not ask for a sign-out, and we still hold the user object to put back.
 *
 * Everything else is `ignore`: a user arriving, the same user re-emitted (our own reinstatement
 * echoing back), a DIFFERENT user (another tab signed in as someone else; fighting it would loop),
 * a sign-out we requested (staff switching to player), or input we cannot read.
 */
export function authLossVerdict(input: {
  prevUid: string | null;
  nextUid: string | null;
  signOutRequested: boolean;
  hasRetained: boolean;
}): AuthLossVerdict {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'ignore';
  const { prevUid, nextUid, signOutRequested, hasRetained } = input as Record<string, unknown>;
  const prev = typeof prevUid === 'string' && prevUid ? prevUid : null;
  if (!prev) return 'ignore';
  if (nextUid !== null) return 'ignore';
  if (signOutRequested !== false) return 'ignore';
  if (hasRetained !== true) return 'ignore';
  return 'reinstate';
}

export type FailedReinstateAction = 'freshSignIn' | 'signedOut';

/**
 * The same user could not be put back. Before joining, a new identity costs nothing (the phone is
 * in no team yet), so sign in afresh and carry on: this turns the race-day refusal into a silent
 * success. After joining, a new identity is NOT a member, so never mint one silently; report the
 * signed-out state and let the player rejoin their team. When we cannot tell which, we take the
 * honest path.
 */
export function afterFailedReinstate(input: { hasSession: boolean }): FailedReinstateAction {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'signedOut';
  return (input as Record<string, unknown>).hasSession === false ? 'freshSignIn' : 'signedOut';
}
