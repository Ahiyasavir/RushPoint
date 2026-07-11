// ─── RushPoint v2 — local emulator seed (seed-if-empty) ───────────────────────
// Seeds one demo Creator with a sample multi-stage Game, publishes it to the
// public gallery, and launches a live Run with a join code — so play-web has
// something to join on first boot and creator-web has a game to manage.
//
//   Creator login:  creator@rushpoint.dev / test1234
//   Join codes:     PLAY01  (and 1234)

import admin from 'firebase-admin';

const PROJECT_ID = 'rushpoint-pwa-7daaa';

process.env.FIRESTORE_EMULATOR_HOST     ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

admin.initializeApp({ projectId: PROJECT_ID });
const db   = admin.firestore();
const auth = admin.auth();

const OWNER_UID = 'demo-creator';
const GAME_ID   = 'demo-game-oldcity';
const RUN_ID    = 'demo-run-001';
const CODES      = ['PLAY01', '1234'];

async function ensureUser(uid, email, displayName) {
  try {
    await auth.createUser({ uid, email, password: 'test1234', displayName });
    console.log(`[seed] Created auth user ${email}`);
  } catch (e) {
    const code = e?.errorInfo?.code ?? e?.code;
    if (code === 'auth/uid-already-exists' || code === 'auth/email-already-exists') {
      console.log(`[seed] Auth user ${email} already exists — skipped.`);
    } else throw e;
  }
}

