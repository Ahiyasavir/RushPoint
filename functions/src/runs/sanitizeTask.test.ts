import { expect, test, describe } from 'vitest';
import type { Task } from '@rushpoint/shared';
import { sanitizeTaskForParticipant } from './sanitizeTask';

// A minimal located task factory — only the fields the sanitizer reads.
function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Find the fountain',
    type: 'field',
    coordinates: { lat: 31.78, lng: 35.21 },
    difficulty: 3,
    estimatedMinutes: 5,
    pointValue: 100,
    maxConcurrentTeams: 3,
    geofenceRadiusMeters: 40,
    triggerMode: 'radius',
    ...overrides,
  };
}

describe('sanitizeTaskForParticipant — secrecy invariants (existing)', () => {
  test('a visible located task keeps its coordinates and has no locationHidden flag', () => {
    const out = sanitizeTaskForParticipant(baseTask()) as Record<string, unknown>;
    expect(out.coordinates).toEqual({ lat: 31.78, lng: 35.21 });
    expect(out.locationHidden).toBeUndefined();
  });

  test('the paid hint text is always stripped (only hasHint/hintPenalty exposed)', () => {
    const out = sanitizeTaskForParticipant(
      baseTask({ hint: 'look behind the tree', hintPenalty: 30 }),
    ) as Record<string, unknown>;
    expect(out.hint).toBeUndefined();
    expect(out.hasHint).toBe(true);
    expect(out.hintPenalty).toBe(30);
  });

  // Full answer-key secrecy contract (callable-test-coverage): a single task
  // carrying EVERY secret field at once must reach the client with none of them.
  test('every answer key is stripped while renderable fields survive', () => {
    const out = sanitizeTaskForParticipant(
      baseTask({
        type: 'quiz',
        answers: ['Paris', 'paris'],
        numericAnswer: 42,
        steps: [{ id: 's1', prompt: 'Open the box', answer: 'TWIST' }],
        smart: {
          enabled: true,
          verificationType: 'code_verification',
          hasCode: true,
          codeInputLabel: 'Enter code',
          secretCode: 'OPEN-SESAME',
          attemptLimit: 3,
        },
      } as Partial<Task>),
    ) as Record<string, unknown>;

    // Secrets gone:
    expect(out.answers).toBeUndefined();
    expect(out.numericAnswer).toBeUndefined();
    const smart = out.smart as Record<string, unknown> | undefined;
    expect(smart?.secretCode).toBeUndefined();
    const steps = out.steps as Array<Record<string, unknown>> | undefined;
    expect(steps?.[0]).not.toHaveProperty('answer');

    // Renderable fields survive so the UI still works:
    expect(steps?.[0]).toMatchObject({ id: 's1', prompt: 'Open the box' });
    expect(smart).toMatchObject({ hasCode: true, codeInputLabel: 'Enter code', attemptLimit: 3 });
    expect(out.hasHint).toBe(false);
  });
});

describe('sanitizeTaskForParticipant — hidden location', () => {
  test('a hidden task strips coordinates and emits locationHidden:true', () => {
    const out = sanitizeTaskForParticipant(
      baseTask({ hideLocation: true }),
    ) as Record<string, unknown>;
    expect(out.coordinates).toBeUndefined();
    expect(out.locationHidden).toBe(true);
  });

  test('a hidden task strips the exact geofence radius (no triangulation)', () => {
    const out = sanitizeTaskForParticipant(
      baseTask({ hideLocation: true }),
    ) as Record<string, unknown>;
    expect(out.geofenceRadiusMeters).toBeUndefined();
  });

  test('a hidden task exposes the free, always-visible clue (EN + HE)', () => {
    const out = sanitizeTaskForParticipant(
      baseTask({
        hideLocation: true,
        locationClue: 'Where water never stops',
        locationClueHe: 'במקום שבו המים לא נחים',
      }),
    ) as Record<string, unknown>;
    expect(out.locationClue).toBe('Where water never stops');
    expect(out.locationClueHe).toBe('במקום שבו המים לא נחים');
  });

  test('a hidden task with a paid hint exposes the clue but still strips the paid hint text', () => {
    const out = sanitizeTaskForParticipant(
      baseTask({
        hideLocation: true,
        locationClue: 'the clue',
        hint: 'paid secret',
      }),
    ) as Record<string, unknown>;
    expect(out.locationClue).toBe('the clue');
    expect(out.hint).toBeUndefined();
    expect(out.hasHint).toBe(true);
  });

  test('a hidden station task also strips its injected stationCoords + radius', () => {
    const out = sanitizeTaskForParticipant(
      baseTask({
        hideLocation: true,
        smart: {
          enabled: true,
          verificationType: 'photo_upload',
          geofenceRadiusMeters: 25,
          stationCoords: { lat: 31.78, lng: 35.21 },
        },
      }),
    ) as Record<string, unknown>;
    const smart = out.smart as Record<string, unknown> | undefined;
    expect(smart?.stationCoords).toBeUndefined();
    expect(smart?.geofenceRadiusMeters).toBeUndefined();
  });
});
