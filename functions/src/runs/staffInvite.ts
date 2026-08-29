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

import { db } from '../firebase';

/** Cryptographic 6-digit staff PIN. */
export function generateStaffPin(): string {
  return String(randomInt(100000, 1000000));
}

export interface StaffInviteResult {
  inviteId: string;
  pin: string;
}

export async function createRunStaffInvite(
  { ownerUid, gameId, runId, name, permissions }: {
    ownerUid: string;
    gameId: string;
    runId: string;
    name: string;
    permissions?: string[];
  },
): Promise<StaffInviteResult> {
  const pin = generateStaffPin();
  const now = new Date().toISOString();
  const ref = db
    .collection(`users/${ownerUid}/games/${gameId}/runs/${runId}/staffInvites`)
    .doc();

  await ref.set({
    id: ref.id,
    ownerUid, gameId, runId,
    name,
    permissions: permissions ?? [],
    pin,
    used: false,
    createdAt: now,
  });

  return { inviteId: ref.id, pin };
}
