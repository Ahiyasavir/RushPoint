import { expect, test, describe } from 'vitest';
import { FIRESTORE_PATHS, type RunTeam } from '@rushpoint/shared';
import {
  resolveDeviceRole,
  assertController,
  generateDeviceJoinCode,
  canAttachDevice,
  canAddRunDevice,
  DEVICE_JOIN_CODE_ALPHABET,
  DEVICE_JOIN_CODE_LENGTH,
  MAX_TEAM_DEVICES,
  MAX_RUN_DEVICES,
} from './teamDevices';

// Minimal team factory — only the fields the device helpers read.
function baseTeam(overrides: Partial<RunTeam> = {}): RunTeam {
  return {
    id: 'uid-founder',
    runId: 'run1',
    gameId: 'game1',
    ownerUid: 'owner1',
    displayName: 'הנמרים',
    registrationData: {},
    status: 'active',
    stages: [],
    score: 0,
    bonusPenalty: 0,
    launched: true,
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function multiDeviceTeam(overrides: Partial<RunTeam> = {}): RunTeam {
  return baseTeam({
    deviceUids: ['uid-founder', 'uid-viewer'],
    controllerUid: 'uid-founder',
    deviceJoinCode: 'ABC234',
    devices: [
      { uid: 'uid-founder', name: 'דנה', joinedAt: new Date(0).toISOString() },
      { uid: 'uid-viewer', name: 'יוסי', joinedAt: new Date(0).toISOString() },
    ],
    ...overrides,
  });
}

describe('resolveDeviceRole', () => {
  test('the controllerUid resolves to controller', () => {
    expect(resolveDeviceRole(multiDeviceTeam(), 'uid-founder')).toBe('controller');
  });

  test('an attached non-controller uid resolves to viewer', () => {
    expect(resolveDeviceRole(multiDeviceTeam(), 'uid-viewer')).toBe('viewer');
  });

  test('after a transfer the roles swap', () => {
    const team = multiDeviceTeam({ controllerUid: 'uid-viewer' });
    expect(resolveDeviceRole(team, 'uid-viewer')).toBe('controller');
    expect(resolveDeviceRole(team, 'uid-founder')).toBe('viewer');
  });

  test('legacy team doc (no controllerUid/deviceUids): founding uid is the controller', () => {
    expect(resolveDeviceRole(baseTeam(), 'uid-founder')).toBe('controller');
  });

  test('an unattached uid resolves to null', () => {
    expect(resolveDeviceRole(multiDeviceTeam(), 'uid-stranger')).toBeNull();
    expect(resolveDeviceRole(baseTeam(), 'uid-stranger')).toBeNull();
  });
});

describe('assertController', () => {
  test('passes for the current controller', () => {
    expect(() => assertController(multiDeviceTeam(), 'uid-founder')).not.toThrow();
  });

  test('passes for the founding uid of a legacy doc', () => {
    expect(() => assertController(baseTeam(), 'uid-founder')).not.toThrow();
  });

  test('throws permission-denied for an attached viewer', () => {
    try {
      assertController(multiDeviceTeam(), 'uid-viewer');
      expect.unreachable('viewer must be rejected');
    } catch (err) {
      expect((err as { code?: string }).code).toContain('permission-denied');
    }
  });

  test('throws permission-denied for a stranger', () => {
    try {
      assertController(multiDeviceTeam(), 'uid-stranger');
      expect.unreachable('stranger must be rejected');
    } catch (err) {
      expect((err as { code?: string }).code).toContain('permission-denied');
    }
  });
});

describe('generateDeviceJoinCode', () => {
  test('emits DEVICE_JOIN_CODE_LENGTH chars from the unambiguous alphabet', () => {
    const code = generateDeviceJoinCode(() => 0.5);
    expect(code).toHaveLength(DEVICE_JOIN_CODE_LENGTH);
    for (const ch of code) expect(DEVICE_JOIN_CODE_ALPHABET).toContain(ch);
  });

  test('the alphabet contains no ambiguous glyphs (0/O, 1/I/L)', () => {
    for (const bad of ['0', 'O', '1', 'I', 'L']) {
      expect(DEVICE_JOIN_CODE_ALPHABET).not.toContain(bad);
    }
  });

  test('is deterministic under an injected rng', () => {
    let calls = 0;
    const rng = () => ((calls++ % 7) + 1) / 10;
    calls = 0;
    const a = generateDeviceJoinCode(rng);
    calls = 0;
    const b = generateDeviceJoinCode(rng);
    expect(a).toBe(b);
  });

  // wave-h H1: production path (no injected rng) uses crypto.randomInt per char.
  test('the default (crypto) path emits valid-length, in-alphabet codes', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateDeviceJoinCode();
      expect(code).toHaveLength(DEVICE_JOIN_CODE_LENGTH);
      for (const ch of code) expect(DEVICE_JOIN_CODE_ALPHABET).toContain(ch);
    }
  });
});

