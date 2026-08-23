// Visible task estimate = interaction + transit allowance (change: visible-time-estimates).
//
// RED-first: this file is written against ./taskEstimate before that module exists.
import { describe, expect, test } from 'vitest';
import type { Task } from './types';
import { defaultExpectedDurationMinutes } from './taskDuration';
import {
  TASK_ESTIMATE_MAX_MINUTES,
  TASK_ESTIMATE_MIN_MINUTES,
  TRANSIT_MAX_MINUTES,
  TRANSIT_UNKNOWN_MINUTES,
  defaultEstimatedMinutes,
  effectiveEstimatedMinutes,
  transitAllowanceMinutes,
} from './taskEstimate';

// A minimal task. `coordinates` defaults to the builder's unplaced 0,0 sentinel.
const t = (over: Record<string, unknown> = {}): Task => ({
  id: 'x', title: 'x', type: 'field', coordinates: { lat: 0, lng: 0 },
  difficulty: 5, estimatedMinutes: 15, pointValue: 100, maxConcurrentTeams: 3, tags: [],
  ...over,
} as unknown as Task);

// Jerusalem Old City-ish anchor, plus offsets in (roughly) metres of latitude.
const AT = { lat: 31.7767, lng: 35.2345 };
const north = (metres: number) => ({ lat: AT.lat + metres / 111_320, lng: AT.lng });

const ALL_TYPES = [
  'geofence', 'field', 'self_report', 'numeric', 'photo',
  'smart_station', 'quiz', 'survey', 'sequence',
] as const;

const isWholeInRange = (n: number) =>
  Number.isFinite(n) && Number.isInteger(n)
  && n >= TASK_ESTIMATE_MIN_MINUTES && n <= TASK_ESTIMATE_MAX_MINUTES;

describe('defaultEstimatedMinutes — every interaction type', () => {
  for (const type of ALL_TYPES) {
    test(`${type} derives a whole number inside the clamp`, () => {
      const task = t({ type, coordinates: AT });
      const siblings = [t({ id: 's', coordinates: north(300) })];
      const m = defaultEstimatedMinutes(task, siblings);
      expect(isWholeInRange(m)).toBe(true);
    });

    test(`${type} is never below its own interaction duration`, () => {
      const task = t({ type, coordinates: AT });
      const m = defaultEstimatedMinutes(task, [t({ id: 's', coordinates: north(300) })]);
      // The walk can only ADD. Rounding to a whole minute can shave at most 0.5.
      expect(m).toBeGreaterThanOrEqual(Math.round(defaultExpectedDurationMinutes(task)));
    });
  }
});

