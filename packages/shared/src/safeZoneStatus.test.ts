// `team.outOfBounds` used to be a LATCH WITH A SINGLE OPENER (change: out-of-bounds-recovery).
//
// It was set from one raw fix (`functions/src/index.ts:340-350`) and cleared only by a later fix
// proving the team came back (`:351-352`). Accuracy was never even transmitted, the flag carried no
// timestamp, no timeout existed, and no staff callable could write it — so a phone whose GPS died
// after a single (possibly bogus) out-of-zone reading blocked its team for the rest of the run.
//
// `evaluateSafeZoneStatus` replaces the raw predicate at the decision points. It is PURE and TOTAL:
// every input maps to an explicit verdict + reason, it never throws, and it FAILS OPEN — absent,
// malformed, stale or low-confidence signal is never treated as proof of a violation. These tests
// are the contract; the fail-open branches are the ones that keep a player from being stranded.
//
// Fixtures only: no clock reads, no emulator, no I/O.

import { describe, it, expect } from 'vitest';
import {
  evaluateSafeZoneStatus,
  isOutsideSafeZone,
  DEFAULT_SAFE_ZONE_STALE_MS,
  DEFAULT_MAX_TRUSTED_ACCURACY_M,
  type SafeZone,
  type SafeZoneReason,
} from './safeZone';

const NOW = 1_800_000_000_000; // a fixed "server now"; nothing here reads a real clock
const ZONE: SafeZone = { center: { lat: 31.78, lng: 35.21 }, radiusMeters: 150 };

// One degree of latitude ≈ 111_320 m, so a metre offset north is exact enough for
// boundary work at ±1 m and keeps the assertions about the PREDICATE rather than
// about a hand-tuned magic coordinate.
const M_PER_DEG_LAT = 111_320;
function northOfCenter(meters: number, zone: SafeZone = ZONE) {
  return { lat: zone.center.lat + meters / M_PER_DEG_LAT, lng: zone.center.lng };
}

/** A fresh, confident fix `meters` north of the zone centre. */
function fixAt(meters: number, extra: { accuracyMeters?: number; atMs?: number | null } = {}) {
  return {
    ...northOfCenter(meters),
    accuracyMeters: extra.accuracyMeters ?? 5,
    atMs: extra.atMs === undefined ? NOW : extra.atMs,
  };
}

function verdict(
  fix: unknown,
  opts: { nowMs?: number; overrideUntilMs?: number; zone?: SafeZone | null } = {},
) {
  return evaluateSafeZoneStatus({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fix: fix as any,
    safeZone: opts.zone === undefined ? ZONE : opts.zone,
    nowMs: opts.nowMs ?? NOW,
    overrideUntilMs: opts.overrideUntilMs,
  });
}

describe('evaluateSafeZoneStatus — position', () => {
  it('at the centre is inside', () => {
    const r = verdict(fixAt(0));
    expect(r.outOfBounds).toBe(false);
    expect(r.reason).toBe('inside');
  });

  it('well inside is inside', () => {
    expect(verdict(fixAt(80)).reason).toBe('inside');
  });

  it('well outside, with a tight fix, is outside', () => {
    const r = verdict(fixAt(900));
    expect(r.outOfBounds).toBe(true);
    expect(r.reason).toBe('outside');
    expect(r.distanceMeters).toBeGreaterThan(ZONE.radiusMeters);
  });

  it('exactly on the radius is INSIDE (on-boundary is inside)', () => {
    const r = verdict(fixAt(ZONE.radiusMeters, { accuracyMeters: 0 }));
    expect(r.outOfBounds).toBe(false);
    expect(r.reason).toBe('inside');
  });

  it('one metre beyond the radius, with a confident fix, is outside', () => {
    const r = verdict(fixAt(ZONE.radiusMeters + 1, { accuracyMeters: 0 }));
    expect(r.outOfBounds).toBe(true);
    expect(r.reason).toBe('outside');
  });

  it('one metre inside the radius is inside', () => {
    expect(verdict(fixAt(ZONE.radiusMeters - 1, { accuracyMeters: 0 })).reason).toBe('inside');
  });
});

