// Pure-logic tests for game-file-export-import (serializeGameToFile / parseGameFile).
// Run by scripts/run-unit-tests.mjs via `npm test`. NO emulator needed.
//
// THE INCIDENT this guards: a creator's real game was destroyed and could not be
// recovered because it existed in exactly one place. The file format below is the
// creator's own copy, so the ONLY property that matters is that a round trip loses
// nothing — export → import → export must be stable, for every task type, every
// optional field, Hebrew/RTL text and emoji. A silent field drop here is the same
// class of loss, just slower.
//
// Style follows functions/src/__property__/invariants.property.test.ts: a small
// seeded LCG (no fast-check dependency) so any failure repeats exactly.
import {
  GAME_FILE_FORMAT,
  CURRENT_GAME_FILE_VERSION,
  MAX_GAME_FILE_BYTES,
  MAX_FILE_STAGES,
  MAX_FILE_TASKS,
  MAX_FILE_STRING_LEN,
  EXPORTED_GAME_KEYS,
  EXPORTED_STAGE_KEYS,
  EXPORTED_TASK_KEYS,
  EXPORTED_SMART_KEYS,
  DELIBERATELY_EXCLUDED_GAME_KEYS,
  DELIBERATELY_EXCLUDED_STAGE_KEYS,
  DELIBERATELY_EXCLUDED_TASK_KEYS,
  DELIBERATELY_EXCLUDED_SMART_KEYS,
  serializeGameToFile,
  parseGameFile,
  gameFileFilename,
  type GameFile,
  type GameFileGame,
  type Game,
  type Stage,
  type Task,
  type SmartStationConfig,
  type TaskType,
} from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

/** Structural deep-equality (key order insensitive, undefined ≠ absent). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** First structural difference between two values, for a readable failure. */
function firstDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (deepEqual(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
  }
  return `${path}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`;
}

// ── Seeded RNG (reproducible: a failure always repeats) ───────────────────────
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

const TASK_TYPES: TaskType[] = [
  'field', 'smart_station', 'photo', 'self_report', 'quiz', 'numeric', 'geofence', 'sequence', 'survey',
];

// Deliberately unicode-heavy: Hebrew (RTL), emoji, mixed direction, CJK.
const TEXTS = [
  'Find the gate',
  'מצאו את השער',
  'שלב 1 מתוך 3',
  '🎯 Checkpoint',
  'חידה 🧩 קשה',
  'مرحبا بالعالم',
  '日本語のタスク',
  'Mixed שלום world 🚀',
];

/**
 * A seeded random Game covering, across enough samples: all nine task types,
 * every optional field present AND absent, unicode/RTL/emoji text, an empty stage
 * list, requiredTaskCount, exclusive groups, acyclic unlock graphs and media arrays.
 */
