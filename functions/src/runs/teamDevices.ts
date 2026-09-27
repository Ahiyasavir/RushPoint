import * as functions from 'firebase-functions';
import { randomInt } from 'node:crypto';
import type { RunTeam } from '@rushpoint/shared';
// The per-team device allowance and the attendance arithmetic (change:
// every-member-plays). Pure and shared, so the backend guard and both apps read one
// definition of "how many phones may this team have".
import { TEAM_DEVICE_FLOOR, teamDeviceAllowance } from '@rushpoint/shared';

// The GLOBAL per-run phone ceiling + its decision helper live in @rushpoint/shared
// (the single knob — see runCapacity.ts) so the backend guard and the creator-web
// warning read one value. Re-exported here for the existing call sites + tests.
export { MAX_RUN_DEVICES, canAddRunDevice, isRunDeviceCapActive } from '@rushpoint/shared';
export type { RunDeviceDecision } from '@rushpoint/shared';

// ─── Shared team devices (change: shared-team-devices) ───────────────────────
// Pure helpers for the multi-phone team model: several anonymous uids attach to
// one team doc; exactly one (controllerUid) may mutate team state. Legacy team
// docs (created before this change) carry none of the device fields — their
// founding uid (team.id) is treated as the controller everywhere.

export type DeviceRole = 'controller' | 'viewer';

// Unambiguous alphabet: no 0/O, no 1/I/L — codes are read aloud between phones.
export const DEVICE_JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const DEVICE_JOIN_CODE_LENGTH = 6;
/**
 * Today's fixed per-team ceiling, which is now the FLOOR rather than the ceiling
 * (change: every-member-plays).
 *
 * It used to be the hard limit, and that made "every participant on their own device"
 * UNSATISFIABLE for any team larger than three: `canAttachDevice` refused the fourth
 * with 'full'. The six-person teams in run ijI9JMITSf8C9heN1Cwp could not all attach
 * before anyone tried. The allowance now follows the team's own declared size, and this
 * constant guarantees no team loses capacity it has today.
 *
 * Still exported under its old name because several call sites and tests read it as
 * "the smallest number of phones any team may have".
 */
export const MAX_TEAM_DEVICES = TEAM_DEVICE_FLOOR;

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

/**
 * Mint a team device join code. A device code is a real credential (attach →
 * claimController → full team control), so production uses `crypto.randomInt` per
 * character — a CSPRNG with no modulo bias, matching how the staff PIN was hardened
 * (generatePin, anti-cheat row 40). An injected float `rng` (0..1) is retained for
 * deterministic unit tests; when omitted the CSPRNG is used. Same alphabet + length.
 */
export function generateDeviceJoinCode(rng?: () => number): string {
  let code = '';
  for (let i = 0; i < DEVICE_JOIN_CODE_LENGTH; i += 1) {
    const idx = rng
      ? Math.min(
        DEVICE_JOIN_CODE_ALPHABET.length - 1,
        Math.floor(rng() * DEVICE_JOIN_CODE_ALPHABET.length),
      )
      : randomInt(0, DEVICE_JOIN_CODE_ALPHABET.length);
    code += DEVICE_JOIN_CODE_ALPHABET[idx];
  }
  return code;
}

export type AttachDecision = { ok: true } | { ok: false; reason: 'duplicate' | 'full' | 'finished' };

export function canAttachDevice(team: RunTeam, uid: string): AttachDecision {
  if (team.status === 'finished') return { ok: false, reason: 'finished' };
  const uids = attachedDeviceUids(team);
  if (uids.includes(uid)) return { ok: false, reason: 'duplicate' };
  // The allowance follows the TEAM, not a constant (change: every-member-plays), so a
  // team of six can finally put everyone on their own phone. `canAddRunDevice` /
  // MAX_RUN_DEVICES still decides last and is the authority when the two disagree - a
  // generous per-team allowance inside a fixed run ceiling reallocates phones between
  // teams, it does not create new ones, so the run's read budget is unchanged.
  if (uids.length >= teamDeviceAllowance(team)) return { ok: false, reason: 'full' };
  return { ok: true };
}