describe('transit allowance', () => {
  test('a locationless task is charged exactly zero travel', () => {
    const task = t({ type: 'quiz', locationless: true, coordinates: AT });
    expect(transitAllowanceMinutes(task, [t({ id: 's', coordinates: north(9_000) })])).toBe(0);
  });

  test('a locationless task estimate is the interaction alone', () => {
    const task = t({ type: 'photo', locationless: true });
    expect(defaultEstimatedMinutes(task, [t({ id: 's', coordinates: north(4_000) })]))
      .toBe(Math.max(TASK_ESTIMATE_MIN_MINUTES, Math.round(defaultExpectedDurationMinutes(task))));
  });

  test('an instant trigger mode is treated as locationless', () => {
    const task = t({ type: 'field', triggerMode: 'instant' });
    expect(transitAllowanceMinutes(task, [t({ id: 's', coordinates: north(1_000) })])).toBe(0);
  });

  test('the unplaced 0,0 sentinel is charged the unknown-leg constant', () => {
    expect(transitAllowanceMinutes(t({ type: 'field' }), [t({ id: 's', coordinates: AT })]))
      .toBe(TRANSIT_UNKNOWN_MINUTES);
  });

  test('absent coordinates are charged the unknown-leg constant', () => {
    expect(transitAllowanceMinutes(t({ type: 'field', coordinates: undefined }), []))
      .toBe(TRANSIT_UNKNOWN_MINUTES);
  });

  test('absurd coordinates are charged the unknown-leg constant, not a throw', () => {
    const task = t({ type: 'field', coordinates: { lat: 900, lng: -4_000 } });
    expect(transitAllowanceMinutes(task, [t({ id: 's', coordinates: AT })]))
      .toBe(TRANSIT_UNKNOWN_MINUTES);
  });

  test('NaN coordinates are charged the unknown-leg constant, not a throw', () => {
    const task = t({ type: 'field', coordinates: { lat: NaN, lng: NaN } });
    expect(transitAllowanceMinutes(task, [t({ id: 's', coordinates: AT })]))
      .toBe(TRANSIT_UNKNOWN_MINUTES);
    expect(transitAllowanceMinutes(t({ type: 'field', coordinates: AT }),
      [t({ id: 's', coordinates: { lat: NaN, lng: 0 } })])).toBe(TRANSIT_UNKNOWN_MINUTES);
  });

  test('a single-stop stage is charged the unknown-leg constant, NOT zero', () => {
    expect(transitAllowanceMinutes(t({ type: 'field', coordinates: AT }), []))
      .toBe(TRANSIT_UNKNOWN_MINUTES);
  });

  test('a sibling list that is not an array is treated as no siblings', () => {
    expect(transitAllowanceMinutes(t({ type: 'field', coordinates: AT }),
      'nope' as unknown as Task[])).toBe(TRANSIT_UNKNOWN_MINUTES);
    expect(transitAllowanceMinutes(t({ type: 'field', coordinates: AT }),
      undefined)).toBe(TRANSIT_UNKNOWN_MINUTES);
  });

  test('only the task itself in the sibling list still counts as a single-stop stage', () => {
    const task = t({ id: 'me', type: 'field', coordinates: AT });
    expect(transitAllowanceMinutes(task, [task])).toBe(TRANSIT_UNKNOWN_MINUTES);
  });

  test('the MEDIAN leg is used, not the mean', () => {
    const task = t({ id: 'me', type: 'field', coordinates: AT });
    const siblings = [
      t({ id: 'a', coordinates: north(100) }),
      t({ id: 'b', coordinates: north(120) }),
      t({ id: 'c', coordinates: north(4_000) }),
    ];
    // Median leg is 120 m => 0.12 km * 12 min/km = 1.44 min, floored by TRANSIT_MIN (1).
    // The mean leg would be ~1.4 km => ~16.5 min, which the clamp would show as
    // TRANSIT_MAX. Assert we are nowhere near that.
    const allowance = transitAllowanceMinutes(task, siblings);
    expect(allowance).toBeLessThan(3);
    expect(allowance).toBeGreaterThanOrEqual(1);
  });

  test('a far-flung stage clamps at the maximum allowance', () => {
    const task = t({ id: 'me', type: 'field', coordinates: AT });
    const siblings = [
      t({ id: 'a', coordinates: north(20_000) }),
      t({ id: 'b', coordinates: north(30_000) }),
    ];
    expect(transitAllowanceMinutes(task, siblings)).toBe(TRANSIT_MAX_MINUTES);
    expect(defaultEstimatedMinutes(task, siblings)).toBeLessThanOrEqual(TASK_ESTIMATE_MAX_MINUTES);
  });

  test('two stops in one courtyard still cost the minimum allowance', () => {
    const task = t({ id: 'me', type: 'field', coordinates: AT });
    expect(transitAllowanceMinutes(task, [t({ id: 'a', coordinates: north(5) })])).toBe(1);
  });

  test('unplaced siblings are ignored when measuring the legs', () => {
    const task = t({ id: 'me', type: 'field', coordinates: AT });
    const withUnplaced = [t({ id: 'a', coordinates: { lat: 0, lng: 0 } }), t({ id: 'b', coordinates: north(300) })];
    expect(transitAllowanceMinutes(task, withUnplaced))
      .toBe(transitAllowanceMinutes(task, [t({ id: 'b', coordinates: north(300) })]));
  });

  test('a locationless sibling is ignored when measuring the legs', () => {
    const task = t({ id: 'me', type: 'field', coordinates: AT });
    const siblings = [t({ id: 'a', locationless: true, coordinates: north(9_000) }), t({ id: 'b', coordinates: north(300) })];
    expect(transitAllowanceMinutes(task, siblings))
      .toBe(transitAllowanceMinutes(task, [t({ id: 'b', coordinates: north(300) })]));
  });
});

describe('clamps and total safety', () => {
  test('a null/undefined task still yields a safe number', () => {
    expect(isWholeInRange(defaultEstimatedMinutes(null, []))).toBe(true);
    expect(isWholeInRange(defaultEstimatedMinutes(undefined, []))).toBe(true);
  });

  test('an unknown type still yields a safe number', () => {
    expect(isWholeInRange(defaultEstimatedMinutes(t({ type: 'teleport' }), []))).toBe(true);
  });

  test('never zero or negative, whatever the shape', () => {
    const shapes = [
      t({ type: 'geofence', locationless: true }),
      t({ type: 'survey', locationless: true, surveyChoices: ['a', 'b'] }),
      t({ type: 'geofence', coordinates: AT }),
    ];
    for (const s of shapes) {
      expect(defaultEstimatedMinutes(s, [])).toBeGreaterThanOrEqual(TASK_ESTIMATE_MIN_MINUTES);
    }
  });

  test('a 12-step sequence in a far-flung stage stays inside the ceiling', () => {
    const task = t({
      id: 'me', type: 'sequence', coordinates: AT,
      steps: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, prompt: 'p' })),
    });
    expect(defaultEstimatedMinutes(task, [t({ id: 'a', coordinates: north(50_000) })]))
      .toBeLessThanOrEqual(TASK_ESTIMATE_MAX_MINUTES);
  });
});

describe('effectiveEstimatedMinutes — an authored value wins', () => {
  test('an explicit estimate wins over the derived default', () => {
    expect(effectiveEstimatedMinutes(t({ type: 'field', coordinates: AT, estimatedMinutes: 22 }), []))
      .toBe(22);
  });

  test('a malformed explicit estimate falls back to the derived default', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -5, '9' as unknown as number, null as unknown as number]) {
      const task = t({ type: 'photo', coordinates: AT, estimatedMinutes: bad });
      const m = effectiveEstimatedMinutes(task, []);
      expect(m).toBe(defaultEstimatedMinutes(task, []));
      expect(isWholeInRange(m)).toBe(true);
    }
  });

  test('an absurd explicit estimate is clamped, not trusted', () => {
    expect(effectiveEstimatedMinutes(t({ type: 'field', estimatedMinutes: 10_000 }), []))
      .toBe(TASK_ESTIMATE_MAX_MINUTES);
  });
});
