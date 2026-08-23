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

// ─── Pause-clock tasks (change: pause-clock-tasks) ───────────────────────────
// A paused task's duration is DELIBERATION (and, on a located task, transit) —
// not pace. It must make the team look neither faster nor slower than it is, so
// the record is dropped from the sample rather than adjusted.
describe('computeSkillRatio — a paused-clock task is not evidence of pace', () => {
  test('a long paused task does not make the team look slow', async () => {
    const gameTasks = [task('a', 10)];
    // 40 minutes on a 10-minute estimate would clamp to +1 ("much slower").
    const completed = [{ taskId: 'a', actualMinutes: 40, excludedMs: 40 * 60_000 }];
    expect(await computeSkillRatio(completed, gameTasks)).toBe(0);
  });

  test('an instantly completed paused task is still ignored (excludedMs: 0)', async () => {
    const gameTasks = [task('a', 10)];
    // Presence of the stamp is the marker, not its value — otherwise a paused task
    // finished in under a second would read as "-1", i.e. superhuman.
    const completed = [{ taskId: 'a', actualMinutes: 0, excludedMs: 0 }];
    expect(await computeSkillRatio(completed, gameTasks)).toBe(0);
  });

  test('only the unpaused rows contribute to the average', async () => {
    const gameTasks = [task('a', 10), task('b', 10)];
    const completed = [
      { taskId: 'a', actualMinutes: 5 },                              // (5-10)/10 = -0.5
      { taskId: 'b', actualMinutes: 60, excludedMs: 60 * 60_000 },    // paused → ignored
    ];
    expect(await computeSkillRatio(completed, gameTasks)).toBeCloseTo(-0.5, 5);
  });

  test('an all-paused history falls back to the neutral ratio', async () => {
    const gameTasks = [task('a', 10), task('b', 10)];
    const completed = [
      { taskId: 'a', actualMinutes: 40, excludedMs: 2_400_000 },
      { taskId: 'b', actualMinutes: 1, excludedMs: 60_000 },
    ];
    expect(await computeSkillRatio(completed, gameTasks)).toBe(0);
  });
});

// ─── Adaptive difficulty routing (change: adaptive-difficulty-routing) ───────
// The team's strength target is −skillRatio: a fast team (negative ratio) is
// routed toward HARDER tasks, a slow team toward easier ones, and a team with no
// history (ratio 0) has no difficulty preference at all. Always on — every
// scoring preset — so there is no `skillAware` argument any more.
describe('priorityScore — adaptive difficulty', () => {
  const team: GeoPoint = { lat: 31.79, lng: 35.16 };
  // Same coordinates as the team ⇒ identical (zero) transit; empty taskCounts and
  // the same cap ⇒ identical load. Only `difficulty` differs.
  const candidate = (id: string, difficulty: number): Task => ({
    id, title: id, type: 'field', coordinates: team, difficulty,
    estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 3,
  } as Task);

  test('a strong (fast) team is routed toward the harder task', () => {
    const easy = candidate('easy', 2);
    const hard = candidate('hard', 9);
    const strong = -0.8;
    expect(priorityScore(hard, team, strong, {})).toBeGreaterThan(
      priorityScore(easy, team, strong, {}),
    );
  });

  test('a weak (slow) team is routed toward the easier task', () => {
    const easy = candidate('easy', 2);
    const hard = candidate('hard', 9);
    const weak = 0.8;
    expect(priorityScore(easy, team, weak, {})).toBeGreaterThan(
      priorityScore(hard, team, weak, {}),
    );
  });

  test('a team with no history has no difficulty preference', () => {
    // Symmetric around difficulty 5 ⇒ the adaptive term is identical for both.
    const easy = candidate('easy', 2);
    const hard = candidate('hard', 8);
    expect(priorityScore(hard, team, 0, {})).toBeCloseTo(
      priorityScore(easy, team, 0, {}), 10,
    );
  });

  test('adaptation is always on — no preset gate, one unified formula', () => {
    // There is no longer a "skill-unaware" path: the same call (the only signature
    // that exists) adapts, so a fixed_points_speed / time_only run adapts too.
    const easy = candidate('easy', 2);
    const hard = candidate('hard', 9);
    expect(priorityScore(hard, team, -0.8, {}) - priorityScore(easy, team, -0.8, {}))
      .toBeGreaterThan(0);
    // …and the term is exactly 0.2 × the adaptive match on an otherwise-identical pair.
    const delta = priorityScore(hard, team, -0.8, {}) - priorityScore(easy, team, -0.8, {});
    const adaptive = (ratio: number, d: number) => 1 - Math.abs(-ratio - (d - 5) / 5);
    expect(delta).toBeCloseTo(0.2 * (adaptive(-0.8, 9) - adaptive(-0.8, 2)), 10);
  });

  test('strength monotonicity: getting faster never reduces the pull toward the harder task', () => {
    const easy = candidate('easy', 2);
    const hard = candidate('hard', 9);
    let prev = -Infinity;
    for (let ratio = 1; ratio >= -1.0001; ratio -= 0.1) {
      const pref = priorityScore(hard, team, ratio, {}) - priorityScore(easy, team, ratio, {});
      expect(pref).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = pref;
    }
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
    const withZone = priorityScore(inZone, team, 0, {}, zone, within);
    const noZone = priorityScore(inZone, team, 0, {}, null, within);
    expect(withZone - noZone).toBeCloseTo(HOT_ZONE_ROUTING_BONUS, 6);
  });

  test('no bonus when the zone is expired', () => {
    const after = t0 + 600_000;
    const withExpired = priorityScore(inZone, team, 0, {}, zone, after);
    const noZone = priorityScore(inZone, team, 0, {}, null, after);
    expect(withExpired).toBeCloseTo(noZone, 6);
  });

  test('no bonus for an out-of-zone task while the zone is active', () => {
    const withZone = priorityScore(outZone, team, 0, {}, zone, within);
    const noZone = priorityScore(outZone, team, 0, {}, null, within);
    expect(withZone).toBeCloseTo(noZone, 6);
  });

  test('a locationless task never receives the bonus', () => {
    const loose = { id: 'loose', title: 'loose', type: 'self_report', locationless: true,
      difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 3 } as Task;
    const withZone = priorityScore(loose, team, 0, {}, zone, within);
    const noZone = priorityScore(loose, team, 0, {}, null, within);
    expect(withZone).toBeCloseTo(noZone, 6);
  });

  // WO Fix 4: locationless tasks have no physical station, so occupancy must never
  // reduce their load factor (and the score must stay finite — the Infinity-cap
  // trap yields NaN, which poisons the sort).
  test('priorityScore — locationless is uncapped & finite', () => {
    const locationlessTask = { id: 'L', type: 'self_report', locationless: true, difficulty: 5 } as Task;
    const hi = priorityScore(locationlessTask, { lat: 0, lng: 0 }, 0, { L: 100 });
    const lo = priorityScore(locationlessTask, { lat: 0, lng: 0 }, 0, {});
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
    const inScore = priorityScore(farInZone, farTeam, 0, { farIn: 2 }, zone, within);
    const outScore = priorityScore(nearOut, farTeam, 0, {}, zone, within);
    expect(outScore).toBeGreaterThan(inScore);
  });
});
