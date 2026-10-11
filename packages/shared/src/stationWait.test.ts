import { describe, it, expect } from 'vitest';
import {
  STATION_WAIT_GAP_MS, STATION_WAIT_HEARTBEAT_MS,
  stationWaitCreditMs, settleStationWait, stationWaitStamp, teamStationWaitMs, isWaitingForStation,
} from './stationWait';
import { raceElapsedMs } from './pausedClock';

const T0 = Date.parse('2026-10-10T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('stationWaitCreditMs', () => {
  it('credits a phone that kept asking up to the moment it got a station', () => {
    const team = { stationWaitSince: iso(T0), stationWaitSeenAt: iso(T0 + 115_000) };
    expect(stationWaitCreditMs(team, T0 + 120_000)).toBe(120_000);
  });
  it('stops crediting a phone that went quiet, one allowance after it last asked', () => {
    const team = { stationWaitSince: iso(T0), stationWaitSeenAt: iso(T0 + 40_000) };
    expect(stationWaitCreditMs(team, T0 + 20 * 60_000)).toBe(40_000 + STATION_WAIT_GAP_MS);
  });
  it('reads a missing "seen" stamp as the start of the wait', () => {
    expect(stationWaitCreditMs({ stationWaitSince: iso(T0) }, T0 + 10 * 60_000)).toBe(STATION_WAIT_GAP_MS);
  });
  it('is zero with no open wait, on garbage, and when the clock runs backwards', () => {
    expect(stationWaitCreditMs({}, T0)).toBe(0);
    expect(stationWaitCreditMs(null, T0)).toBe(0);
    expect(stationWaitCreditMs({ stationWaitSince: 'nonsense' }, T0)).toBe(0);
    expect(stationWaitCreditMs({ stationWaitSince: iso(T0) }, T0 - 5_000)).toBe(0);
    expect(stationWaitCreditMs({ stationWaitSince: iso(T0) }, NaN)).toBe(0);
    // A "seen" stamp before the start cannot produce a negative credit.
    expect(stationWaitCreditMs({ stationWaitSince: iso(T0), stationWaitSeenAt: iso(T0 - 10 * 60_000) }, T0 + 5_000)).toBe(0);
  });
});

describe('settleStationWait', () => {
  it('is null when nothing is open, so a caller writes nothing', () => {
    expect(settleStationWait({ stationWaitMs: 9_000 }, T0)).toBeNull();
  });
  it('adds the credit to what was already settled', () => {
    const team = { stationWaitSince: iso(T0), stationWaitSeenAt: iso(T0 + 28_000), stationWaitMs: 9_000 };
    expect(settleStationWait(team, T0 + 30_000)).toEqual({ addedMs: 30_000, totalMs: 39_000 });
  });
  it('ignores a corrupt settled total instead of propagating it', () => {
    const team = { stationWaitSince: iso(T0), stationWaitSeenAt: iso(T0 + 1_000), stationWaitMs: NaN };
    expect(settleStationWait(team, T0 + 2_000)).toEqual({ addedMs: 2_000, totalMs: 2_000 });
  });
});

describe('stationWaitStamp', () => {
  it('starts a wait, then beats only once the last stamp is old', () => {
    expect(stationWaitStamp({}, T0)).toBe('start');
    const open = { stationWaitSince: iso(T0), stationWaitSeenAt: iso(T0) };
    expect(stationWaitStamp(open, T0 + STATION_WAIT_HEARTBEAT_MS - 1)).toBe('none');
    expect(stationWaitStamp(open, T0 + STATION_WAIT_HEARTBEAT_MS)).toBe('beat');
  });
  it('restarts a wait whose phone was quiet past the allowance (the old one is settled first)', () => {
    const stale = { stationWaitSince: iso(T0), stationWaitSeenAt: iso(T0 + 10_000) };
    expect(stationWaitStamp(stale, T0 + 10_000 + STATION_WAIT_GAP_MS + 1)).toBe('restart');
  });
  it('the heartbeat is shorter than the allowance, or an asking phone would lose time', () => {
    expect(STATION_WAIT_HEARTBEAT_MS + 10_000).toBeLessThan(STATION_WAIT_GAP_MS);
  });
});

describe('reading it', () => {
  it('teamStationWaitMs is total', () => {
    expect(teamStationWaitMs({ stationWaitMs: 4_000 })).toBe(4_000);
    for (const bad of [undefined, null, {}, { stationWaitMs: -1 }, { stationWaitMs: NaN }, { stationWaitMs: '5' }]) {
      expect(teamStationWaitMs(bad as never)).toBe(0);
    }
  });
  it('isWaitingForStation needs a readable start', () => {
    expect(isWaitingForStation({ stationWaitSince: iso(T0) })).toBe(true);
    expect(isWaitingForStation({ stationWaitSince: 'x' })).toBe(false);
    expect(isWaitingForStation({})).toBe(false);
  });
  it('the race clock stands still while the team waits, and never counts a settled wait', () => {
    const start = iso(T0);
    const waiting = { startedAt: start, stationWaitSince: iso(T0 + 60_000), stationWaitMs: 10_000 };
    expect(raceElapsedMs(waiting, T0 + 60_000)).toBe(50_000);
    expect(raceElapsedMs(waiting, T0 + 300_000)).toBe(50_000);
    const playing = { startedAt: start, stationWaitMs: 10_000 };
    expect(raceElapsedMs(playing, T0 + 300_000)).toBe(290_000);
    // A hold and a wait are separate totals; both come off.
    expect(raceElapsedMs({ ...playing, heldMs: 20_000 }, T0 + 300_000)).toBe(270_000);
  });
});
