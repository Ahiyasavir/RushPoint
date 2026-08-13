// ─── RushPoint v2 — local emulator seed (seed-if-empty) ───────────────────────
// Seeds one demo Creator with a sample multi-stage Game, publishes it to the
// public gallery, and launches a live Run with a join code — so play-web has
// something to join on first boot and creator-web has a game to manage.
//
//   Creator login:  creator@rushpoint.dev / test1234
//   Join codes:     PLAY01  (and 1234)

import admin from 'firebase-admin';
import { publicTaskLocation, repairPublicTask, mayNeedPublicTaskRepair } from '@rushpoint/shared';
import { seedSansana, GAME_ID as SANSANA_GAME_ID } from './lib/sansana-game-def.mjs';
import { seedQaGame, GAME_ID as QA_GAME_ID, CODE as QA_CODE } from './lib/qa-game-def.mjs';
import { seedSpyAcademy, GAME_ID as SPY_GAME_ID, CODE as SPY_CODE } from './lib/spy-academy-game-def.mjs';

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
    // Publishing IS the instant-play opt-in (change: gallery-missions-quick-play),
    // and this seed writes the gallery docs DIRECTLY rather than going through
    // publishGame — so it has to apply that default itself or the demo game shows a
    // gallery card with no Play button, which is the state creators reported.
    allowInstantPlay: true,
    tags: ['demo', 'מכל-מקום', 'דוגמה'],
    approxLocation: { lat: 32.0853, lng: 34.7818, label: 'משחק לדוגמה' },
    playCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Sansana field-game (idempotent restore) ──────────────────────────────────
// The emulator is restarted non-gracefully by the always-on supervisor, so any
// data not in the persisted import is lost on reboot. Re-seed the real Sansana
// night game on every boot (idempotent — no-op once its gallery card exists) so
// it never disappears again. See scripts/lib/sansana-game-def.mjs.
async function ensureSansana(now) {
  const snap = await db.doc(`publicGames/${SANSANA_GAME_ID}`).get();
  if (snap.exists) {
    console.log('[seed] Sansana field-game already present — skipped.');
    return;
  }
  console.log('[seed] Seeding the Sansana field-game…');
  await seedSansana(admin, db, auth, now);
  console.log('[seed] Sansana seeded — join code SANSANA, in the public gallery.');
}

// ── QA playground (idempotent restore) ───────────────────────────────────────
// The "every task type in one game" QA game — same reboot-survival reasoning as
// Sansana above. See scripts/lib/qa-game-def.mjs.
async function ensureQaGame(now) {
  const snap = await db.doc(`publicGames/${QA_GAME_ID}`).get();
  if (snap.exists) {
    console.log('[seed] QA playground already present — skipped.');
    return;
  }
  console.log('[seed] Seeding the QA playground…');
  await seedQaGame(admin, db, auth, now);
  console.log(`[seed] QA playground seeded — join code ${QA_CODE}.`);
}

// ── Flagship instant-play demo (idempotent restore) ──────────────────────────
// "אקדמיית הסוכנים" — the FACE of the app: the game the creator landing page's
// "try a sample game" button opens via startInstantPlay. Locationless, staffless,
// auto-approving, playable anywhere in seconds. Same reboot-survival reasoning as
// Sansana/QA above. See scripts/lib/spy-academy-game-def.mjs.
async function ensureSpyAcademy(now) {
  const snap = await db.doc(`publicGames/${SPY_GAME_ID}`).get();
  if (snap.exists) {
    console.log('[seed] Flagship spy-academy demo already present — skipped.');
    return;
  }
  console.log('[seed] Seeding the flagship spy-academy demo…');
  await seedSpyAcademy(admin, db, auth, now);
  console.log(`[seed] Flagship demo seeded — instant play, join code ${SPY_CODE}.`);
}

