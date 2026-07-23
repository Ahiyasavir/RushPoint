// Pure-logic tests — per-interaction default task durations
// (change: task-duration-defaults).
//
// `Task.expectedDurationMinutes` had no author and no default, so a 20 second photo
// snap and a 10 minute puzzle were estimated identically. These assertions pin the
// derived-default table, its clamps, the explicit-override rule, and — critically —
// that NO scoring function learned about the default, so no live or finalised run
// moves by a point. Runs via `npm test` (scripts/run-unit-tests.mjs). No emulator.
import type { Task, TaskType } from '../packages/shared/src/types';
import {
  defaultExpectedDurationMinutes,
  effectiveExpectedDurationMinutes,
  TASK_DURATION_MIN_MINUTES,
  TASK_DURATION_MAX_MINUTES,
  SURVEY_MAX_DURATION_MINUTES,
  TASK_DURATION_FALLBACK_MINUTES,
} from '../packages/shared/src/taskDuration';
import { scoreFixedPointsSpeed } from '../packages/shared/src/scoringPresets';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${String(actual)}, want ${String(expected)})`, actual === expected);
}

/** Minimal task carrying only what the duration derivation reads. */
function t(over: Partial<Task> & { type?: unknown }): Task {
  return {
    id: 't1',
    title: 'T',
    type: 'field',
    coordinates: { lat: 0, lng: 0 },
    difficulty: 5,
    estimatedMinutes: 5,
    pointValue: 100,
    maxConcurrentTeams: 3,
    ...over,
  } as Task;
}

const ALL_TYPES: TaskType[] = [
  'field', 'smart_station', 'photo', 'self_report',
  'quiz', 'numeric', 'geofence', 'sequence', 'survey',
];

console.log('\n── constants ──────────────────────────────────────────────');
eq('MIN is 0.5', TASK_DURATION_MIN_MINUTES, 0.5);
eq('MAX is 30', TASK_DURATION_MAX_MINUTES, 30);
eq('survey ceiling is the owner stated 2', SURVEY_MAX_DURATION_MINUTES, 2);
eq('unknown-type fallback is 2', TASK_DURATION_FALLBACK_MINUTES, 2);

console.log('\n── every task type is safe ────────────────────────────────');
for (const type of ALL_TYPES) {
  const m = defaultExpectedDurationMinutes(t({ type }));
  ok(`${type}: finite, within [0.5, 30], never 0/negative/NaN (got ${m})`,
    Number.isFinite(m) && m >= TASK_DURATION_MIN_MINUTES && m <= TASK_DURATION_MAX_MINUTES);
}

console.log('\n── the number table ───────────────────────────────────────');
eq('geofence auto check-in', defaultExpectedDurationMinutes(t({ type: 'geofence' })), 0.5);
eq('field check-in', defaultExpectedDurationMinutes(t({ type: 'field' })), 1);
eq('self_report', defaultExpectedDurationMinutes(t({ type: 'self_report' })), 1);
eq('numeric', defaultExpectedDurationMinutes(t({ type: 'numeric' })), 1.5);
eq('photo capture', defaultExpectedDurationMinutes(t({ type: 'photo' })), 2);
eq('photo with audio capture',
  defaultExpectedDurationMinutes(t({ type: 'photo', smart: { enabled: true, verificationType: 'photo_upload', captureKind: 'audio' } })), 2);
eq('smart_station code entry (default verification)',
  defaultExpectedDurationMinutes(t({ type: 'smart_station' })), 3);
eq('smart_station code_verification',
  defaultExpectedDurationMinutes(t({ type: 'smart_station', smart: { enabled: true, verificationType: 'code_verification' } })), 3);
eq('smart_station photo_upload behaves like a photo',
  defaultExpectedDurationMinutes(t({ type: 'smart_station', smart: { enabled: true, verificationType: 'photo_upload' } })), 2);
eq('quiz with 4 choices', defaultExpectedDurationMinutes(t({ type: 'quiz', choices: ['a', 'b', 'c', 'd'] })), 2);
eq('quiz ordering with 3 items', defaultExpectedDurationMinutes(t({ type: 'quiz', orderItems: ['a', 'b', 'c'] })), 2.25);
eq('quiz ordering with 10 items',
  defaultExpectedDurationMinutes(t({ type: 'quiz', orderItems: Array.from({ length: 10 }, (_, i) => `i${i}`) })), 5);
eq('sequence with 1 step', defaultExpectedDurationMinutes(t({ type: 'sequence', steps: [{ id: 's1', prompt: 'p' }] })), 1.25);
eq('sequence with 6 steps',
  defaultExpectedDurationMinutes(t({ type: 'sequence', steps: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, prompt: 'p' })) })), 5);
eq('sequence with 12 steps',
  defaultExpectedDurationMinutes(t({ type: 'sequence', steps: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, prompt: 'p' })) })), 9.5);
eq('survey free text', defaultExpectedDurationMinutes(t({ type: 'survey' })), 2);
eq('survey with 2 choices', defaultExpectedDurationMinutes(t({ type: 'survey', surveyChoices: ['a', 'b'] })), 1);
eq('survey with 8 choices',
  defaultExpectedDurationMinutes(t({ type: 'survey', surveyChoices: Array.from({ length: 8 }, (_, i) => `c${i}`) })), 2);

console.log('\n── ordering relations the owner asked for ─────────────────');
ok('auto check-in < photo capture',
  defaultExpectedDurationMinutes(t({ type: 'geofence' })) < defaultExpectedDurationMinutes(t({ type: 'photo' })));
ok('photo capture < staffed code station',
  defaultExpectedDurationMinutes(t({ type: 'photo' })) < defaultExpectedDurationMinutes(t({ type: 'smart_station' })));
ok('a 12 step sequence > a 1 step sequence',
  defaultExpectedDurationMinutes(t({ type: 'sequence', steps: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, prompt: 'p' })) }))
  > defaultExpectedDurationMinutes(t({ type: 'sequence', steps: [{ id: 's1', prompt: 'p' }] })));

console.log('\n── the survey 2 minute ceiling holds ──────────────────────');
for (const n of [1, 5, 40]) {
  const m = defaultExpectedDurationMinutes(t({ type: 'survey', surveyChoices: Array.from({ length: n }, (_, i) => `c${i}`) }));
  ok(`survey with ${n} choices is <= 2 and > 0 (got ${m})`,
    Number.isFinite(m) && m > 0 && m <= SURVEY_MAX_DURATION_MINUTES);
}

console.log('\n── unknown / missing / garbage type ───────────────────────');
eq('unknown type falls back', defaultExpectedDurationMinutes(t({ type: 'teleport' })), TASK_DURATION_FALLBACK_MINUTES);
eq('missing type falls back', defaultExpectedDurationMinutes(t({ type: undefined })), TASK_DURATION_FALLBACK_MINUTES);
eq('non-string type falls back', defaultExpectedDurationMinutes(t({ type: 7 })), TASK_DURATION_FALLBACK_MINUTES);
eq('null task falls back', defaultExpectedDurationMinutes(null as unknown as Task), TASK_DURATION_FALLBACK_MINUTES);
eq('undefined task falls back', defaultExpectedDurationMinutes(undefined as unknown as Task), TASK_DURATION_FALLBACK_MINUTES);

console.log('\n── no content arrays ──────────────────────────────────────');
eq('quiz with no choices at all', defaultExpectedDurationMinutes(t({ type: 'quiz' })), 1.25);
eq('quiz with a garbage choices value',
  defaultExpectedDurationMinutes(t({ type: 'quiz', choices: 5 as unknown as string[] })), 1.25);
eq('sequence with no steps', defaultExpectedDurationMinutes(t({ type: 'sequence' })), 0.5);
eq('sequence with a garbage steps value',
  defaultExpectedDurationMinutes(t({ type: 'sequence', steps: 'nope' as unknown as Task['steps'] })), 0.5);
eq('survey with a garbage surveyChoices value',
  defaultExpectedDurationMinutes(t({ type: 'survey', surveyChoices: {} as unknown as string[] })), 2);

console.log('\n── explicit value wins ────────────────────────────────────');
eq('explicit 7 beats the photo default',
  effectiveExpectedDurationMinutes(t({ type: 'photo', expectedDurationMinutes: 7 })), 7);
eq('explicit 0.5 (the floor) is honoured',
  effectiveExpectedDurationMinutes(t({ type: 'photo', expectedDurationMinutes: 0.5 })), 0.5);
eq('no explicit value uses the derived default',
  effectiveExpectedDurationMinutes(t({ type: 'photo' })), 2);

console.log('\n── malformed explicit values fall back or clamp ───────────');
for (const bad of [NaN, Infinity, -Infinity, 0, -3, -0.001]) {
  const m = effectiveExpectedDurationMinutes(t({ type: 'photo', expectedDurationMinutes: bad }));
  eq(`explicit ${String(bad)} falls back to the default`, m, 2);
}
eq('an absurd 10000 clamps to the 30 minute max',
  effectiveExpectedDurationMinutes(t({ type: 'photo', expectedDurationMinutes: 10_000 })), TASK_DURATION_MAX_MINUTES);
eq('a non-number explicit value falls back',
  effectiveExpectedDurationMinutes(t({ type: 'photo', expectedDurationMinutes: '5' as unknown as number })), 2);

console.log('\n── scoring is UNCHANGED (no in-flight re-scoring) ─────────');
// A game whose single task omits BOTH duration fields. Before this change the task
// contributed 0 to the expected route total, so a team finishing in 10 minutes beat a
// target of 0 and earned NO speed bonus. That must still be true: the scoring path
// deliberately does not consult the derived default.
const gameNoDurations = { stages: [{ tasks: [{ /* no durations at all */ }] }] } as never;
const started = '2026-01-01T10:00:00.000Z';
const finished = '2026-01-01T10:10:00.000Z';
eq('expected total of 0 still yields no speed bonus',
  scoreFixedPointsSpeed([], started, finished, gameNoDurations), 0);
// And an explicit expectedDurationMinutes still drives the bonus exactly as before:
// 30 expected - 10 actual = 20 min * 10 pts = 200, capped at 200.
const gameExplicit = { stages: [{ tasks: [{ estimatedMinutes: 30, expectedDurationMinutes: 30 }] }] } as never;
eq('an explicit expected total still pays the same speed bonus',
  scoreFixedPointsSpeed([], started, finished, gameExplicit), 200);

console.log('');
if (failures > 0) {
  console.error(`✗ task-duration-defaults: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ task-duration-defaults: all assertions passed');
