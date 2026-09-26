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

import type { StaffCapability } from '@rushpoint/shared';

import { db } from '../firebase';

/** Cryptographic 6-digit staff PIN. */
export function generateStaffPin(): string {
  return String(randomInt(100000, 1000000));
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
  let pin = generateStaffPin();
  for (let i = 0; i < 5; i++) {
    const clash = await col.where('pin', '==', pin).limit(1).get();
    if (clash.empty) break;
    pin = generateStaffPin();
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
