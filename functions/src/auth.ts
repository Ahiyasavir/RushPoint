import * as functions from 'firebase-functions';

// The single source of truth for "reject an unauthenticated caller and return
// the caller's uid". Previously duplicated verbatim in every domain module
// (index/runs/payments/games/users); consolidated here so the authz entry
// point can't drift. `assertAdmin` stays in its module (only the root one uses it).
export function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  return context.auth.uid;
}

/**
 * Owner / platform-admin / run-scoped-staff gate, moved here verbatim from
 * functions/src/index.ts (change: skip-single-task) because the RUNS domain now
 * needs it too and cannot import the root module — index.ts imports runs/index.ts,
 * so that direction is a cycle. Duplicating it in the runs module is exactly what
 * this file exists to prevent, so the definition moved instead of being copied.
 * Behaviour is unchanged; index.ts imports it from here.
 */
export function assertStaffOrOwner(
  context: functions.https.CallableContext,
  ownerUid: string,
  runId?: string,
): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  // No emulator bypass — a bypass here made every staff/owner authz check
  // untestable (and the e2e proved a participant could adjust scores, mint
  // staff PINs, and push announcements in dev). Owner + staff tokens work the
  // same in the emulator, so the real gate runs everywhere.
  const t = context.auth.token;
  if (context.auth.uid === ownerUid) return context.auth.uid;        // the game owner
  if (t.admin) return context.auth.uid;                              // platform admin
  if (t.staff && t.ownerUid === ownerUid && (!runId || t.runId === runId)) {
    return context.auth.uid;                                         // staff scoped to THIS run
  }
  throw new functions.https.HttpsError('permission-denied', 'Staff or owner access required');
}