function randomGame(rng: () => number, forceTaskType?: TaskType): Game {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
  const maybe = <T,>(v: T): T | undefined => (rng() < 0.5 ? v : undefined);
  const text = () => pick(TEXTS);
  const n = (max: number) => Math.round(rng() * max * 100) / 100;

  const stageCount = rng() < 0.12 ? 0 : 1 + Math.floor(rng() * 3);
  const stages: Stage[] = [];

  for (let si = 0; si < stageCount; si++) {
    const taskCount = 1 + Math.floor(rng() * 4);
    const tasks: Task[] = [];
    for (let ti = 0; ti < taskCount; ti++) {
      const type = forceTaskType ?? pick(TASK_TYPES);
      const smart: SmartStationConfig | undefined = rng() < 0.4 ? {
        enabled: true,
        verificationType: rng() < 0.5 ? 'code_verification' : 'photo_upload',
        longInstructions: maybe(text()),
        longInstructionsHe: maybe('הוראות ארוכות'),
        extraInfo: maybe(text()),
        adminNotes: maybe('internal note'),
        timeLimitSeconds: maybe(Math.floor(rng() * 600)),
        canSkip: maybe(rng() < 0.5),
        autoApprove: maybe(rng() < 0.5),
        captureKind: maybe(rng() < 0.5 ? 'photo' : 'audio'),
        codeInputLabel: maybe('קוד תחנה'),
        hasCode: maybe(true),
        secretCode: maybe(`CODE${Math.floor(rng() * 9999)}`),
        attemptLimit: maybe(3),
        showIntroScreen: maybe(true),
        // stationCoords is injected by assignTask at run time and must NEVER be
        // authored — it is deliberately generated here so the exclusion is tested.
        stationCoords: rng() < 0.5 ? { lat: n(60), lng: n(60) } : undefined,
      } : undefined;

      const task: Task = {
        id: `s${si}-t${ti}`,
        title: text(),
        description: maybe(text()),
        type,
        coordinates: { lat: n(60), lng: n(120) },
        difficulty: 1 + Math.floor(rng() * 10),
        estimatedMinutes: 1 + Math.floor(rng() * 30),
        expectedDurationMinutes: maybe(Math.floor(rng() * 30)),
        pointValue: Math.floor(rng() * 200),
        maxConcurrentTeams: 1 + Math.floor(rng() * 5),
        maxDurationMinutes: maybe(Math.floor(rng() * 60)),
        status: maybe(pick(['active', 'paused', 'closed'] as const)),
        triggerMode: maybe(pick(['radius', 'exact', 'instant', 'locationless'] as const)),
        locationless: maybe(rng() < 0.5),
        hideLocation: maybe(rng() < 0.5),
        locationClue: maybe(text()),
        locationClueHe: maybe('רמז בעברית'),
        hint: maybe('The answer is behind the blue door 🚪'),
        hintPenalty: maybe(Math.floor(rng() * 50)),
        hintAutoRevealMinutes: maybe(n(10)),
        hintAutoRevealAttempts: maybe(Math.floor(rng() * 5)),
        choices: type === 'quiz' ? maybe(['Paris', 'פריז', 'Roma']) : undefined,
        answers: type === 'quiz' ? ['Paris', 'פריז'] : maybe(undefined),
        surveyChoices: type === 'survey' ? maybe(['כן', 'לא', 'אולי 🤔']) : undefined,
        numericAnswer: type === 'numeric' ? Math.floor(rng() * 100) : undefined,
        numericTolerance: type === 'numeric' ? maybe(2) : undefined,
        geofenceRadiusMeters: maybe(10 + Math.floor(rng() * 200)),
        requirePresence: maybe(rng() < 0.5),
        steps: type === 'sequence'
          ? [{ id: 'st1', prompt: text(), answer: maybe('שלום') }, { id: 'st2', prompt: text() }]
          : undefined,
        media: rng() < 0.4 ? [
          { id: 'm0', kind: 'youtube', url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', caption: maybe('כיתוב') },
          { id: 'm1', kind: 'image', url: 'https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/x.jpg' },
        ] : undefined,
        releaseAfterMinutes: maybe(n(20)),
        expiresAfterMinutes: maybe(60 + n(20)),
        tags: maybe(['עיר', 'outdoor 🌳']),
        // Runtime-only counter: generated so the exclusion is exercised.
        currentTeamCount: rng() < 0.5 ? Math.floor(rng() * 3) : undefined,
        smart,
      };
      // Prune the undefined-valued keys so "absent" is genuinely absent (the
      // property under test is that absence survives the round trip).
      for (const k of Object.keys(task) as (keyof Task)[]) {
        if (task[k] === undefined) delete task[k];
      }
      if (task.smart) {
        for (const k of Object.keys(task.smart) as (keyof SmartStationConfig)[]) {
          if (task.smart[k] === undefined) delete task.smart[k];
        }
      }
      tasks.push(task);
    }

    // An ACYCLIC unlock graph: task i may only depend on tasks before it.
    if (rng() < 0.5 && tasks.length > 1) {
      for (let ti = 1; ti < tasks.length; ti++) {
        if (rng() < 0.5) tasks[ti].unlockAfterTaskIds = [tasks[ti - 1].id];
      }
    }

    const stage: Stage = {
      id: `s${si}`,
      order: si,
      title: text(),
      tasks,
      isFinal: si === stageCount - 1 ? true : undefined,
      requiredTaskCount: rng() < 0.4 ? 1 + Math.floor(rng() * tasks.length) : undefined,
      releaseAfterMinutes: rng() < 0.3 ? n(30) : undefined,
      narrative: rng() < 0.4 ? {
        intro: { title: text(), body: text(), bodyHe: 'פתיח לשלב' },
        outro: { body: 'סיום 🎉' },
      } : undefined,
      exclusiveGroups: rng() < 0.3 && tasks.length > 1
        ? [{ id: 'g0', taskIds: [tasks[0].id, tasks[1].id] }]
        : undefined,
    };
    for (const k of Object.keys(stage) as (keyof Stage)[]) {
      if (stage[k] === undefined) delete stage[k];
    }
    stages.push(stage);
  }

  const game: Game = {
    id: 'server-assigned-id',
    ownerUid: 'owner-uid',
    title: text(),
    description: maybe(text()),
    mode: rng() < 0.5 ? 'individual' : 'team',
    stages,
    scoringPreset: pick(['time_only', 'fixed_points_speed', 'smart_weighted'] as const),
    scoringOptions: maybe({ transitPenaltyEnabled: true, sprintPenaltyEnabled: false }),
    registrationFields: [{ id: 'name', label: 'שם', type: 'text', required: true, level: 'member' }],
    branding: maybe({ name: 'המותג שלי', primaryColor: '#ff0000' }),
    visibility: 'private',
    tags: ['ירושלים', 'family 👨‍👩‍👧'],
    coverImage: maybe('https://example.com/cover.jpg'),
    approxLocation: maybe({ lat: 31.78, lng: 35.22, label: 'ירושלים' }),
    playCount: Math.floor(rng() * 500),
    requiresGuardianConsent: maybe(true),
    minAge: maybe(13),
    safeZone: maybe({ center: { lat: 31.78, lng: 35.22 }, radiusMeters: 900 }),
    benchmarkOptOut: maybe(true),
    integrationWebhookUrl: rng() < 0.5 ? 'https://hooks.slack.com/services/T00/B00/secret' : undefined,
    integrationPlatform: rng() < 0.5 ? 'slack' : undefined,
    allowInstantPlay: maybe(true),
    photoFeedEnabled: maybe(false),
    powerUpsEnabled: maybe(true),
    instructions: maybe({ title: 'איך משחקים', body: 'Walk. Solve. Win. 🏁', bodyHe: 'ללכת. לפתור. לנצח.' }),
    manualLeaderboardReveal: maybe(true),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
  };
  for (const k of Object.keys(game) as (keyof Game)[]) {
    if (game[k] === undefined) delete game[k];
  }
  return game;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. THE ROUND-TRIP PROPERTY — export → import → export is stable.
// ═══════════════════════════════════════════════════════════════════════════════

{
  const rng = makeRng(20260722);
  const N = 300;
  let roundTripFailures = 0;
  let parseFailures = 0;
  let firstFailure = '';
  const typesSeen = new Set<string>();

  for (let i = 0; i < N; i++) {
    // Every ninth sample forces one task type so all nine are guaranteed covered.
    const g = randomGame(rng, i < TASK_TYPES.length ? TASK_TYPES[i] : undefined);
    g.stages.forEach((s) => s.tasks.forEach((t) => typesSeen.add(t.type)));

    const doc1 = serializeGameToFile(g);
    const res = parseGameFile(doc1);
    if (res.errors.length > 0 || !res.game) {
      parseFailures++;
      if (!firstFailure) firstFailure = `seed sample ${i}: ${res.errors.join(' · ')}`;
      continue;
    }
    const doc2 = serializeGameToFile(res.game);
    if (!deepEqual(doc1.game, doc2.game)) {
      roundTripFailures++;
      if (!firstFailure) firstFailure = `seed sample ${i}: ${firstDiff(doc1.game, doc2.game)}`;
    }
  }

  ok(parseFailures === 0, `round trip: every exported document re-imports cleanly (${parseFailures} failed) ${firstFailure}`);
  ok(roundTripFailures === 0, `round trip: export→import→export is stable (${roundTripFailures} drifted) ${firstFailure}`);
  ok(TASK_TYPES.every((t) => typesSeen.has(t)), `round trip: all nine task types covered (missing ${TASK_TYPES.filter((t) => !typesSeen.has(t)).join(',')})`);
}

// Absent optional fields stay ABSENT — never materialised as null or a default.
{
  const minimal: Game = {
    id: 'x', ownerUid: 'u', title: 'Bare', mode: 'individual',
    stages: [{
      id: 's0', order: 0, title: 'Only stage', tasks: [{
        id: 't0', title: 'Tap here', type: 'self_report',
        coordinates: { lat: 0, lng: 0 }, difficulty: 1, estimatedMinutes: 1,
        pointValue: 10, maxConcurrentTeams: 3,
      }],
    }],
    scoringPreset: 'fixed_points_speed',
    registrationFields: [], visibility: 'private', tags: [], playCount: 0,
    createdAt: 'a', updatedAt: 'b',
  };
  const doc = serializeGameToFile(minimal);
  const task = doc.game.stages[0].tasks[0] as Record<string, unknown>;
  const optional = ['description', 'hint', 'answers', 'media', 'smart', 'triggerMode', 'locationless', 'steps'];
  ok(optional.every((k) => !(k in task)), `absent optional task fields stay absent (found ${optional.filter((k) => k in task).join(',')})`);
  ok(!('description' in (doc.game as Record<string, unknown>)), 'absent optional game fields stay absent');
  const back = parseGameFile(doc);
  ok(back.errors.length === 0, `minimal game imports cleanly (${back.errors.join(' · ')})`);
  ok(deepEqual(serializeGameToFile(back.game!).game, doc.game), 'minimal game round-trips exactly');
}

// Hebrew / emoji / RTL survive byte-identically.
{
  const g = randomGame(makeRng(7));
  g.title = 'מירוץ העיר העתיקה 🏛️';
  g.stages = [{
    id: 's0', order: 0, title: 'שלב א׳ — ההתחלה', isFinal: true,
    tasks: [{
      id: 't0', title: 'חידה 🧩', description: 'לכו אל השער 🚪 ואז שמאלה',
      type: 'quiz', answers: ['פריז', 'Paris 🇫🇷'], choices: ['פריז', 'רומא'],
      coordinates: { lat: 31.7767, lng: 35.2345 },
      difficulty: 4, estimatedMinutes: 6, pointValue: 80, maxConcurrentTeams: 3,
      locationClueHe: 'ליד המזרקה', hint: 'הרמז 🔑',
    }],
  }];
  const doc = serializeGameToFile(g);
  const back = parseGameFile(doc);
  ok(back.errors.length === 0, `hebrew/emoji game imports cleanly (${back.errors.join(' · ')})`);
  const t = back.game!.stages[0].tasks[0];
  ok(t.title === 'חידה 🧩', 'emoji + Hebrew title byte-identical');
  ok(t.description === 'לכו אל השער 🚪 ואז שמאלה', 'mixed RTL description byte-identical');
  ok(deepEqual(t.answers, ['פריז', 'Paris 🇫🇷']), 'RTL + flag-emoji answers byte-identical');
  ok(back.game!.stages[0].title === 'שלב א׳ — ההתחלה', 'Hebrew stage title byte-identical');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SECRETS — the owner's export CONTAINS the answer keys (that is the point).
// ═══════════════════════════════════════════════════════════════════════════════

{
  const g: Game = {
    id: 'g', ownerUid: 'u', title: 'Loaded', mode: 'team',
    stages: [{
      id: 's0', order: 0, title: 'All the secrets', isFinal: true,
      tasks: [
        { id: 'q', title: 'Quiz', type: 'quiz', answers: ['Paris'], orderItems: ['a', 'b', 'c'],
          coordinates: { lat: 1, lng: 2 }, difficulty: 3, estimatedMinutes: 5, pointValue: 50,
          maxConcurrentTeams: 3, hint: 'secret hint text', hintPenalty: 25 },
        { id: 'n', title: 'Numeric', type: 'numeric', numericAnswer: 42, numericTolerance: 1,
          coordinates: { lat: 1, lng: 2 }, difficulty: 3, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 3 },
        { id: 'seq', title: 'Sequence', type: 'sequence',
          steps: [{ id: 's1', prompt: 'Say the word', answer: 'shibboleth' }],
          coordinates: { lat: 1, lng: 2 }, difficulty: 3, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 3 },
        { id: 'st', title: 'Station', type: 'smart_station',
          smart: { enabled: true, verificationType: 'code_verification', secretCode: 'ALPHA7',
                   stationCoords: { lat: 9, lng: 9 } },
          coordinates: { lat: 1, lng: 2 }, difficulty: 3, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 3 },
        { id: 'hid', title: 'Hidden', type: 'field', hideLocation: true,
          coordinates: { lat: 31.5, lng: 35.5 }, geofenceRadiusMeters: 30,
          difficulty: 3, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 3, currentTeamCount: 2 },
      ],
    }],
    scoringPreset: 'smart_weighted', registrationFields: [], visibility: 'public', tags: [],
    playCount: 137, integrationWebhookUrl: 'https://hooks.slack.com/services/T/B/SECRET',
    integrationPlatform: 'slack',
    createdAt: 'a', updatedAt: 'b', deletedAt: 'c', deletedBy: 'd',
  };
  const doc = serializeGameToFile(g);
  const byId = Object.fromEntries(doc.game.stages[0].tasks.map((t) => [t.id, t as Record<string, unknown>]));

  ok(deepEqual(byId.q.answers, ['Paris']), 'export contains quiz answers');
  ok(deepEqual(byId.q.orderItems, ['a', 'b', 'c']), 'export contains the authored orderItems order');
  ok(byId.q.hint === 'secret hint text', 'export contains the paid hint text');
  ok(byId.q.hintPenalty === 25, 'export contains the hint penalty');
  ok(byId.n.numericAnswer === 42, 'export contains numericAnswer');
  ok(deepEqual((byId.seq.steps as { answer?: string }[])[0].answer, 'shibboleth'), 'export contains steps[].answer');
  ok((byId.st.smart as Record<string, unknown>).secretCode === 'ALPHA7', 'export contains smart.secretCode');
  ok(byId.hid.hideLocation === true && deepEqual(byId.hid.coordinates, { lat: 31.5, lng: 35.5 }),
    'export contains the real coordinates of a hideLocation task');

  // ── and the exclusions ──
  const gameKeys = Object.keys(doc.game);
  for (const k of DELIBERATELY_EXCLUDED_GAME_KEYS) {
    ok(!gameKeys.includes(k), `export excludes game field "${k}"`);
  }
  ok(!('currentTeamCount' in byId.hid), 'export excludes the runtime counter currentTeamCount');
  ok(!('stationCoords' in (byId.st.smart as Record<string, unknown>)),
    'export excludes smart.stationCoords (injected by assignTask, never authored)');
  ok(doc.format === GAME_FILE_FORMAT, 'export carries the format identifier');
  ok(doc.schemaVersion === CURRENT_GAME_FILE_VERSION, 'export carries the current schema version');
  ok(typeof doc.exportedAt === 'string' && doc.exportedAt.length > 0, 'export carries a timestamp');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. KEY-LIST DRIFT GUARD — a new authored field cannot be silently forgotten.
// A missing key here is a TYPE error (Required<T> forces exhaustiveness) as well
// as a runtime failure, so the exporter cannot rot as the model evolves.
// ═══════════════════════════════════════════════════════════════════════════════

{
  const fullSmart: Record<keyof Required<SmartStationConfig>, true> = {
    enabled: true, verificationType: true, longInstructions: true, longInstructionsHe: true,
    extraInfo: true, mediaUrl: true, imageUrl: true, adminNotes: true, timeLimitSeconds: true,
    canSkip: true, autoCompleteOnSuccess: true, autoApprove: true, captureKind: true,
    geofenceRadiusMeters: true, stationCoords: true, codeInputLabel: true, hasCode: true,
    secretCode: true, attemptLimit: true, hintCount: true, photoReviewRequired: true,
    allowRetry: true, showIntroScreen: true, showSuccessScreen: true, showFailureScreen: true,
    showPendingReviewScreen: true, showHintsOverTime: true,
  };
  const fullTask: Record<keyof Required<Task>, true> = {
    id: true, title: true, description: true, type: true, coordinates: true, difficulty: true,
    estimatedMinutes: true, expectedDurationMinutes: true, pointValue: true, maxConcurrentTeams: true,
    currentTeamCount: true, status: true, maxDurationMinutes: true, smart: true, triggerMode: true,
    locationless: true, hideLocation: true, locationClue: true, locationClueHe: true, hint: true,
    hintPenalty: true, hintAutoRevealMinutes: true, hintAutoRevealAttempts: true, choices: true,
    answers: true, orderItems: true, surveyChoices: true, numericAnswer: true, numericTolerance: true,
    geofenceRadiusMeters: true, requirePresence: true, steps: true, media: true, releaseAt: true,
    releaseAfterMinutes: true, expiresAfterMinutes: true, unlockAfterTaskIds: true, tags: true,
  };
  const fullStage: Record<keyof Required<Stage>, true> = {
    id: true, order: true, title: true, tasks: true, isFinal: true, narrative: true,
    requiredTaskCount: true, releaseAt: true, releaseAfterMinutes: true, exclusiveGroups: true,
  };
  const fullGame: Record<keyof Required<Game>, true> = {
    id: true, ownerUid: true, title: true, description: true, mode: true, stages: true,
    scoringPreset: true, scoringOptions: true, registrationFields: true, branding: true,
    visibility: true, tags: true, coverImage: true, approxLocation: true, playCount: true,
    requiresGuardianConsent: true, minAge: true, safeZone: true, benchmarkOptOut: true,
    integrationWebhookUrl: true, integrationPlatform: true, allowInstantPlay: true,
    photoFeedEnabled: true, powerUpsEnabled: true, instructions: true, manualLeaderboardReveal: true,
    deletedAt: true, deletedBy: true, createdAt: true, updatedAt: true,
  };

  const classify = (
    label: string,
    all: Record<string, true>,
    exported: readonly string[],
    excluded: readonly string[],
  ) => {
    const unclassified = Object.keys(all).filter((k) => !exported.includes(k) && !excluded.includes(k));
    ok(unclassified.length === 0,
      `${label}: every field is exported or deliberately excluded (unclassified: ${unclassified.join(', ')})`);
    const both = exported.filter((k) => excluded.includes(k));
    ok(both.length === 0, `${label}: no field is both exported and excluded (${both.join(', ')})`);
    const unknown = [...exported, ...excluded].filter((k) => !(k in all));
    ok(unknown.length === 0, `${label}: no stale key in the lists (${unknown.join(', ')})`);
  };

  classify('Game', fullGame, EXPORTED_GAME_KEYS, DELIBERATELY_EXCLUDED_GAME_KEYS);
  classify('Stage', fullStage, EXPORTED_STAGE_KEYS, DELIBERATELY_EXCLUDED_STAGE_KEYS);
  classify('Task', fullTask, EXPORTED_TASK_KEYS, DELIBERATELY_EXCLUDED_TASK_KEYS);
  classify('SmartStationConfig', fullSmart, EXPORTED_SMART_KEYS, DELIBERATELY_EXCLUDED_SMART_KEYS);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. REFUSALS — every rejection names its reason and produces NO game.
// Silently dropping fields is how a creator loses their work a second time.
// ═══════════════════════════════════════════════════════════════════════════════

function goodDoc(): GameFile {
  return {
    format: GAME_FILE_FORMAT,
    schemaVersion: CURRENT_GAME_FILE_VERSION,
    exportedAt: '2026-07-22T00:00:00.000Z',
    game: {
      title: 'Good', mode: 'individual', scoringPreset: 'fixed_points_speed', tags: [],
      registrationFields: [],
      stages: [{
        id: 's0', order: 0, title: 'One', isFinal: true, tasks: [{
          id: 't0', title: 'Go', type: 'field', coordinates: { lat: 1, lng: 2 },
          difficulty: 2, estimatedMinutes: 3, pointValue: 10, maxConcurrentTeams: 3,
        }],
      }],
    } as GameFileGame,
  };
}
function refused(doc: unknown, needle: RegExp, label: string) {
  const res = parseGameFile(doc);
  const hit = res.errors.some((e) => needle.test(e));
  ok(hit && res.game === null, `refused: ${label} (errors: ${res.errors.join(' · ') || 'NONE'})`);
}

ok(parseGameFile(goodDoc()).errors.length === 0, 'the control document imports cleanly');

refused({ ...goodDoc(), format: 'something.else' }, /rushpoint|game file|format/i, 'a document that is not a RushPoint game file');
refused({ ...goodDoc(), format: undefined }, /rushpoint|game file|format/i, 'a document with no format identifier');
refused({ ...goodDoc(), schemaVersion: CURRENT_GAME_FILE_VERSION + 1 }, /newer|version/i, 'a schema version newer than this server understands');
refused({ ...goodDoc(), schemaVersion: 'one' }, /version/i, 'a non-integer schema version');
refused({ ...goodDoc(), schemaVersion: undefined }, /version/i, 'an absent schema version');
refused('not json at all', /rushpoint|game file|format|parse/i, 'a non-object payload');
refused(null, /rushpoint|game file|format|parse/i, 'a null payload');

// A KNOWN (current) version is accepted — the older-version path is the same code
// path with an empty upgrade chain at v1.
ok(parseGameFile({ ...goodDoc(), schemaVersion: CURRENT_GAME_FILE_VERSION }).errors.length === 0,
  'a known schema version is accepted');

// Missing required fields.
{
  const d = goodDoc(); (d.game as Record<string, unknown>).title = '';
  refused(d, /title/i, 'a game with no title');
}
{
  const d = goodDoc(); delete (d.game.stages[0].tasks[0] as Record<string, unknown>).id;
  refused(d, /id/i, 'a task with no id');
}
{
  const d = goodDoc(); delete (d.game.stages[0].tasks[0] as Record<string, unknown>).type;
  refused(d, /type/i, 'a task with no type');
}
{
  const d = goodDoc(); (d.game.stages[0].tasks[0] as Record<string, unknown>).type = 'teleport';
  refused(d, /type/i, 'a task with an unknown type');
}
{
  const d = goodDoc(); (d.game as Record<string, unknown>).stages = 'nope';
  refused(d, /stage/i, 'a game whose stages are not a list');
}
{
  const d = goodDoc();
  (d.game.stages[0].tasks[0] as Record<string, unknown>).coordinates = { lat: 999, lng: 0 };
  refused(d, /coordinat/i, 'a task with out-of-range coordinates');
}
{
  const d = goodDoc();
  d.game.stages[0].tasks.push({ ...d.game.stages[0].tasks[0] });
  refused(d, /duplicate|unique|id/i, 'two tasks sharing an id in one stage');
}

// A cyclic unlock graph — a stage where no task is ever routable.
{
  const d = goodDoc();
  const base = d.game.stages[0].tasks[0];
  d.game.stages[0].tasks = [
    { ...base, id: 'a', unlockAfterTaskIds: ['b'] },
    { ...base, id: 'b', unlockAfterTaskIds: ['a'] },
  ];
  refused(d, /unlock|cycle|circular/i, 'a cyclic unlock graph');
}
// A cross-stage prerequisite id.
{
  const d = goodDoc();
  d.game.stages[0].tasks[0].unlockAfterTaskIds = ['task-in-another-stage'];
  refused(d, /unlock|unknown|stage/i, 'an unlock prerequisite outside the stage');
}

// Size / count caps.
{
  const d = goodDoc();
  (d.game.stages[0].tasks[0] as Record<string, unknown>).description = 'x'.repeat(MAX_FILE_STRING_LEN + 1);
  refused(d, new RegExp(String(MAX_FILE_STRING_LEN)), 'a string longer than the per-field cap');
}
{
  const d = goodDoc();
  d.game.stages = Array.from({ length: MAX_FILE_STAGES + 1 }, (_, i) => ({
    ...goodDoc().game.stages[0], id: `s${i}`, order: i,
  }));
  refused(d, new RegExp(String(MAX_FILE_STAGES)), 'more stages than the cap');
}
{
  const d = goodDoc();
  const base = d.game.stages[0].tasks[0];
  d.game.stages[0].tasks = Array.from({ length: MAX_FILE_TASKS + 1 }, (_, i) => ({ ...base, id: `t${i}` }));
  refused(d, new RegExp(String(MAX_FILE_TASKS)), 'more tasks than the cap');
}
{
  // Byte cap: measured on the serialized payload BEFORE any parsing work.
  const d = goodDoc();
  (d.game as Record<string, unknown>).description = 'x'.repeat(MAX_GAME_FILE_BYTES + 10);
  refused(d, /large|size|MB|bytes/i, 'a document over the byte cap');
}

// Unknown fields at a KNOWN version are dropped silently (forward compatibility).
{
  const d = goodDoc() as unknown as Record<string, unknown>;
  (d.game as Record<string, unknown>).someFutureField = 'ignore me';
  ((d.game as { stages: Record<string, unknown>[] }).stages[0]).someFutureStageField = 1;
  const res = parseGameFile(d);
  ok(res.errors.length === 0 && res.game !== null, `unknown fields at a known version are dropped, not fatal (${res.errors.join(' · ')})`);
  ok(res.game !== null && !('someFutureField' in (res.game as Record<string, unknown>)), 'unknown game field is not carried through');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Filename helper
// ═══════════════════════════════════════════════════════════════════════════════

{
  const name = gameFileFilename('מירוץ העיר / העתיקה 🏛️');
  ok(name.endsWith('.rushpoint.json'), `filename carries the format extension (got ${name})`);
  ok(!/[/\\:*?"<>|]/.test(name), `filename has no path or reserved characters (got ${name})`);
  ok(gameFileFilename('').length > '.rushpoint.json'.length, 'an empty title still yields a usable filename');
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`test-game-file: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