async function seedDemo(now) {
  console.log('[seed] Empty database — seeding v2 demo data…');

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
    // Must MIRROR the private game doc above: the gallery renders its Play button
    // from this copy, but startInstantPlay authorizes against the private one. If
    // only this side said true the button would appear and then be refused.
    allowInstantPlay: true,
    // The demo's tasks are all locationless/instant → playable anywhere. Mirrors
    // describeGameRequirements() so the welcome badge renders for the seed game.
    requirement: 'anywhere',
    createdAt: now, updatedAt: now,
  });
  const pb = db.batch();
  for (const t of allTasks) {
    // publicTasks is world-readable, so it gets the coarse ~1 km AREA and never the
    // authored point — same rule publishGame applies (change:
    // public-task-area-visibility). Omitted entirely for hidden / locationless /
    // unplaced tasks, which is also what makes them absent from the library map.
    const approxLocation = publicTaskLocation(t);
    pb.set(db.doc(`publicTasks/${GAME_ID}_${t.id}`), {
      id: `${GAME_ID}_${t.id}`, sourceGameId: GAME_ID, sourceGameTitle: game.title,
      ownerUid: OWNER_UID, ownerDisplayName: 'Demo Creator',
      title: t.title, description: t.description, type: t.type,
      ...(approxLocation ? { approxLocation } : {}),
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

// ── Self-healing repair of the public gallery map (gallery-precise-task-location) ──
// The demo/QA/Sansana games are seed-if-present (skipped once they exist), and a
// creator's own published games are never re-seeded at all — so a `publicTasks`
// document written before the precise-location rule keeps its LEGACY shape
// forever: an exact `coordinates` and NO `approxLocation`. The gallery map reads
// only `approxLocation`, so every such mission silently vanishes from the map
// (and any that carried the OLD coarse area sits ~1 km off). The maintenance
// callable `backfillPublicTaskCoordinatesNow` fixes this in production, but
// nothing triggers it in a dev/playtest emulator — which is why re-seeding never
// changed what a creator saw.
//
// This sweep IS that repair, run on every boot. It reuses the SAME shared pure
// rule the production backfill applies (`repairPublicTask`): resolve each public
// task's authored source, then write the correct area (exact for an ordinary
// located mission, a coarse ~1 km cell for a hideLocation mission, and none for
// locationless/unplaced) and delete the legacy exact `coordinates`. Idempotent —
// a conformant document is skipped, so a second boot is a no-op. Emulator-only
// (this script never runs in production), so it carries no prod risk.
const DELETE = admin.firestore.FieldValue.delete();

function tasksOf(game) {
  const out = new Map();
  for (const stage of game?.stages ?? []) {
    for (const task of stage.tasks ?? []) out.set(task.id, task);
  }
  return out;
}

async function repairPublicTaskAreas() {
  const snap = await db.collection('publicTasks').get();
  const gameCache = new Map();
  const writes = [];
  let repaired = 0, cleared = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (!mayNeedPublicTaskRepair(data)) continue;

    let source = null;
    if (data.ownerUid && data.sourceGameId) {
      const key = `${data.ownerUid}/${data.sourceGameId}`;
      let tasks = gameCache.get(key);
      if (!tasks) {
        let game;
        try {
          const g = await db.doc(`users/${data.ownerUid}/games/${data.sourceGameId}`).get();
          game = g.exists ? g.data() : undefined;
        } catch { game = undefined; }
        tasks = tasksOf(game);
        gameCache.set(key, tasks);
      }
      // Public id is `${gameId}_${taskId}`; strip the prefix (a task id may itself
      // contain '_', so don't split on it).
      const taskId = doc.id.startsWith(`${data.sourceGameId}_`)
        ? doc.id.slice(data.sourceGameId.length + 1)
        : doc.id;
      source = tasks.get(taskId) ?? null;
    }

    const repair = repairPublicTask(data, source);
    if (!repair) continue;
    repaired++;
    if (!repair.approxLocation) cleared++;
    writes.push({ ref: doc.ref, data: { coordinates: DELETE, approxLocation: repair.approxLocation ?? DELETE } });
  }

  // Commit in ≤450-op chunks — a WriteBatch is hard-capped at 500.
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 450)) batch.set(w.ref, w.data, { merge: true });
    await batch.commit();
  }
  if (repaired) {
    console.log(`[seed] Repaired ${repaired} legacy public-task map pin(s) `
      + `(${cleared} had no map location; the rest now carry their exact area).`);
  } else {
    console.log('[seed] Public gallery map already conformant — no pins to repair.');
  }
}

async function main() {
  const now = new Date().toISOString();

  // Demo game is seed-if-empty; Sansana is ensured on every boot (idempotent).
  const existing = await db.collection('accessCodes').limit(1).get();
  if (existing.empty) await seedDemo(now);
  else console.log('[seed] accessCodes already present — skipping demo seed.');

  await ensureSansana(now);
  await ensureQaGame(now);
  await ensureSpyAcademy(now);

  // Heal any legacy publicTasks (demo OR a creator's own games) so the gallery
  // map shows every located mission at its correct spot — see repairPublicTaskAreas.
  await repairPublicTaskAreas();
}

main().catch((err) => { console.error('[seed] Seed failed:', err); process.exit(1); });
