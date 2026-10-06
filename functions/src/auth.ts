import * as functions from 'firebase-functions';
import { FIRESTORE_PATHS, resolveStaffAccess, staffCan, STAFF_IDENTITY_REASON, STAFF_REFUSAL_REASON, type StaffCapability } from '@rushpoint/shared';
import { db, docCachePolicy } from './firebase';
import { cachedGetDoc } from './docCache';

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

/**
 * Platform-admin gate. Was defined verbatim in both index.ts and
 * maintenance/index.ts (change: admin-user-activity-dashboard moved it here,
 * same reason assertStaffOrOwner moved — a new module, admin/index.ts, needs it
 * too and cannot import from index.ts without a cycle). Behavior unchanged: no
 * emulator bypass — the e2e suite mints a real `admin` custom-token claim
 * against the Auth emulator, so tests exercise the SAME gate production runs.
 */
export function assertAdmin(context: functions.https.CallableContext): string {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  if (!context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
  return context.auth.uid;
}


/**
 * The game's owner or a platform admin, and nobody else: not staff of the run, whatever their
 * capabilities (change: team-lifecycle-controls, for removing a team from the game). Lives here,
 * not in index.ts, so the runs module can use it without an import cycle.
 */
export function assertOwnerOrPlatformAdmin(context: functions.https.CallableContext, ownerUid: string): string {
  const uid = requireAuth(context);
  if (uid !== ownerUid && !context.auth?.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Only the game owner can do this');
  }
  return uid;
}

/**
 * Owner / admin / staff WITH THIS CAPABILITY (change: staff-capabilities).
 *
 * `assertStaffOrOwner` let every staff token through every staff callable: the invite's
 * `permissions` were written and never read, so a marshal handed a PIN to watch one station could
 * add points to any team. Staff now pass only when their person record (`staffGrants/{uid}`) is not
 * removed and their code grants `capability` (or it is always granted: safety, the staff channel,
 * mission names). Checked LIVE on every call, so an organizer widening or narrowing a code during
 * the run takes effect on the next tap, without a new PIN.
 *
 * Unlike the old gate a staff caller MUST name the run: "no runId" used to mean "any run".
 * Reads go through `cachedGetDoc`: both documents are written only by callables in this process,
 * so invalidation is exact on the VPS (and the cache is off everywhere else).
 */
const legacyStaffLogged = new Set<string>();

export async function assertStaffCan(
  context: functions.https.CallableContext,
  ownerUid: string,
  runId: string | undefined,
  capability: StaffCapability,
): Promise<string> {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const t = context.auth.token;
  if (context.auth.uid === ownerUid) return context.auth.uid;
  if (t.admin) return context.auth.uid;
  if (!(t.staff && t.ownerUid === ownerUid && runId && t.runId === runId && typeof t.gameId === 'string')) {
    throw new functions.https.HttpsError('permission-denied', 'Staff or owner access required');
  }
  const uid = context.auth.uid;
  const grant = await cachedGetDoc<{ codeId?: string; removed?: boolean }>(
    db, docCachePolicy, FIRESTORE_PATHS.staffGrant(ownerUid, t.gameId, runId, uid),
  );
  let code: { exists: boolean; data?: { capabilities?: unknown; disabled?: unknown } } | null = null;
  const codeId = grant.data?.codeId;
  if (grant.exists && typeof codeId === 'string' && codeId) {
    code = await cachedGetDoc<{ capabilities?: unknown; disabled?: unknown }>(
      db, docCachePolicy, FIRESTORE_PATHS.staffInvite(ownerUid, t.gameId, runId, codeId),
    );
  }
  const access = resolveStaffAccess({
    grant: grant.exists ? (grant.data ?? {}) : null,
    code: code && code.exists ? (code.data ?? {}) : null,
  });
  if (access.legacy && !legacyStaffLogged.has(`${runId}:${uid}`)) {
    legacyStaffLogged.add(`${runId}:${uid}`);
    functions.logger.info('staff.legacyAccess', { runId, uid, capability });
  }
  if (!access.allowed) {
    throw new functions.https.HttpsError('permission-denied', 'You were removed from this run\'s staff',
      { reason: STAFF_REFUSAL_REASON.removed });
  }
  if (!staffCan(access, capability)) {
    // The reason rides in `details`, never the message: the staff console turns it into "your code
    // cannot do this" instead of reading permission-denied as an expired session.
    throw new functions.https.HttpsError('permission-denied', 'Your staff code does not allow this',
      { reason: STAFF_REFUSAL_REASON.missing, capability });
  }
  return uid;
}

/**
 * A staff identity is never a team (issue #16). Called by the callables that make the CALLER's uid a
 * team or a team device. Firebase keeps one user per browser origin, and the staff console lives on
 * the player origin, so without this a marshal who opened the player app joined as themselves.
 */
export function assertNotStaffIdentity(context: functions.https.CallableContext): void {
  if (context.auth?.token?.staff === true) {
    throw new functions.https.HttpsError('failed-precondition',
      'This browser is signed in as staff; join from another browser or a private window.',
      { reason: STAFF_IDENTITY_REASON });
  }
}
