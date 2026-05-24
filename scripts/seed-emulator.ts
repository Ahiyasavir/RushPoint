/**
 * RushPoint — Firebase Emulator Seed Script
 *
 * Usage:
 *   npm run seed               # insert mock data (skips existing docs)
 *   npm run seed:reset         # wipe everything first, then seed fresh
 *
 * Prerequisites:
 *   1. Firebase emulators must be running: npm run emulator (from repo root)
 *   2. Emulator UI available at http://localhost:4000
 *
 * Firestore path convention used here (mirrors FIRESTORE_PATHS in shared/):
 *   PUBLIC  → artifacts/{appId}/public/data/{collection}/{docId}
 *   PRIVATE → artifacts/{appId}/users/{userId}/{collection}/{docId}
 */

import * as admin from 'firebase-admin';

// ─── Emulator connection ──────────────────────────────────────────────────────
// These MUST be set before admin.initializeApp() is called.
process.env.FIRESTORE_EMULATOR_HOST  = process.env.FIRESTORE_EMULATOR_HOST  ?? 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099';

const APP_ID     = process.env.RUSHPOINT_APP_ID ?? 'race-to-tzion-2026';
const PROJECT_ID = process.env.GCLOUD_PROJECT   ?? 'rushpoint-dev';
const RESET      = process.argv.includes('--reset');

admin.initializeApp({ projectId: PROJECT_ID });
const db   = admin.firestore();
const auth = admin.auth();

// ─── Path helpers (mirrors @rushpoint/shared FIRESTORE_PATHS) ─────────────────
const publicCol  = (col: string)                  => `artifacts/${APP_ID}/public/data/${col}`;
const privateCol = (uid: string, col: string)     => `artifacts/${APP_ID}/users/${uid}/${col}`;
const publicDoc  = (col: string, id: string)      => `${publicCol(col)}/${id}`;
const privateDoc = (uid: string, col: string, id: string) => `${privateCol(uid, col)}/${id}`;

// ─── Mock team ────────────────────────────────────────────────────────────────
const MOCK_UID = 'mock-team-uid-001';

const MOCK_TEAM = {
  id:          MOCK_UID,
  name:        'The Jerusalem Lions',
  code:        'LION1',
  memberNames: ['Yossi Cohen', 'Miriam Levi', 'Avi Katz', 'Shira Ben-David'],
  status:      'active',
  createdAt:   new Date().toISOString(),
  startedAt:   new Date().toISOString(),
};

// Initial game state — slot 0 active, rest locked
const MOCK_GAME_STATE = {
  teamId:      MOCK_UID,
  score:       0,
  bonusPenalty: 0,
  slots: [
    { index: 0, type: 'green',  status: 'active'  },
    { index: 1, type: 'green',  status: 'locked'  },
    { index: 2, type: 'green',  status: 'locked'  },
    { index: 3, type: 'green',  status: 'locked'  },
    { index: 4, type: 'orange', status: 'locked'  },
    { index: 5, type: 'gold',   status: 'locked'  },
    { index: 6, type: 'gold',   status: 'locked'  },
    { index: 7, type: 'gold',   status: 'locked'  },
  ],
  updatedAt: new Date().toISOString(),
};

// ─── Mock tasks ───────────────────────────────────────────────────────────────
const MOCK_TASKS = [
  // ── Green 1: Photo hunt ────────────────────────────────────────────────────
  {
    id: 'task-green-001',
    title: 'Jerusalem Landmarks Photo Hunt',
    titleHe: 'ציד תמונות אתרי ירושלים',
    description:
      'As a team, photograph all 5 specified Jerusalem landmarks. '
      + 'Each team member must appear in at least one photo.',
    type: 'green',
    coordinates: { lat: 31.7767, lng: 35.2345 },
    locationHint: 'Begin near the Old City Jaffa Gate.',
    qrCode: 'QR-GREEN-001',
    maxConcurrentTeams: 3,
    currentTeamCount: 0,
    photoRequired: true,
    pointValue: 100,
    estimatedMinutes: 15,
    isActive: true,
  },
  // ── Green 2: Trust challenge ───────────────────────────────────────────────
  {
    id: 'task-green-002',
    title: 'Blindfolded Trust Relay',
    titleHe: 'ריצת השליחות בעיניים עצומות',
    description:
      'One team member is blindfolded. The rest must guide them '
      + 'through a 50-metre obstacle course using only verbal instructions.',
    type: 'green',
    coordinates: { lat: 31.7750, lng: 35.2310 },
    locationHint: 'Look for the open plaza near the Citadel.',
    qrCode: 'QR-GREEN-002',
    maxConcurrentTeams: 2,
    currentTeamCount: 0,
    photoRequired: true,
    pointValue: 100,
    estimatedMinutes: 20,
    isActive: true,
  },
  // ── Green 3: Bible trivia ──────────────────────────────────────────────────
  {
    id: 'task-green-003',
    title: 'Jerusalem Bible Trivia Blitz',
    titleHe: 'חידון תנ"ך ירושלמי',
    description:
      'Answer 10 Jerusalem-themed Bible trivia questions as a team. '
      + 'Discuss and submit your collective answer for each.',
    type: 'green',
    coordinates: { lat: 31.7780, lng: 35.2356 },
    locationHint: 'Station is near the Cardo ruins in the Jewish Quarter.',
    qrCode: 'QR-GREEN-003',
    maxConcurrentTeams: 4,
    currentTeamCount: 0,
    photoRequired: false,
    pointValue: 100,
    estimatedMinutes: 12,
    isActive: true,
  },
  // ── Orange: Find the Tene ──────────────────────────────────────────────────
  {
    id: 'task-orange-001',
    title: 'Find Your Tene in the Bible Park',
    titleHe: 'מצאו את הטנא בפארק התנ"ך',
    description:
      'Navigate to the Bible Lands Museum park using the in-app map and the '
      + 'physical clues hidden along the route. Find and retrieve your team\'s '
      + 'Tene (wicker basket) hidden somewhere in the park.',
    type: 'orange',
    coordinates: { lat: 31.7716, lng: 35.2026 },
    locationHint: 'The park entrance faces the Israel Museum. Look for the olive tree grove.',
    qrCode: 'QR-ORANGE-001',
    maxConcurrentTeams: 6,
    currentTeamCount: 0,
    photoRequired: true,
    pointValue: 150,
    estimatedMinutes: 30,
    isActive: true,
  },
  // ── Gold: Grape pressing ───────────────────────────────────────────────────
  {
    id: 'task-gold-001',
    title: 'Ancient Grape Press',
    titleHe: 'גת עתיקה — סחיטת ענבים',
    description:
      'Use the replica ancient grape press to squeeze fresh grape juice. '
      + 'Fill the small clay flask provided and seal it to add to your Tene.',
    type: 'gold',
    coordinates: { lat: 31.7718, lng: 35.2030 },
    locationHint: 'Inside the park, near the agricultural stations.',
    qrCode: 'QR-GOLD-001',
    maxConcurrentTeams: 2,
    currentTeamCount: 0,
    photoRequired: true,
    pointValue: 200,
    estimatedMinutes: 20,
    isActive: true,
  },
];