describe('evaluateSafeZoneStatus — confidence (the fix that only APPEARS outside)', () => {
  it('outside by less than its own accuracy radius is low confidence, not a breach', () => {
    // 50 m past a 150 m boundary, reported with ±200 m accuracy: the team may well be
    // standing in the middle of the zone. Flagging them here is the trap.
    const r = verdict(fixAt(ZONE.radiusMeters + 50, { accuracyMeters: 200 }));
    expect(r.outOfBounds).toBe(false);
    expect(r.reason).toBe('low_confidence');
  });

  it('the same position with a tight fix IS a breach', () => {
    expect(verdict(fixAt(ZONE.radiusMeters + 50, { accuracyMeters: 5 })).reason).toBe('outside');
  });

  it('outside by exactly its accuracy radius is still low confidence (strict >)', () => {
    const r = verdict(fixAt(ZONE.radiusMeters + 40, { accuracyMeters: 40 }));
    expect(r.reason).toBe('low_confidence');
  });

  it('an accuracy worse than the trust ceiling never flags, however far away', () => {
    const r = verdict(fixAt(5000, { accuracyMeters: DEFAULT_MAX_TRUSTED_ACCURACY_M + 1 }));
    expect(r.outOfBounds).toBe(false);
    expect(r.reason).toBe('low_confidence');
  });

  it('an accuracy exactly at the trust ceiling is still usable', () => {
    const r = verdict(fixAt(5000, { accuracyMeters: DEFAULT_MAX_TRUSTED_ACCURACY_M }));
    expect(r.reason).toBe('outside');
  });

  for (const [label, accuracyMeters] of [
    ['missing', undefined],
    ['null', null],
    ['zero', 0],
    ['negative', -50],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ] as const) {
    it(`${label} accuracy widens nothing (a breach stays a breach)`, () => {
      const r = verdict({ ...northOfCenter(900), accuracyMeters, atMs: NOW });
      expect(r.reason).toBe('outside');
      expect(r.confidenceMeters).toBe(0);
    });
  }
});

describe('evaluateSafeZoneStatus — absent and malformed fixes fail OPEN', () => {
  it('no fix ever reported (undefined) is not a violation', () => {
    const r = verdict(undefined);
    expect(r.outOfBounds).toBe(false);
    expect(r.reason).toBe('no_fix');
    expect(r.distanceMeters).toBeNull();
  });

  it('no fix ever reported (null) is not a violation', () => {
    expect(verdict(null).reason).toBe('no_fix');
  });

  it('a fix object with absent coordinates is not a violation', () => {
    expect(verdict({ atMs: NOW }).reason).toBe('no_fix');
    expect(verdict({ lat: 31.78, atMs: NOW }).reason).toBe('no_fix');
    expect(verdict({ lng: 35.21, atMs: NOW }).reason).toBe('no_fix');
  });

  for (const bad of [NaN, Infinity, -Infinity]) {
    it(`non-finite coordinates (${bad}) return invalid_fix and DO NOT THROW`, () => {
      expect(() => verdict({ lat: bad, lng: 35.21, atMs: NOW })).not.toThrow();
      expect(verdict({ lat: bad, lng: 35.21, atMs: NOW }).reason).toBe('invalid_fix');
      expect(verdict({ lat: 31.78, lng: bad, atMs: NOW }).reason).toBe('invalid_fix');
      expect(verdict({ lat: bad, lng: 35.21, atMs: NOW }).outOfBounds).toBe(false);
    });
  }

  it('string coordinates are invalid, not silently coerced', () => {
    expect(verdict({ lat: '31.78', lng: '35.21', atMs: NOW }).reason).toBe('invalid_fix');
  });

  it('the raw predicate keeps its throwing contract (unchanged by this change)', () => {
    expect(() => isOutsideSafeZone({ lat: NaN, lng: 35.21 }, ZONE)).toThrow();
  });
});

