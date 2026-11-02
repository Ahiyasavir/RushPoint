// The server side of the creator plan (change: community-plan). The rule itself is pure, in
// packages/shared/src/creatorPlan.ts; this file reads the document and refuses.
//
// `creatorPlans/{uid}` is closed to clients both ways. An account with no document is on the default
// plan, so nothing had to be written for anyone on the day this shipped.
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import {
  FIRESTORE_PATHS, resolveCreatorPlan, planAllowsLaunch,
  type CreatorPlanDoc, type CreatorPlanId, type CreatorPlanView,
} from '@rushpoint/shared';
import { db, auth } from './firebase';
import { assertAdmin, requireAuth } from './auth';
import { loggedCallable } from './obs/log';
import { writeAuditLog } from './obs/audit';
import { enforceRateLimit } from './rateLimitStore';

/**
 * The emulator's default is `unlimited`: seeds, simulators and every e2e scenario launch far past 3
 * runs. A stored document is obeyed everywhere, which is how e2e proves the real gates. Production never
 * sets FUNCTIONS_EMULATOR, so there the default is the plan.
 */
export function defaultPlanId(): CreatorPlanId {
  return process.env.FUNCTIONS_EMULATOR === 'true' ? 'unlimited' : 'community';
}

export function planViewOf(doc: CreatorPlanDoc | undefined, isAdmin: boolean): CreatorPlanView {
  return resolveCreatorPlan(doc, { admin: isAdmin, defaultPlan: defaultPlanId() });
}

export async function loadPlan(uid: string, isAdmin: boolean): Promise<CreatorPlanView> {
  const snap = await db.doc(FIRESTORE_PATHS.creatorPlan(uid)).get();
  return planViewOf(snap.data() as CreatorPlanDoc | undefined, isAdmin);
}

/** A refusal the creator app turns into its own sheet: `details.reason` is what it reads, never the text. */
export function planRefusal(feature: 'launch' | 'publish' | 'export' | 'import' | 'share', view: CreatorPlanView): functions.https.HttpsError {
  return new functions.https.HttpsError('failed-precondition', `Not on the community plan: ${feature}`, {
    reason: 'community-plan', feature, runsUsed: view.runsUsed, runsTotal: view.runsTotal,
  });
}

export async function assertCanLaunch(uid: string, isAdmin: boolean): Promise<void> {
  const view = await loadPlan(uid, isAdmin);
  if (!planAllowsLaunch(view)) throw planRefusal('launch', view);
}

export async function assertCanMoveGames(uid: string, isAdmin: boolean, feature: 'publish' | 'export' | 'import'): Promise<void> {
  const view = await loadPlan(uid, isAdmin);
  if (!view.canMoveGames) throw planRefusal(feature, view);
}

/**
 * May a game of THIS owner reach another account through a share link? The caller is someone else, so
 * their token says nothing about the owner: the admin claim is read from the owner's account.
 */
export async function ownerMayShareGames(ownerUid: string): Promise<boolean> {
  if ((await loadPlan(ownerUid, false)).canMoveGames) return true;
  const user = await auth.getUser(ownerUid).catch(() => null);
  return user?.customClaims?.admin === true;
}

export const getMyPlan = loggedCallable('getMyPlan', async (_data, context) => {
  const uid = requireAuth(context);
  return loadPlan(uid, context.auth?.token.admin === true);
});

/** Admin only: open more launches for an account, or lift the plan. Both are reversible and logged. */
export const setCreatorPlan = loggedCallable('setCreatorPlan', async (data, context) => {
  const adminUid = assertAdmin(context);
  await enforceRateLimit(adminUid, 'setCreatorPlan');
  const { uid, plan, addRuns } = (data ?? {}) as { uid?: unknown; plan?: unknown; addRuns?: unknown };
  if (typeof uid !== 'string' || !uid.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'uid required');
  }
  if (plan !== undefined && plan !== 'community' && plan !== 'unlimited') {
    throw new functions.https.HttpsError('invalid-argument', 'plan must be community or unlimited');
  }
  if (addRuns !== undefined && (!Number.isInteger(addRuns) || (addRuns as number) < 1 || (addRuns as number) > 100)) {
    throw new functions.https.HttpsError('invalid-argument', 'addRuns must be a whole number from 1 to 100');
  }
  if (plan === undefined && addRuns === undefined) {
    throw new functions.https.HttpsError('invalid-argument', 'nothing to change');
  }
  const ref = db.doc(FIRESTORE_PATHS.creatorPlan(uid));
  await ref.set({
    ...(plan !== undefined ? { plan } : {}),
    ...(addRuns !== undefined ? { extraRuns: admin.firestore.FieldValue.increment(addRuns as number) } : {}),
    updatedAt: new Date().toISOString(), updatedBy: adminUid,
  }, { merge: true });
  await writeAuditLog({
    operatorId: adminUid, actionType: 'creator_plan_set', newValue: String(plan ?? `+${addRuns}`), reason: `plan of ${uid}`,
  } as never);
  const snap = await ref.get();
  return resolveCreatorPlan(snap.data() as CreatorPlanDoc, { defaultPlan: 'community' });
});