// ─── Reset helpers ────────────────────────────────────────────────────────────

async function deleteCollection(collectionPath: string): Promise<void> {
  const snap = await db.collection(collectionPath).get();
  if (snap.empty) return;

  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  console.info(`  🗑  Cleared ${snap.size} doc(s) from ${collectionPath}`);
}

async function resetEmulator(): Promise<void> {
  console.info('\n🔥 Resetting emulator data...');
  await deleteCollection(publicCol('tasks'));
  await deleteCollection(publicCol('events'));
  await deleteCollection(privateCol(MOCK_UID, 'profile'));
  await deleteCollection(privateCol(MOCK_UID, 'gameState'));

  // Delete the mock Auth user if it exists
  try {
    await auth.deleteUser(MOCK_UID);
    console.info(`  🗑  Deleted Auth user ${MOCK_UID}`);
  } catch {
    // User didn't exist — no problem
  }
}

// ─── Seed functions ───────────────────────────────────────────────────────────

async function seedAuthUser(): Promise<void> {
  try {
    await auth.createUser({
      uid:         MOCK_UID,
      displayName: MOCK_TEAM.name,
    });
    console.info(`  ✅ Created Auth user: ${MOCK_UID} (${MOCK_TEAM.name})`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'auth/uid-already-exists') {
      console.info(`  ⏭  Auth user ${MOCK_UID} already exists — skipping`);
    } else {
      throw err;
    }
  }
}

async function seedTeam(): Promise<void> {
  const profileRef  = db.doc(privateDoc(MOCK_UID, 'profile',   'team'));
  const gameRef     = db.doc(privateDoc(MOCK_UID, 'gameState', 'current'));

  const batch = db.batch();
  batch.set(profileRef, MOCK_TEAM,      { merge: !RESET });
  batch.set(gameRef,    MOCK_GAME_STATE, { merge: !RESET });
  await batch.commit();

  console.info(`  ✅ Team profile   → ${profileRef.path}`);
  console.info(`  ✅ Game state     → ${gameRef.path}`);
}

async function seedTasks(): Promise<void> {
  const batch = db.batch();

  for (const task of MOCK_TASKS) {
    const ref = db.doc(publicDoc('tasks', task.id));
    batch.set(ref, task, { merge: !RESET });
  }

  await batch.commit();
  console.info(`  ✅ Seeded ${MOCK_TASKS.length} tasks → ${publicCol('tasks')}`);
  console.info(`     3× green  | 1× orange | 1× gold`);
}

async function seedEvent(): Promise<void> {
  const ref = db.doc(publicDoc('events', 'current'));
  await ref.set(
    {
      id:     'current',
      name:   'Race to Tzion 2026 — Dev Session',
      nameHe: 'המירוץ לציון 2026 — סשן פיתוח',
      status: 'live',
      startedAt: new Date().toISOString(),
      settings: {
        maxTeamsPerStation:      3,
        freezeMinutesBeforeEnd:  30,
        clueHintPenaltyPoints:   50,
        clueHintLockSeconds:     60,
        stationaryAlertMinutes:  15,
      },
    },
    { merge: !RESET },
  );
  console.info(`  ✅ Event config   → ${publicDoc('events', 'current')}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.info('\n╔═══════════════════════════════════════╗');
  console.info('║   RushPoint — Emulator Seed Script    ║');
  console.info('╚═══════════════════════════════════════╝');
  console.info(`  App ID:     ${APP_ID}`);
  console.info(`  Project:    ${PROJECT_ID}`);
  console.info(`  Firestore:  ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.info(`  Mode:       ${RESET ? 'RESET + seed' : 'merge (no overwrite)'}\n`);

  if (RESET) {
    await resetEmulator();
    console.info();
  }

  console.info('🌱 Seeding...');
  await seedAuthUser();
  await seedTasks();
  await seedTeam();
  await seedEvent();

  console.info('\n✅ Done! Open http://localhost:4000 to inspect the data.');
  console.info(
    `   Firestore path root: artifacts/${APP_ID}/\n`,
  );
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err);
  process.exit(1);
});
