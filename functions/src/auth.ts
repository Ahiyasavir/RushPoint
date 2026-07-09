import * as functions from 'firebase-functions';

// The single source of truth for "reject an unauthenticated caller and return
// the caller's uid". Previously duplicated verbatim in every domain module
// (index/runs/payments/games/users); consolidated here so the authz entry
// point can't drift. `assertAdmin` / `assertStaffOrOwner` stay in their modules.
export function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  return context.auth.uid;
}
