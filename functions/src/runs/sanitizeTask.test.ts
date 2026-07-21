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

  // survey-tasks: a survey has no answer key, so its surveyChoices are
  // participant-visible (the choice buttons render from them) and must survive
  // the sanitizer intact — while a task carrying every secret is still stripped.
  test('survey surveyChoices passes through to the participant intact', () => {
    const out = sanitizeTaskForParticipant(
      baseTask({ type: 'survey', surveyChoices: ['Pizza', 'Falafel', 'Sushi'] } as Partial<Task>),
    ) as Record<string, unknown>;
    expect(out.surveyChoices).toEqual(['Pizza', 'Falafel', 'Sushi']);
  });

  // audio-tasks: captureKind lives under smart and is participant-visible (the
  // client must know to render the audio recorder instead of the photo picker),
  // so it must survive the sanitizer while smart secrets are still stripped.
  test('smart.captureKind passes through while secretCode/adminNotes are stripped', () => {
    const out = sanitizeTaskForParticipant(
      baseTask({
        type: 'photo',
        smart: {
          enabled: true,
          verificationType: 'photo_upload',
          captureKind: 'audio',
          secretCode: 'OPEN-SESAME',
          adminNotes: 'internal only',
        },
      } as Partial<Task>),
    ) as Record<string, unknown>;
    const smart = out.smart as Record<string, unknown> | undefined;
    expect(smart?.captureKind).toBe('audio');
    expect(smart?.secretCode).toBeUndefined();
    expect(smart?.adminNotes).toBeUndefined();
  });

  // task-media-attachments: general media is participant-visible (no secret) and
  // must survive the sanitizer intact so the TaskRunner can render it.
  test('task media (image + youtube) passes through to the participant unchanged', () => {
    const media = [
      { id: 'm1', kind: 'image' as const, url: 'https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/gameMedia%2Fx.jpg', caption: 'the spot' },
      { id: 'm2', kind: 'youtube' as const, url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
    ];
    const out = sanitizeTaskForParticipant(baseTask({ media })) as Record<string, unknown>;
    expect(out.media).toEqual(media);
  });
});

