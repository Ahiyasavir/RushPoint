import * as functions from 'firebase-functions';
import type { RunTeam } from '@rushpoint/shared';

// ─── Shared team devices (change: shared-team-devices) ───────────────────────
// Pure helpers for the multi-phone team model: several anonymous uids attach to
// one team doc; exactly one (controllerUid) may mutate team state. Legacy team
// docs (created before this change) carry none of the device fields — their
// founding uid (team.id) is treated as the controller everywhere.

export type DeviceRole = 'controller' | 'viewer';

// Unambiguous alphabet: no 0/O, no 1/I/L — codes are read aloud between phones.
export const DEVICE_JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const DEVICE_JOIN_CODE_LENGTH = 6;
export const MAX_TEAM_DEVICES = 8;

/** Every uid attached to the team; a legacy doc implies just the founding uid. */
export function attachedDeviceUids(team: RunTeam): string[] {
  return team.deviceUids && team.deviceUids.length > 0 ? team.deviceUids : [team.id];
}

/** The uid currently allowed to mutate; legacy docs default to the founding uid. */
export function controllerUidOf(team: RunTeam): string {
  return team.controllerUid ?? team.id;
}

export function resolveDeviceRole(team: RunTeam, uid: string): DeviceRole | null {
  if (!attachedDeviceUids(team).includes(uid)) return null;
  return controllerUidOf(team) === uid ? 'controller' : 'viewer';
}

/** Gate for mutating participant callables: only the controller may proceed. */
export function assertController(team: RunTeam, uid: string): void {
  if (resolveDeviceRole(team, uid) !== 'controller') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'not-controller: only the controlling device can perform this action.',
    );
  }
}

export function generateDeviceJoinCode(rng: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < DEVICE_JOIN_CODE_LENGTH; i += 1) {
    const idx = Math.min(
      DEVICE_JOIN_CODE_ALPHABET.length - 1,
      Math.floor(rng() * DEVICE_JOIN_CODE_ALPHABET.length),
    );
    code += DEVICE_JOIN_CODE_ALPHABET[idx];
  }
  return code;
}

export type AttachDecision = { ok: true } | { ok: false; reason: 'duplicate' | 'full' | 'finished' };

export function canAttachDevice(team: RunTeam, uid: string): AttachDecision {
  if (team.status === 'finished') return { ok: false, reason: 'finished' };
  const uids = attachedDeviceUids(team);
  if (uids.includes(uid)) return { ok: false, reason: 'duplicate' };
  if (uids.length >= MAX_TEAM_DEVICES) return { ok: false, reason: 'full' };
  return { ok: true };
}