// ── Sample game template ──────────────────────────────────────────────────────
// A self-contained "try it from your couch" demo: every task is LOCATIONLESS and
// auto-verifies (quiz / numeric / sequence / auto-approved selfie / self-report),
// so a visitor can play it anywhere in seconds with NO operator and NO real-world
// location. This is what the landing "try a sample game" button opens.
function buildGame(now) {
  const t = (over) => ({
    coordinates: { lat: 0, lng: 0 }, locationless: true,
    difficulty: 3, estimatedMinutes: 2, pointValue: 100, maxConcurrentTeams: 50, ...over,
  });
  const stages = [
    {
      id: 'stage-1', order: 0, title: 'יוצאים לדרך',
      tasks: [t({
        id: 'task-1', title: 'שאלת פתיחה', type: 'quiz',
        description: 'איזה אימוג׳י הכי מתאים למשחק שדה?',
        choices: ['🏁', '🐌', '😴'], answers: ['🏁'], tags: ['demo'],
      })],
    },
    {
      id: 'stage-2', order: 1, title: 'אתגר מספרים',
      tasks: [t({
        id: 'task-2', title: 'חשבון מהיר', type: 'numeric',
        description: 'כמה זה 7 × 6?', numericAnswer: 42, numericTolerance: 0,
        difficulty: 4, pointValue: 120, tags: ['demo'],
      })],
    },
    {
      id: 'stage-3', order: 2, title: 'משימת רצף',
      tasks: [t({
        id: 'task-3', title: 'שלושה שלבים', type: 'sequence',
        description: 'השלימו את שלושת השלבים לפי הסדר.',
        difficulty: 4, pointValue: 140, tags: ['demo'],
        steps: [
          { id: 'step-1', prompt: 'מתחו את הרגליים והקישו לאישור' },
          { id: 'step-2', prompt: 'הקלידו את המילה: קדימה', answer: 'קדימה' },
          { id: 'step-3', prompt: 'קחו נשימה עמוקה והקישו לאישור' },
        ],
      })],
    },
    {
      id: 'stage-4', order: 3, title: 'סלפי ניצחון', isFinal: true,
      tasks: [t({
        id: 'task-4', title: 'צילום סיום', type: 'photo',
        description: 'צלמו סלפי מנצח (כל תמונה מתקבלת אוטומטית) — וסיימתם את הדמו!',
        pointValue: 160, tags: ['demo'],
        smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true },
      })],
    },
  ];

  return {
    id: GAME_ID,
    ownerUid: OWNER_UID,
    title: 'משחק לדוגמה: מירוץ הסלון',
    description: 'גרסת דמו קצרה של משחק שדה. שחקו אותה כדי לראות איך RushPoint עובד מבפנים.',
    mode: 'individual',
    stages,
    scoringPreset: 'fixed_points_speed',
    registrationFields: [
      { id: 'teamName', label: 'השם שלך', type: 'text', required: true, level: 'team' },
    ],
    visibility: 'public',
    tags: ['demo', 'מכל-מקום', 'דוגמה'],
    approxLocation: { lat: 32.0853, lng: 34.7818, label: 'משחק לדוגמה' },
    playCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
  const existing = await db.collection('accessCodes').limit(1).get();
  if (!existing.empty) {
    console.log('[seed] accessCodes already present — skipping seed.');
    return;
  }
  console.log('[seed] Empty database — seeding v2 demo data…');
  const now = new Date().toISOString();

  await ensureUser(OWNER_UID, 'creator@rushpoint.dev', 'Demo Creator');

  // ── Creator profile + wallet ──
  await db.doc(`users/${OWNER_UID}`).set({ uid: OWNER_UID, displayName: 'Demo Creator', email: 'creator@rushpoint.dev', createdAt: now });
  await db.doc(`wallets/${OWNER_UID}`).set({
    uid: OWNER_UID, eventCredits: 5, lifetimeFreeRunsUsed: 0, bonusFreeRuns: 0,
    plan: 'free', proExpiresAt: null, stripeSubscriptionId: null,
    lastPackageMaxParticipants: 30, updatedAt: now,
  });

  // ── Game template ──
  const game = buildGame(now);
  await db.doc(`users/${OWNER_UID}/games/${GAME_ID}`).set(game);
  console.log(`[seed] Seeded game "${game.title}" (${game.stages.length} stages).`);

  // ── Public gallery index (denormalized) ──
  const allTasks = game.stages.flatMap((s) => s.tasks);
  await db.doc(`publicGames/${GAME_ID}`).set({
    id: GAME_ID, ownerUid: OWNER_UID, ownerDisplayName: 'Demo Creator',
    title: game.title, description: game.description, mode: game.mode,
    scoringPreset: game.scoringPreset, tags: game.tags, approxLocation: game.approxLocation,
    playCount: 0, stageCount: game.stages.length, taskCount: allTasks.length,
    estimatedTotalMinutes: allTasks.reduce((s, t) => s + t.estimatedMinutes, 0),
    // The demo's tasks are all locationless/instant → playable anywhere. Mirrors
    // describeGameRequirements() so the welcome badge renders for the seed game.
    requirement: 'anywhere',
    createdAt: now, updatedAt: now,
  });
  const pb = db.batch();
  for (const t of allTasks) {
    pb.set(db.doc(`publicTasks/${GAME_ID}_${t.id}`), {
      id: `${GAME_ID}_${t.id}`, sourceGameId: GAME_ID, sourceGameTitle: game.title,
      ownerUid: OWNER_UID, ownerDisplayName: 'Demo Creator',
      title: t.title, description: t.description, type: t.type, coordinates: t.coordinates,
      difficulty: t.difficulty, estimatedMinutes: t.estimatedMinutes, pointValue: t.pointValue,
      tags: t.tags ?? [], copyCount: 0, createdAt: now,
    });
  }
  await pb.commit();
  console.log(`[seed] Published to gallery: 1 public game + ${allTasks.length} public tasks.`);

  // ── Live run + access codes ──
  await db.doc(`users/${OWNER_UID}/games/${GAME_ID}/runs/${RUN_ID}`).set({
    id: RUN_ID, gameId: GAME_ID, ownerUid: OWNER_UID, status: 'live',
    accessCode: CODES[0], billingType: 'free', maxParticipants: 5, participantCount: 0,
    launchedAt: now, createdAt: now, updatedAt: now,
  });
  const cb = db.batch();
  for (const code of CODES) {
    cb.set(db.doc(`accessCodes/${code}`), {
      code, ownerUid: OWNER_UID, gameId: GAME_ID, runId: RUN_ID, status: 'unused', createdAt: now,
    });
  }
  await cb.commit();
  console.log(`[seed] Launched run ${RUN_ID} with codes: ${CODES.join(', ')}`);
  console.log('[seed] Done. Creator: creator@rushpoint.dev / test1234 · Join code: PLAY01');
}

main().catch((err) => { console.error('[seed] Seed failed:', err); process.exit(1); });
