/**
 * Minting a staff PIN for one run.
 *
 * Extracted from the `inviteStaff` callable (functions/src/index.ts) when a
 * SECOND caller appeared: `launchSharedRun` hands the person who started a run
 * through a share link staff access to the run they just created (change:
 * game-share-link). Both doors must write the same document with the same shape,
 * or a staff session minted by one of them fails to resolve in the console.
 *
 * The PIN is the credential, so it is generated with `randomInt`, never
 * `Math.random` (anti-cheat row 40). WHO may ask for one is decided by the
 * caller — this module only writes the invite.
 */
import { randomInt } from 'node:crypto';

import { FIRESTORE_PATHS, candidateJoinCodes, makeStaffCode, type StaffCapability } from '@rushpoint/shared';

import { db } from '../firebase';

/** Cryptographic 6-digit staff PIN: the legacy shape, kept only for a run with no join code. */
export function generateStaffPin(): string {
  return String(randomInt(100000, 1000000));
}

/**
 * A staff code for a run whose join code is `joinCode` (change: staff-code-from-join-code): the
 * join code with two characters planted at cryptographically random places, so the code addresses
 * its own run and a marshal signs in with a name and this code alone.
 */
export function generateStaffCode(joinCode: string | undefined): string {
  return joinCode ? makeStaffCode(joinCode, (n) => randomInt(n)) : generateStaffPin();
}

export interface StaffInviteResult {
  inviteId: string;
  pin: string;
}

/**
 * Mint a staff CODE for one run (change: staff-capabilities). Since that change a code is
 * multi-use: several marshals join with the same PIN, and each gets their own person record
 * (`staffGrants/{uid}`) that the organizer can remove. `capabilities` is what people on this code
 * may do; the caller decides it (the game default, the organizer's checklist, or full for the
 * person who launched a shared run). `version` is bumped on every edit so an open staff console
 * knows to refresh its session.
 *
 * The PIN is unique among this run's codes: two codes sharing a PIN would make sign-in land on
 * whichever the query returned first, handing someone the wrong permissions.
 */
export async function createRunStaffInvite(
  { ownerUid, gameId, runId, name, capabilities }: {
    ownerUid: string;
    gameId: string;
    runId: string;
    name: string;
    capabilities: StaffCapability[];
  },
): Promise<StaffInviteResult> {
  const col = db.collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/staffInvites`);
  const runSnap = await db.doc(FIRESTORE_PATHS.run(ownerUid, gameId, runId)).get();
  const joinCode = (runSnap.data() as { accessCode?: unknown } | undefined)?.accessCode;
  const join = typeof joinCode === 'string' && joinCode ? joinCode : undefined;
  let pin = generateStaffCode(join);
  for (let i = 0; i < 5; i++) {
    const clash = await col.where('pin', '==', pin).limit(1).get();
    if (clash.empty) break;
    pin = generateStaffCode(join);
  }
  const now = new Date().toISOString();
  const ref = col.doc();

  await ref.set({
    id: ref.id,
    ownerUid, gameId, runId,
    name,
    label: name,
    // Kept (empty) for readers that predate staff-capabilities; nothing reads it for authz.
    permissions: [],
    capabilities,
    multiUse: true,
    disabled: false,
    version: 1,
    pin,
    // The sign-in query filters on `used == false`; a multi-use code is never marked used.
    used: false,
    createdAt: now,
  });

  return { inviteId: ref.id, pin };
}

export interface StaffRunAddress { ownerUid: string; gameId: string; runId: string }

/**
 * The run a staff code belongs to, found from the code alone (change: staff-code-from-join-code,
 * design D2). Every way of removing the two planted characters is looked up as a join code in ONE
 * `getAll`. Normally one hits; if several do, the run whose staff codes hold this code wins, else
 * the first hit, so a wrong guess still counts against the run it was built on (design D3).
 * Null when the code is built on no join code at all.
 */
export async function resolveStaffRun(code: string): Promise<StaffRunAddress | null> {
  const candidates = candidateJoinCodes(code);
  if (candidates.length === 0) return null;
  const snaps = await db.getAll(...candidates.map((c) => db.doc(FIRESTORE_PATHS.accessCode(c))));
  const runs: StaffRunAddress[] = [];
  for (const s of snaps) {
    const d = s.data() as Partial<StaffRunAddress> | undefined;
    if (s.exists && d?.ownerUid && d.gameId && d.runId) runs.push({ ownerUid: d.ownerUid, gameId: d.gameId, runId: d.runId });
  }
  if (runs.length <= 1) return runs[0] ?? null;
  for (const r of runs) {
    const hit = await db.collection(`users/${r.ownerUid}/games/${r.gameId}/runs/${r.runId}/staffInvites`)
      .where('pin', '==', code).limit(1).get();
    if (!hit.empty) return r;
  }
  return runs[0];
}