// quiz-ordering: the authored orderItems ORDER is the answer key. The sanitizer
// must never emit the authored order — only a deterministically seeded shuffle
// (seed teamId:taskId, passed by getMyTeamState) — and must strip the field
// entirely when no seed is available (fail closed, never fail open).
describe('sanitizeTaskForParticipant — ordering quiz (orderItems)', () => {
  const AUTHORED = ['first', 'second', 'third', 'fourth'];
  const orderingTask = () =>
    baseTask({ type: 'quiz', orderItems: [...AUTHORED] } as Partial<Task>);

  test('seeded call emits orderItems shuffled ≠ authored, same multiset', () => {
    const out = sanitizeTaskForParticipant(orderingTask(), { shuffleSeed: 'team-1:t1' }) as Record<string, unknown>;
    const items = out.orderItems as string[];
    expect(Array.isArray(items)).toBe(true);
    expect(items).not.toEqual(AUTHORED);
    expect([...items].sort()).toEqual([...AUTHORED].sort());
  });

  test('same seed across two calls → identical (reload-stable) shuffle', () => {
    const a = sanitizeTaskForParticipant(orderingTask(), { shuffleSeed: 'team-1:t1' }) as Record<string, unknown>;
    const b = sanitizeTaskForParticipant(orderingTask(), { shuffleSeed: 'team-1:t1' }) as Record<string, unknown>;
    expect(a.orderItems).toEqual(b.orderItems);
  });

  test('seedless call OMITS orderItems entirely (fail closed)', () => {
    const out = sanitizeTaskForParticipant(orderingTask()) as Record<string, unknown>;
    expect('orderItems' in out).toBe(false);
  });

  test('empty-seed call also strips orderItems (fail closed)', () => {
    const out = sanitizeTaskForParticipant(orderingTask(), { shuffleSeed: '' }) as Record<string, unknown>;
    expect('orderItems' in out).toBe(false);
  });

  test('a task without orderItems never grows the key', () => {
    const out = sanitizeTaskForParticipant(baseTask(), { shuffleSeed: 'team-1:t1' }) as Record<string, unknown>;
    expect('orderItems' in out).toBe(false);
  });

  test('existing secrecy invariants hold on an ordering task too', () => {
    const out = sanitizeTaskForParticipant(
      baseTask({
        type: 'quiz',
        orderItems: [...AUTHORED],
        hint: 'paid secret',
        answers: ['leak'],
        numericAnswer: 7,
      } as Partial<Task>),
      { shuffleSeed: 'team-9:t1' },
    ) as Record<string, unknown>;
    expect(out.hint).toBeUndefined();
    expect(out.answers).toBeUndefined();
    expect(out.numericAnswer).toBeUndefined();
    expect(out.hasHint).toBe(true);
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

// change: play-task-gating (wave D). Product decision: a hidden-location task
// reveals NOTHING but its clue until the server has confirmed the team actually
// ARRIVED (reportArrival → RunTaskRecord.arrivedAt). Before that the sanitizer
// emits a "sealed stub" built by CONSTRUCTION (allowlist), so a future Task field
// defaults to withheld — same fail-closed policy as the answer keys.
// After arrival the task sanitizes like any other task, coordinates INCLUDED
// (user decision: a player who wanders off must be able to navigate back).
describe('sanitizeTaskForParticipant — hidden location: sealed until arrival', () => {
  const SEALED_KEYS = [
    'arrivalPending', 'difficulty', 'estimatedMinutes', 'hasHint', 'hintPenalty',
    'id', 'locationClue', 'locationClueHe', 'locationHidden', 'pointValue',
  ];
  const treasure = (extra: Partial<Task> = {}) =>
    baseTask({
      hideLocation: true,
      title: 'The secret spot',
      description: 'Behind the blue door',
      type: 'quiz',
      locationClue: 'Where water never stops',
      locationClueHe: 'במקום שבו המים לא נחים',
      choices: ['a', 'b'],
      answers: ['a'],
      hint: 'paid secret',
      media: [{ id: 'm1', kind: 'image', url: 'https://firebasestorage.googleapis.com/x.jpg' }],
      smart: { enabled: true, verificationType: 'code_verification', longInstructions: 'go inside' },
      steps: [{ id: 's1', prompt: 'do it', answer: 'X' }],
      numericTolerance: 3,
      tags: ['secret'],
      ...extra,
    } as Partial<Task>);

  test('sealed: the title is ABSENT from the payload', () => {
    const out = sanitizeTaskForParticipant(treasure()) as Record<string, unknown>;
    expect('title' in out).toBe(false);
  });

  test('sealed: no description / type / media / smart / choices / steps / tolerance / tags', () => {
    const out = sanitizeTaskForParticipant(treasure(), { shuffleSeed: 't:1' }) as Record<string, unknown>;
    for (const k of ['description', 'type', 'media', 'smart', 'choices', 'steps',
      'numericTolerance', 'tags', 'coordinates', 'geofenceRadiusMeters', 'triggerMode',
      'surveyChoices', 'orderItems', 'unlockAfterTaskIds', 'hideLocation']) {
      expect([k, k in out]).toEqual([k, false]);
    }
  });

  test('sealed: emits arrivalPending + locationHidden + the clue (EN + HE) + hint affordance', () => {
    const out = sanitizeTaskForParticipant(treasure()) as Record<string, unknown>;
    expect(out.arrivalPending).toBe(true);
    expect(out.locationHidden).toBe(true);
    expect(out.locationClue).toBe('Where water never stops');
    expect(out.locationClueHe).toBe('במקום שבו המים לא נחים');
    expect(out.hasHint).toBe(true);
    expect(out.hintPenalty).toBe(25);
    expect(out.id).toBe('t1');
  });

  test('sealed: key set is EXACTLY the allowlist (a new Task field defaults to withheld)', () => {
    const out = sanitizeTaskForParticipant(treasure(), { shuffleSeed: 't:1' }) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual([...SEALED_KEYS].sort());
  });

  test('sealed beats the ordering shuffle: orderItems never ship pre-arrival', () => {
    const out = sanitizeTaskForParticipant(
      treasure({ orderItems: ['one', 'two', 'three'] } as Partial<Task>),
      { shuffleSeed: 'team-1:t1' },
    ) as Record<string, unknown>;
    expect('orderItems' in out).toBe(false);
  });

  test('arrived: title/description/type return and coordinates are RESTORED', () => {
    const out = sanitizeTaskForParticipant(treasure(), { revealed: true, shuffleSeed: 't:1' }) as Record<string, unknown>;
    expect(out.title).toBe('The secret spot');
    expect(out.description).toBe('Behind the blue door');
    expect(out.type).toBe('quiz');
    expect(out.coordinates).toEqual({ lat: 31.78, lng: 35.21 });
    expect(out.geofenceRadiusMeters).toBe(40);
    expect(out.locationHidden).toBe(true);
    expect('arrivalPending' in out).toBe(false);
  });

  test('arrived: the answer keys are STILL stripped (reveal is not a bypass)', () => {
    const out = sanitizeTaskForParticipant(treasure(), { revealed: true }) as Record<string, unknown>;
    expect(out.answers).toBeUndefined();
    expect(out.hint).toBeUndefined();
    const steps = out.steps as Array<Record<string, unknown>> | undefined;
    expect(steps?.[0]).not.toHaveProperty('answer');
    const smart = out.smart as Record<string, unknown> | undefined;
    expect(smart?.secretCode).toBeUndefined();
  });

  test('a NOT-hidden task is unaffected by revealed (byte-identical either way)', () => {
    const a = sanitizeTaskForParticipant(baseTask({ type: 'quiz', choices: ['x'] } as Partial<Task>));
    const b = sanitizeTaskForParticipant(baseTask({ type: 'quiz', choices: ['x'] } as Partial<Task>), { revealed: true });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect((a as Record<string, unknown>).arrivalPending).toBeUndefined();
  });

  test('sealed: the whole serialized payload contains neither the title nor the description', () => {
    const json = JSON.stringify(sanitizeTaskForParticipant(treasure()));
    expect(json.includes('The secret spot')).toBe(false);
    expect(json.includes('Behind the blue door')).toBe(false);
    expect(json.includes('go inside')).toBe(false);
  });
});
