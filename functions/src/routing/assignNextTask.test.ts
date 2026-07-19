import { expect, test, describe } from 'vitest';
import type { Task, HotZone, GeoPoint } from '@rushpoint/shared';
import { computeSkillRatio, priorityScore, HOT_ZONE_ROUTING_BONUS } from './assignNextTask';

// Minimal game task — only the fields computeSkillRatio reads (id, estimatedMinutes).
function task(id: string, estimatedMinutes: number): Task {
  return {
    id,
    title: id,
    type: 'field',
    coordinates: { lat: 31.78, lng: 35.21 },
    difficulty: 3,
    estimatedMinutes,
    pointValue: 100,
    maxConcurrentTeams: 3,
  } as Task;
}

describe('computeSkillRatio — finiteness invariant', () => {
  test('garbage timestamps never poison the ratio with NaN', async () => {
    const gameTasks = [task('a', 10)];
    const completed = [{ taskId: 'a', startedAt: 'not-a-date', completedAt: 'also-bad' }];
    const r = await computeSkillRatio(completed, gameTasks);
    expect(Number.isFinite(r)).toBe(true);
  });

  test('a garbage row does not corrupt a valid row in the same batch', async () => {
    const gameTasks = [task('a', 10), task('b', 10)];
    const completed = [
      { taskId: 'a', actualMinutes: 10 },            // exactly on estimate → 0
      { taskId: 'b', startedAt: 'x', completedAt: 'y' }, // garbage → must be ignored
    ];
    const r = await computeSkillRatio(completed, gameTasks);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(0); // only the valid on-estimate row counts
  });

  test('valid faster-than-estimate timing yields a negative ratio', async () => {
    const gameTasks = [task('a', 10)];
    const completed = [{ taskId: 'a', actualMinutes: 5 }]; // (5-10)/10 = -0.5
    const r = await computeSkillRatio(completed, gameTasks);
    expect(r).toBeCloseTo(-0.5, 5);
  });
});

// ─── Hot-zone routing bias (change: hot-zone-routing-bias) ────────────────────
describe('priorityScore — hot-zone routing bias', () => {
  const center: GeoPoint = { lat: 31.79, lng: 35.16 };
  const t0 = Date.parse('2026-01-01T12:00:00.000Z');
  const within = t0 + 60_000;
  const zone: HotZone = {
    center, radiusMeters: 150, multiplier: 3,
    startedAt: '2026-01-01T12:00:00.000Z',
    expiresAt: '2026-01-01T12:05:00.000Z',
  };
  // Two candidate tasks equidistant (~110m) from the team, opposite directions,
  // so load/transit/difficulty are identical — only zone membership differs.
  const team: GeoPoint = { lat: 31.79, lng: 35.16 };
  const located = (id: string, coordinates: GeoPoint): Task => ({
    id, title: id, type: 'field', coordinates, difficulty: 5,
    estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 3,
  } as Task);
  const inZone = located('in', { lat: 31.7908, lng: 35.16 });   // ~89m N of centre → inside 150m
  const outZone = located('out', { lat: 31.82, lng: 35.16 });   // ~3.4km N → well outside

  test('an in-zone task gets exactly the bonus over the same task with no zone', () => {
    const withZone = priorityScore(inZone, team, 0, {}, false, zone, within);
    const noZone = priorityScore(inZone, team, 0, {}, false, null, within);
    expect(withZone - noZone).toBeCloseTo(HOT_ZONE_ROUTING_BONUS, 6);
  });

  test('no bonus when the zone is expired', () => {
    const after = t0 + 600_000;
    const withExpired = priorityScore(inZone, team, 0, {}, false, zone, after);
    const noZone = priorityScore(inZone, team, 0, {}, false, null, after);
    expect(withExpired).toBeCloseTo(noZone, 6);
  });

  test('no bonus for an out-of-zone task while the zone is active', () => {
    const withZone = priorityScore(outZone, team, 0, {}, false, zone, within);
    const noZone = priorityScore(outZone, team, 0, {}, false, null, within);
    expect(withZone).toBeCloseTo(noZone, 6);
  });

  test('a locationless task never receives the bonus', () => {
    const loose = { id: 'loose', title: 'loose', type: 'self_report', locationless: true,
      difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 3 } as Task;
    const withZone = priorityScore(loose, team, 0, {}, false, zone, within);
    const noZone = priorityScore(loose, team, 0, {}, false, null, within);
    expect(withZone).toBeCloseTo(noZone, 6);
  });

  // WO Fix 4: locationless tasks have no physical station, so occupancy must never
  // reduce their load factor (and the score must stay finite — the Infinity-cap
  // trap yields NaN, which poisons the sort).
  test('priorityScore — locationless is uncapped & finite', () => {
    const locationlessTask = { id: 'L', type: 'self_report', locationless: true, difficulty: 5 } as Task;
    const hi = priorityScore(locationlessTask, { lat: 0, lng: 0 }, 0, { L: 100 }, false);
    const lo = priorityScore(locationlessTask, { lat: 0, lng: 0 }, 0, {}, false);
    expect(hi).toBe(lo); // load must not degrade with occupancy
    expect(Number.isFinite(hi)).toBe(true); // guards the NaN trap
  });

  test('the bias is a nudge, not an override — a loaded in-zone task can lose to an empty near out-of-zone task', () => {
    // The team sits ~1.1km N of the zone centre. The in-zone task is near its cap
    // (2/3 full) AND ~1.1km away; the out-of-zone task is empty and right at the
    // team (zero transit). The bonus applies to the in-zone task but doesn't
    // overcome its load + distance handicap.
    const farTeam: GeoPoint = { lat: 31.80, lng: 35.16 };
    const farInZone = located('farIn', { lat: 31.7905, lng: 35.16 }); // ~55m from centre → in zone
    const nearOut = located('nearOut', farTeam);                       // ~1.1km from centre → out of zone
    const inScore = priorityScore(farInZone, farTeam, 0, { farIn: 2 }, false, zone, within);
    const outScore = priorityScore(nearOut, farTeam, 0, {}, false, zone, within);
    expect(outScore).toBeGreaterThan(inScore);
  });
});