describe('evaluateSafeZoneStatus — staleness and clock skew', () => {
  const outside = (atMs: number | null | undefined) =>
    verdict({ ...northOfCenter(900), accuracyMeters: 5, atMs });

  it('a fix just under the staleness limit still counts', () => {
    expect(outside(NOW - (DEFAULT_SAFE_ZONE_STALE_MS - 1)).reason).toBe('outside');
  });

  it('a fix exactly at the staleness limit still counts', () => {
    expect(outside(NOW - DEFAULT_SAFE_ZONE_STALE_MS).reason).toBe('outside');
  });

  it('a fix just past the staleness limit fails open', () => {
    const r = outside(NOW - (DEFAULT_SAFE_ZONE_STALE_MS + 1));
    expect(r.outOfBounds).toBe(false);
    expect(r.reason).toBe('stale_fix');
    expect(r.stalenessMs).toBe(DEFAULT_SAFE_ZONE_STALE_MS + 1);
  });

  it('a device that went silent for hours releases its team', () => {
    expect(outside(NOW - 6 * 60 * 60 * 1000).reason).toBe('stale_fix');
  });

  for (const [label, atMs] of [
    ['missing', undefined],
    ['null', null],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ] as const) {
    it(`an unknown fix age (${label}) fails open`, () => {
      const r = outside(atMs);
      expect(r.outOfBounds).toBe(false);
      expect(r.reason).toBe('stale_fix');
      expect(r.stalenessMs).toBeNull();
    });
  }

  it('a device clock AHEAD of the server is clamped to zero age, not treated as stale', () => {
    const r = outside(NOW + 10 * 60 * 1000);
    expect(r.stalenessMs).toBe(0);
    expect(r.reason).toBe('outside');
  });

  it('a non-finite server clock cannot flag anyone', () => {
    const r = evaluateSafeZoneStatus({
      fix: fixAt(900),
      safeZone: ZONE,
      nowMs: NaN,
    });
    expect(r.outOfBounds).toBe(false);
    expect(r.reason).toBe('stale_fix');
  });
});

describe('evaluateSafeZoneStatus — staff override', () => {
  it('an active override beats a fresh, confident, genuinely outside fix', () => {
    const r = verdict(fixAt(900), { overrideUntilMs: NOW + 1 });
    expect(r.outOfBounds).toBe(false);
    expect(r.reason).toBe('override');
  });

  it('an override expiring exactly now does not apply', () => {
    expect(verdict(fixAt(900), { overrideUntilMs: NOW }).reason).toBe('outside');
  });

  it('an expired override does not apply', () => {
    expect(verdict(fixAt(900), { overrideUntilMs: NOW - 1 }).reason).toBe('outside');
  });

  for (const bad of [NaN, Infinity, -Infinity]) {
    it(`a non-finite override (${bad}) is ignored, not treated as forever`, () => {
      expect(verdict(fixAt(900), { overrideUntilMs: bad }).reason).toBe('outside');
    });
  }
});

describe('evaluateSafeZoneStatus — zone shape', () => {
  for (const [label, zone] of [
    ['undefined', undefined],
    ['null', null],
    ['zero radius', { center: ZONE.center, radiusMeters: 0 }],
    ['negative radius', { center: ZONE.center, radiusMeters: -100 }],
    ['NaN radius', { center: ZONE.center, radiusMeters: NaN }],
    ['non-finite centre', { center: { lat: NaN, lng: 35.21 }, radiusMeters: 150 }],
  ] as const) {
    it(`${label} means there is no boundary at all`, () => {
      const r = evaluateSafeZoneStatus({
        fix: fixAt(50_000),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        safeZone: zone as any,
        nowMs: NOW,
      });
      expect(r.outOfBounds).toBe(false);
      expect(r.reason).toBe('no_zone');
    });
  }
});

describe('evaluateSafeZoneStatus — totality', () => {
  const REASONS: SafeZoneReason[] = [
    'no_zone', 'override', 'no_fix', 'invalid_fix', 'stale_fix', 'low_confidence', 'inside', 'outside',
  ];

  const fixes: unknown[] = [
    undefined, null, {}, 'nonsense', 42, [],
    { lat: 31.78, lng: 35.21 },
    { lat: NaN, lng: NaN, atMs: NaN },
    fixAt(0), fixAt(150), fixAt(151), fixAt(900),
    fixAt(900, { accuracyMeters: 1000 }),
    fixAt(900, { atMs: NOW - 10 * 60 * 1000 }),
    { lat: 31.78, lng: 35.21, accuracyMeters: -1, atMs: NOW + 1e12 },
  ];
  const zones: unknown[] = [
    undefined, null, ZONE,
    { center: ZONE.center, radiusMeters: 0 },
    { center: ZONE.center, radiusMeters: NaN },
    { radiusMeters: 100 },
    {},
  ];
  const nows = [NOW, 0, NaN, -1];
  const overrides = [undefined, NOW + 1000, NOW - 1000, NaN];

  it('never throws and always returns a known reason consistent with the verdict', () => {
    for (const fix of fixes) {
      for (const safeZone of zones) {
        for (const nowMs of nows) {
          for (const overrideUntilMs of overrides) {
            const r = evaluateSafeZoneStatus({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              fix: fix as any, safeZone: safeZone as any, nowMs, overrideUntilMs,
            });
            expect(REASONS).toContain(r.reason);
            expect(r.outOfBounds).toBe(r.reason === 'outside');
          }
        }
      }
    }
  });
});
