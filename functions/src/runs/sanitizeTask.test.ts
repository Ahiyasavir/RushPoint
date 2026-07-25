import { expect, test, describe } from 'vitest';
import type { Task } from '@rushpoint/shared';
import { publicTaskLocation } from '@rushpoint/shared';
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

// ─── The three-way location boundary (change: hidden-mission-search-area) ─────
//
// ONE hidden task now has THREE distinct locational projections, for three
// audiences, produced by three code paths. Getting them confused is the whole bug
// class, so they are asserted together, on the SAME task, in one place:
//
//   1. the CREATOR, reading a world-readable publicTasks document, gets
//      publicTaskLocation() — a ~1.11 km grid cell (change:
//      hidden-location-map-visibility);
//   2. the PLAYER, before the server has confirmed arrival, gets `searchArea` —
//      a ~445 m grid cell plus a containing radius, and NOTHING else locational
//      (change: hidden-mission-search-area). It exists because a hunt whose map
//      showed nothing at all was not a hunt, it was a dead end;
//   3. the PLAYER, after arrival, gets the EXACT coordinates back so they can
//      navigate to the spot again if they wander off.
//
// The two coarsenings are deliberately DIFFERENT sizes and neither is derived
// from the other, so an edit that forwards one where the other belongs fails here
// with the reason written next to it.
describe('sanitizeTaskForParticipant — the three location projections stay separate', () => {
  // Coordinates deliberately NOT on a grid-cell centre. A grid snap is allowed to
  // return the truth for a point that happens to sit exactly on a centre (the
  // public projection has the same property), so a "centre !== spot" assertion is
  // only meaningful on a coordinate that is off-centre. Containment is the
  // property that holds for EVERY input, and it is asserted separately.
  const SPOT = { lat: 31.7767, lng: 35.2345 };
  const hiddenTask = () => baseTask({
    hideLocation: true,
    coordinates: { ...SPOT },
    locationClue: 'Where the lions guard the gate',
    hint: 'behind the third arch',
  });

  /** Metres between two points — local so the test never depends on the impl. */
  function metresApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(h));
  }

  test('a sealed hidden task ships a search area that CONTAINS the spot but is not the spot', () => {
    const task = hiddenTask();
    const sealed = sanitizeTaskForParticipant(task) as Record<string, unknown>;
    const area = sealed.searchArea as { lat: number; lng: number; radiusMeters: number } | undefined;

    expect(sealed.arrivalPending).toBe(true);
    expect(area).toBeDefined();
    expect(Number.isFinite(area!.lat)).toBe(true);
    expect(Number.isFinite(area!.lng)).toBe(true);
    expect(area!.radiusMeters).toBeGreaterThan(0);
    // Not the spot, on either axis.
    expect(area!.lat).not.toBe(task.coordinates!.lat);
    expect(area!.lng).not.toBe(task.coordinates!.lng);
    // But guaranteed to contain it — a circle that excludes the answer would send
    // the player away from it, which is worse than no circle at all.
    expect(metresApart(area!, task.coordinates!)).toBeLessThanOrEqual(area!.radiusMeters);
  });

  test('the sealed payload still withholds everything else', () => {
    const task = hiddenTask();
    const sealed = sanitizeTaskForParticipant(task) as Record<string, unknown>;
    // The exact spot and everything that could reconstruct it.
    expect(sealed.coordinates).toBeUndefined();
    expect(sealed.geofenceRadiusMeters).toBeUndefined();
    expect(sealed.smart).toBeUndefined();
    // The task itself is still sealed: no title, no type, no inputs.
    expect(sealed.title).toBeUndefined();
    expect(sealed.type).toBeUndefined();
    expect(sealed.answers).toBeUndefined();
    expect(sealed.numericAnswer).toBeUndefined();
    expect(sealed.steps).toBeUndefined();
    // The paid hint TEXT never rides along, only the affordance.
    expect(sealed.hint).toBeUndefined();
    expect(sealed.hasHint).toBe(true);
    // The clue is the whole point of the sealed card.
    expect(sealed.locationClue).toBe('Where the lions guard the gate');
    // Built by CONSTRUCTION: the sealed payload's key set is exactly the allowlist.
    expect(Object.keys(sealed).sort()).toEqual([
      'arrivalPending', 'difficulty', 'estimatedMinutes', 'hasHint', 'hintPenalty',
      'id', 'locationClue', 'locationHidden', 'pointValue', 'searchArea',
    ]);
  });

  test('the public projection is now the EXACT spot, yet the PLAYER never receives it', () => {
    const task = hiddenTask();
    // The world-readable gallery now pins the hidden mission at its EXACT spot
    // (change: gallery-exact-hidden-location) so the creator's map is accurate…
    const publicArea = publicTaskLocation(task);
    expect(publicArea).toEqual({ lat: task.coordinates!.lat, lng: task.coordinates!.lng });

    // …but the PLAYER's sealed payload still leaks nothing: no exact coordinates,
    // no public approxLocation, only a coarse search circle that is NOT the spot.
    // This is the whole safety boundary — the public projection being exact does
    // not reach the participant device; the seal is a separate control.
    const sealed = sanitizeTaskForParticipant(task) as Record<string, unknown>;
    expect(sealed.coordinates).toBeUndefined();
    expect(sealed.approxLocation).toBeUndefined();
    const area = sealed.searchArea as { lat: number; lng: number };
    expect(area.lat === publicArea!.lat && area.lng === publicArea!.lng).toBe(false);
  });

  test('an unsealed hidden task gets the exact spot back and NO search area', () => {
    const task = hiddenTask();
    const revealed = sanitizeTaskForParticipant(task, { revealed: true }) as Record<string, unknown>;
    // One mission must never carry two contradictory answers on one map.
    expect(revealed.searchArea).toBeUndefined();
    expect(revealed.approxLocation).toBeUndefined();
    expect(revealed.coordinates).toEqual(task.coordinates);
    expect(revealed.locationHidden).toBe(true);
  });

  test('a task that is not hidden never carries a search area', () => {
    const out = sanitizeTaskForParticipant(baseTask()) as Record<string, unknown>;
    expect(out.searchArea).toBeUndefined();
    expect(out.coordinates).toEqual({ lat: 31.78, lng: 35.21 });
  });

  test('a sealed hidden task with no usable location carries no search area', () => {
    for (const coords of [undefined, { lat: 0, lng: 0 }, { lat: Number.NaN, lng: 35.2 }]) {
      const sealed = sanitizeTaskForParticipant(
        baseTask({ hideLocation: true, coordinates: coords as never }),
      ) as Record<string, unknown>;
      expect(sealed.arrivalPending).toBe(true);
      expect(sealed.searchArea).toBeUndefined();
    }
  });

  test('a sealed hidden STATION derives its area from the injected station coordinates', () => {
    const task = baseTask({
      hideLocation: true,
      type: 'smart_station',
      coordinates: { lat: 31.78, lng: 35.21 },
      smart: {
        enabled: true,
        verificationType: 'code_verification',
        secretCode: 'XYZ',
        stationCoords: { lat: 32.0853, lng: 34.7818 },
      } as never,
    });
    const sealed = sanitizeTaskForParticipant(task) as Record<string, unknown>;
    const area = sealed.searchArea as { lat: number; lng: number; radiusMeters: number };
    expect(area).toBeDefined();
    expect(metresApart(area, { lat: 32.0853, lng: 34.7818 })).toBeLessThanOrEqual(area.radiusMeters);
    // …and the station's secret code and coordinates still never ship.
    expect(sealed.smart).toBeUndefined();
    expect(JSON.stringify(sealed)).not.toContain('XYZ');
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
    // change: hidden-mission-search-area — the coarse, containing search circle.
    // It is the ONLY locational key a sealed payload may carry; the exact spot
    // and everything that could reconstruct it are still absent from this list.
    'searchArea',
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
