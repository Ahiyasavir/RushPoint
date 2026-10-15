// Pure-logic test for the participant sign-in recovery decisions (change: self-healing-entry).
//
// At המירוץ לציון (14.10.2026) iPhones lost their anonymous Firebase user seconds after sign-in
// (reproduced on a real iPhone, 15.10): @firebase/auth's IndexedDB poll read an empty store once and
// signed the page out locally, with no network and no error. The app never noticed, sent the join with
// no token, and told the child to "check reception". These are the decisions that now run when the
// user disappears. Pure and total, so they are tested here without a browser; the end-to-end proof is
// scripts/browser-auth-loss.mjs.
//   npx tsx scripts/test-auth-recovery.ts
import { authLossVerdict, afterFailedReinstate } from '../apps/play-web/src/lib/authRecovery';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// --- authLossVerdict: what to do with an auth-state event -------------------------------------
// The race-day event: a user we held becomes null, and nobody asked for a sign-out.
check('unrequested null with a retained user → reinstate',
  authLossVerdict({ prevUid: 'u1', nextUid: null, signOutRequested: false, hasRetained: true }) === 'reinstate');

// A sign-out WE asked for (staff → player switch) must never be undone.
check('requested sign-out → ignore',
  authLossVerdict({ prevUid: 'u1', nextUid: null, signOutRequested: true, hasRetained: true }) === 'ignore');

// Nothing to reinstate with.
check('null with no retained user → ignore',
  authLossVerdict({ prevUid: 'u1', nextUid: null, signOutRequested: false, hasRetained: false }) === 'ignore');

// The first event of a fresh page (no user yet) is not a loss.
check('null before any user → ignore',
  authLossVerdict({ prevUid: null, nextUid: null, signOutRequested: false, hasRetained: false }) === 'ignore');

// A user arriving, or the same user re-emitted (our own reinstatement echoing back), is not a loss.
check('a user arriving → ignore',
  authLossVerdict({ prevUid: null, nextUid: 'u1', signOutRequested: false, hasRetained: false }) === 'ignore');
check('same user re-emitted → ignore',
  authLossVerdict({ prevUid: 'u1', nextUid: 'u1', signOutRequested: false, hasRetained: true }) === 'ignore');

// Another tab signed in as someone else: a DIFFERENT uid, not a loss. Reinstating would fight the
// other tab, so it is left alone.
check('a different uid → ignore',
  authLossVerdict({ prevUid: 'u1', nextUid: 'u2', signOutRequested: false, hasRetained: true }) === 'ignore');

// Totality: malformed input never throws and never reinstates.
for (const bad of [undefined, null, 42, 'x', [], {}, { prevUid: 7, nextUid: null, signOutRequested: 'no', hasRetained: 1 }] as unknown[]) {
  let v: unknown;
  try { v = authLossVerdict(bad as never); } catch { v = 'THREW'; }
  check(`malformed ${JSON.stringify(bad)} → ignore`, v === 'ignore', String(v));
}

// --- afterFailedReinstate: the same user could not be brought back ----------------------------
// Before joining, nothing is lost by a new identity: sign in afresh and carry on (this turns the
// race-day refusal into a silent success).
check('no session (joining) → freshSignIn', afterFailedReinstate({ hasSession: false }) === 'freshSignIn');

// After joining, a new identity is NOT a member: never mint one silently; tell the player and offer
// the rejoin.
check('session (playing) → signedOut', afterFailedReinstate({ hasSession: true }) === 'signedOut');

// Unsure whether the phone is in a team ⇒ the honest answer, not a silent new identity.
for (const bad of [undefined, null, 'x', {}, { hasSession: 'yes' }] as unknown[]) {
  let v: unknown;
  try { v = afterFailedReinstate(bad as never); } catch { v = 'THREW'; }
  check(`malformed ${JSON.stringify(bad)} → signedOut`, v === 'signedOut', String(v));
}

console.log(`\n${failures === 0 ? 'ALL AUTH-RECOVERY TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
