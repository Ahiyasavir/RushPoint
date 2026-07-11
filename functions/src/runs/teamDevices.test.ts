import { expect, test, describe } from 'vitest';
import type { RunTeam } from '@rushpoint/shared';
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
  test('MAX_RUN_DEVICES is 16', () => {
    expect(MAX_RUN_DEVICES).toBe(16);
  });

  test('admits a phone while the run is below the ceiling', () => {
    expect(canAddRunDevice(0)).toEqual({ ok: true });
    expect(canAddRunDevice(15)).toEqual({ ok: true });
  });

  test('refuses once the run already holds MAX_RUN_DEVICES phones', () => {
    expect(canAddRunDevice(MAX_RUN_DEVICES)).toEqual({ ok: false, reason: 'run-full' });
    expect(canAddRunDevice(MAX_RUN_DEVICES + 1)).toEqual({ ok: false, reason: 'run-full' });
  });
});