describe('canAttachDevice', () => {
  test('accepts a fresh uid on a multi-device team', () => {
    expect(canAttachDevice(multiDeviceTeam(), 'uid-new')).toEqual({ ok: true });
  });

  test('accepts a fresh uid on a legacy doc (founding uid implicitly attached)', () => {
    expect(canAttachDevice(baseTeam(), 'uid-new')).toEqual({ ok: true });
  });

  test('rejects a uid that is already attached (including the legacy founding uid)', () => {
    expect(canAttachDevice(multiDeviceTeam(), 'uid-viewer')).toEqual({ ok: false, reason: 'duplicate' });
    expect(canAttachDevice(baseTeam(), 'uid-founder')).toEqual({ ok: false, reason: 'duplicate' });
  });

  test('rejects when the team already carries MAX_TEAM_DEVICES devices', () => {
    const uids = Array.from({ length: MAX_TEAM_DEVICES }, (_, i) => `uid-${i}`);
    const team = multiDeviceTeam({ deviceUids: uids, controllerUid: 'uid-0' });
    expect(canAttachDevice(team, 'uid-new')).toEqual({ ok: false, reason: 'full' });
  });

  test('rejects attaching to a finished team', () => {
    expect(canAttachDevice(multiDeviceTeam({ status: 'finished' }), 'uid-new')).toEqual({
      ok: false,
      reason: 'finished',
    });
  });
});

describe('canAddRunDevice (global per-run phone ceiling)', () => {
  // Pinned on purpose: the ceiling is a capacity claim about the server, so
  // moving it must be a deliberate edit here too, never a silent drift.
  //
  // 100 -> 150 on 2026-08-28 (change: hot-path-read-cost). The claim behind the new number was
  // MEASURED rather than assumed: against production with the Firestore op counter enabled, a
  // 120 team, 75 minute run projects to ~34,250 reads of a 50,000 daily ceiling and ~15,600
  // writes of 20,000, and the VPS sat at load 0.14 with 2.8 GB free through a 100 team
  // rehearsal. Note that DEVICES, not teams, is what the read budget scales with, because every
  // extra phone polls team state on its own.
  test('MAX_RUN_DEVICES is 150', () => {
    expect(MAX_RUN_DEVICES).toBe(150);
  });

  test('admits a phone while the run is below the ceiling', () => {
    expect(canAddRunDevice(0)).toEqual({ ok: true });
    expect(canAddRunDevice(MAX_RUN_DEVICES - 1)).toEqual({ ok: true });
  });

  test('refuses once the run already holds MAX_RUN_DEVICES phones', () => {
    expect(canAddRunDevice(MAX_RUN_DEVICES)).toEqual({ ok: false, reason: 'run-full' });
    expect(canAddRunDevice(MAX_RUN_DEVICES + 1)).toEqual({ ok: false, reason: 'run-full' });
  });
});

// ── Device-membership reverse index (fix: attached devices can't read live-ops) ──
// Firestore rules cannot query a collection, so from an announcement document
// there is no way to ask "is this uid in ANY team's deviceUids in this run".
// isAttachedDevice() only works on the team/chat docs because deviceUids sits on
// the very doc being read. A secondary phone therefore failed isRunParticipant()
// and got permission-denied on announcements / flashMissions / feedItems while
// PlayScreen rendered that UI unconditionally. The fix is a reverse index: a
// server-written marker keyed by the DEVICE uid that rules can `exists()`.
describe('FIRESTORE_PATHS.runDeviceMember (device-membership reverse index)', () => {
  test('is keyed by the DEVICE uid under the run, so rules can exists() it', () => {
    expect(FIRESTORE_PATHS.runDeviceMember('owner1', 'game1', 'run1', 'uid-viewer'))
      .toBe('users/owner1/games/game1/runs/run1/deviceMembers/uid-viewer');
  });

  test('exposes the collection path for the same run', () => {
    expect(FIRESTORE_PATHS.runDeviceMembersCol('owner1', 'game1', 'run1'))
      .toBe('users/owner1/games/game1/runs/run1/deviceMembers');
  });
});
