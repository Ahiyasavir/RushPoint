/**
 * RushPoint — Firebase Emulator Seed Script
 *
 * Generates 4 teams in distinct game states to cover every UI scenario:
 *
 *   Team A  "The Rookies"         → Just logged in. 0 pts, slot 0 active.
 *   Team B  "The Explorers"       → Mid-race. Slot 0 done, slot 1 active. 100 pts.
 *   Team C  "The Basket Finders"  → In the park. All green+orange done. Pending judge check-in.
 *   Team D  "The Champions"       → Finished. All 8 slots done. Judge score applied. 2104 pts.
 *
 * Usage:
 *   npm run seed          → merge (idempotent, skips existing docs)
 *   npm run seed:reset    → wipe all mock data first, then seed fresh
 *
 * Prerequisites:
 *   Firebase emulators must be running:  npm run emulator  (from repo root)
 *   Emulator UI:                         http://localhost:4000
 */

import * as admin from 'firebase-admin';

// ─── Emulator connection ──────────────────────────────────────────────────────
// Must be set BEFORE admin.initializeApp()
process.env.FIRESTORE_EMULATOR_HOST     = process.env.FIRESTORE_EMULATOR_HOST     ?? 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099';

const APP_ID     = process.env.RUSHPOINT_APP_ID ?? 'race-to-tzion-2026';
// Firebase project id — must match .firebaserc default and the client configs so
// the seed writes into the same emulator namespace the apps read from.
const PROJECT_ID = process.env.GCLOUD_PROJECT   ?? 'race-to-tzion-2026';
const RESET      = process.argv.includes('--reset');

admin.initializeApp({ projectId: PROJECT_ID });
const db   = admin.firestore();
const auth = admin.auth();

// ─── Path helpers ─────────────────────────────────────────────────────────────
// Mirrors FIRESTORE_PATHS from @rushpoint/shared — keep in sync.
const pub    = (col: string)                        => `artifacts/${APP_ID}/public/data/${col}`;
const priv   = (uid: string, col: string)           => `artifacts/${APP_ID}/users/${uid}/${col}`;
const pubDoc = (col: string, id: string)            => `${pub(col)}/${id}`;
const prvDoc = (uid: string, col: string, id: string) => `${priv(uid, col)}/${id}`;
const codes        = ()           => `artifacts/${APP_ID}/accessCodes`;
const codeDoc      = (code: string) => `${codes()}/${code}`;

// ─── Time helpers ─────────────────────────────────────────────────────────────
const minsAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const now     = ()          => new Date().toISOString();

// ═══════════════════════════════════════════════════════════════════════════════
// TEAM DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const TEAMS = {
  A: { uid: 'mock-team-a-uid', name: 'The Rookies',        code: 'ROOK1' },
  B: { uid: 'mock-team-b-uid', name: 'The Explorers',      code: 'EXPL2' },
  C: { uid: 'mock-team-c-uid', name: 'The Basket Finders', code: 'BSKT3' },
  D: { uid: 'mock-team-d-uid', name: 'The Champions',      code: 'CHMP4' },
} as const;

const ALL_UIDS = Object.values(TEAMS).map((t) => t.uid);

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS  (public data — readable by all authenticated users)
// Path: artifacts/{appId}/public/data/tasks/{taskId}
// ═══════════════════════════════════════════════════════════════════════════════

const TASKS = [
  // ── Green ──────────────────────────────────────────────────────────────────
  {
    id: 'task-green-001',
    title: 'Jerusalem Landmarks Photo Hunt',
    titleHe: 'ציד תמונות אתרי ירושלים',
    description: 'Photograph all 5 specified Jerusalem landmarks as a team. Each member must appear in at least one photo.',
    type: 'green',
    coordinates: { lat: 31.7767, lng: 35.2345 },
    locationHint: 'Begin near Jaffa Gate in the Old City.',
    qrCode: 'QR-GREEN-001',
    difficulty: 3,
    maxConcurrentTeams: 3,
    currentTeamCount: 0,
    photoRequired: true,
    pointValue: 100,
    estimatedMinutes: 15,
    isActive: true,
  },
  {
    id: 'task-green-002',
    title: 'Blindfolded Trust Relay',
    titleHe: 'ריצת השליחות בעיניים עצומות',
    description: 'One team member is blindfolded. The rest must guide them through a 50-metre course using verbal instructions only.',
    type: 'green',
    coordinates: { lat: 31.7750, lng: 35.2310 },
    locationHint: 'Open plaza near the Tower of David.',
    qrCode: 'QR-GREEN-002',
    difficulty: 5,
    maxConcurrentTeams: 2,
    currentTeamCount: 0,
    photoRequired: true,
    pointValue: 100,
    estimatedMinutes: 20,
    isActive: true,
  },
  {
    id: 'task-green-003',
    title: 'Bible Trivia Blitz',
    titleHe: 'חידון תנ"ך ירושלמי',
    description: 'Answer 10 Jerusalem-themed Bible trivia questions together. Submit one collective answer per question.',
    type: 'green',
    coordinates: { lat: 31.7780, lng: 35.2356 },
    locationHint: 'Near the Cardo ruins in the Jewish Quarter.',
    qrCode: 'QR-GREEN-003',
    difficulty: 4,
    maxConcurrentTeams: 4,
    currentTeamCount: 0,
    photoRequired: false,
    pointValue: 100,
    estimatedMinutes: 12,
    isActive: true,
  },
  {
    id: 'task-green-004',
    title: 'The Human Knot',
    titleHe: 'קשר אנושי',
    description: 'All team members join hands in a tangled circle. Work together to untangle the knot without releasing hands.',
    type: 'green',
    coordinates: { lat: 31.7760, lng: 35.2340 },
    locationHint: 'Open area near the Jewish Quarter centre.',
    qrCode: 'QR-GREEN-004',
    difficulty: 2,
    maxConcurrentTeams: 3,
    currentTeamCount: 0,
    photoRequired: true,
    pointValue: 100,
    estimatedMinutes: 10,
    isActive: true,
  },
  // ── Orange ─────────────────────────────────────────────────────────────────
  {
    id: 'task-orange-001',
    title: 'Find Your Tene in the Bible Park',
    titleHe: 'מצאו את הטנא בפארק התנ"ך',
    description:
      'Navigate to the Bible Lands Museum park using the in-app map and physical clues hidden along the route. '
      + "Find and retrieve your team's Tene (wicker basket) hidden in the park.",
    type: 'orange',
    coordinates: { lat: 31.7716, lng: 35.2026 },
    locationHint: 'Park entrance faces the Israel Museum. Look for the olive tree grove.',
    qrCode: 'QR-ORANGE-001',
    difficulty: 6,
    maxConcurrentTeams: 6,
    currentTeamCount: 0,
    photoRequired: true,
    pointValue: 150,
    estimatedMinutes: 30,
    isActive: true,
  },
  // ── Gold ───────────────────────────────────────────────────────────────────
  {
    id: 'task-gold-001',
    title: 'Ancient Grape Press',
    titleHe: 'גת עתיקה — סחיטת ענבים',
    description: 'Use the replica ancient grape press to squeeze fresh juice. Fill and seal the clay flask provided.',
    type: 'gold',
    coordinates: { lat: 31.7718, lng: 35.2030 },
    locationHint: 'Near the agricultural stations inside the park.',
    qrCode: 'QR-GOLD-001',
    difficulty: 7,
    maxConcurrentTeams: 2,
    currentTeamCount: 0,
    photoRequired: true,
    pointValue: 200,
    estimatedMinutes: 20,
    isActive: true,
  },
  {
    id: 'task-gold-002',
    title: 'Spice Sachet Craft',
    titleHe: 'הכנת שקיק תבלינים',
    description: 'Blend three traditional spices and sew them into a linen sachet to place in your Tene.',
    type: 'gold',
    coordinates: { lat: 31.7720, lng: 35.2032 },
    locationHint: 'Craft tent near the park\'s southern entrance.',
    qrCode: 'QR-GOLD-002',
    difficulty: 8,
    maxConcurrentTeams: 3,
    currentTeamCount: 0,
    photoRequired: true,
    pointValue: 200,
    estimatedMinutes: 25,
    isActive: true,
  },
  {
    id: 'task-gold-003',
    title: 'Olive Oil Extraction',
    titleHe: 'כבישת שמן זית',
    description: 'Use the traditional stone press to extract olive oil. Fill the small vial provided for your Tene.',
    type: 'gold',
    coordinates: { lat: 31.7715, lng: 35.2028 },
    locationHint: 'Stone press station — marked with an olive branch sign.',
    qrCode: 'QR-GOLD-003',
    difficulty: 8,
    maxConcurrentTeams: 2,
    currentTeamCount: 0,
    photoRequired: true,
    pointValue: 200,
    estimatedMinutes: 18,
    isActive: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// GAME STATE BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Locked slot template */
const locked = (index: number, type: 'green' | 'orange' | 'gold') =>
  ({ index, type, status: 'locked' });

/** Active slot template — startedAt drives the mobile elapsed-time clock */
const active = (index: number, type: 'green' | 'orange' | 'gold', startedMinsAgo = 5) =>
  ({ index, type, status: 'active', startedAt: minsAgo(startedMinsAgo) });

/** Completed slot template */
const done = (
  index: number,
  type: 'green' | 'orange' | 'gold',
  taskId: string,
  taskTitle: string,
  completedMinsAgo: number,
) => ({
  index,
  type,
  status: 'completed',
  taskId,
  taskTitle,
  completedAt: minsAgo(completedMinsAgo),
});

// ─── Team A — "The Rookies" — just logged in ──────────────────────────────────
const gameStateA = {
  teamId:       TEAMS.A.uid,
  score:        0,
  bonusPenalty: 0,
  currentTaskId: 'task-green-001',
  slots: [
    active(0, 'green', 2),
    locked(1, 'green'),
    locked(2, 'green'),
    locked(3, 'green'),
    locked(4, 'orange'),
    locked(5, 'gold'),
    locked(6, 'gold'),
    locked(7, 'gold'),
  ],
  updatedAt: now(),
};

// ─── Team B — "The Explorers" — mid-race, 1 green done ───────────────────────
const gameStateB = {
  teamId:       TEAMS.B.uid,
  score:        100,
  bonusPenalty: 0,
  currentTaskId: 'task-green-002',
  slots: [
    done(0, 'green', 'task-green-001', 'Jerusalem Landmarks Photo Hunt', 30),
    active(1, 'green'),
    locked(2, 'green'),
    locked(3, 'green'),
    locked(4, 'orange'),
    locked(5, 'gold'),
    locked(6, 'gold'),
    locked(7, 'gold'),
  ],
  updatedAt: minsAgo(5),
};

// ─── Team C — "The Basket Finders" — in park, pending judge check-in ─────────
// Score: 4×100 (green) + 150 (orange) = 550
const gameStateC = {
  teamId:       TEAMS.C.uid,
  score:        550,
  bonusPenalty: 0,
  currentTaskId: 'task-gold-001',
  slots: [
    done(0, 'green',  'task-green-001', 'Jerusalem Landmarks Photo Hunt', 90),
    done(1, 'green',  'task-green-002', 'Blindfolded Trust Relay',        75),
    done(2, 'green',  'task-green-003', 'Bible Trivia Blitz',             58),
    done(3, 'green',  'task-green-004', 'The Human Knot',                 44),
    done(4, 'orange', 'task-orange-001', 'Find Your Tene in the Bible Park', 25),
    active(5, 'gold', 8),
    active(6, 'gold', 8),
    active(7, 'gold', 8),
  ],
  updatedAt: minsAgo(2),
};

// ─── Team D — "The Champions" — fully finished ────────────────────────────────
// Score: slotPoints(1150) + completionBonus(500) + speedBonus(208) + basketBonus(246) = 2104
const gameStateD = {
  teamId:        TEAMS.D.uid,
  score:         2104,
  bonusPenalty:  0,
  currentTaskId: null,
  slots: [
    done(0, 'green',  'task-green-001', 'Jerusalem Landmarks Photo Hunt', 85),
    done(1, 'green',  'task-green-002', 'Blindfolded Trust Relay',        70),
    done(2, 'green',  'task-green-003', 'Bible Trivia Blitz',             55),
    done(3, 'green',  'task-green-004', 'The Human Knot',                 43),
    done(4, 'orange', 'task-orange-001', 'Find Your Tene in the Bible Park', 30),
    done(5, 'gold',   'task-gold-001', 'Ancient Grape Press',             22),
    done(6, 'gold',   'task-gold-002', 'Spice Sachet Craft',             14),
    done(7, 'gold',   'task-gold-003', 'Olive Oil Extraction',            8),
  ],
  updatedAt: minsAgo(5),
};

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK-IN DOCUMENTS
// Path: artifacts/{appId}/users/{userId}/checkIns/{checkInId}
// ═══════════════════════════════════════════════════════════════════════════════

// Team C — PENDING gold check-in (what the Judge Panel should display)
const checkInC = {
  id:        'checkin-team-c-gold-001',
  teamId:    TEAMS.C.uid,
  taskId:    'task-gold-001',
  timestamp: minsAgo(3),
  photoUrl:  'https://placehold.co/600x400/1a1a2e/22c55e?text=Team+C+Grape+Press', // placeholder
  status:    'pending',   // ← Judge Panel shows this
  location:  { lat: 31.7718, lng: 35.2030 },
};

// Team D — APPROVED gold check-in (judge already scored it: 82/100)
const checkInD = {
  id:         'checkin-team-d-gold-001',
  teamId:     TEAMS.D.uid,
  taskId:     'task-gold-003',
  timestamp:  minsAgo(9),
  photoUrl:   'https://placehold.co/600x400/1a1a2e/eab308?text=Team+D+Olive+Oil',
  status:     'approved',
  location:   { lat: 31.7715, lng: 35.2028 },
  judgeId:    'mock-judge-uid',
  judgeScore: 82,
  judgeNote:  'Excellent olive oil extraction. Great presentation in the Tene.',
};

// ═══════════════════════════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════════════════════════

async function deleteCollection(path: string): Promise<void> {
  const snap = await db.collection(path).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  console.info(`  🗑  Cleared ${snap.size} doc(s) from …/${path.split('/').slice(-1)[0]}`);
}

async function resetEmulator(): Promise<void> {
  console.info('\n🔥 Resetting emulator data...');

  // Public collections
  await deleteCollection(pub('tasks'));
  await deleteCollection(pub('events'));
  await deleteCollection(pub('leaderboard'));
  await deleteCollection(codes());

  // Private collections for each mock team
  for (const uid of ALL_UIDS) {
    await deleteCollection(priv(uid, 'profile'));
    await deleteCollection(priv(uid, 'gameState'));
    await deleteCollection(priv(uid, 'checkIns'));
    await deleteCollection(priv(uid, 'assignments'));
  }

  // Auth users
  for (const uid of ALL_UIDS) {
    try {
      await auth.deleteUser(uid);
      console.info(`  🗑  Deleted Auth user ${uid}`);
    } catch {
      // Didn't exist — fine
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEED FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function seedAuthUsers(): Promise<void> {
  const entries = [
    { uid: TEAMS.A.uid, name: TEAMS.A.name },
    { uid: TEAMS.B.uid, name: TEAMS.B.name },
    { uid: TEAMS.C.uid, name: TEAMS.C.name },
    { uid: TEAMS.D.uid, name: TEAMS.D.name },
  ];

  for (const { uid, name } of entries) {
    try {
      await auth.createUser({ uid, displayName: name });
      console.info(`  ✅ Auth user created: ${uid}  (${name})`);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'auth/uid-already-exists') {
        console.info(`  ⏭  Auth user already exists: ${uid} — skipped`);
      } else {
        throw err;
      }
    }
  }
}

async function seedTasks(): Promise<void> {
  const batch = db.batch();
  for (const task of TASKS) {
    batch.set(db.doc(pubDoc('tasks', task.id)), task, { merge: !RESET });
  }
  await batch.commit();

  const green  = TASKS.filter((t) => t.type === 'green').length;
  const orange = TASKS.filter((t) => t.type === 'orange').length;
  const gold   = TASKS.filter((t) => t.type === 'gold').length;
  console.info(`  ✅ Tasks seeded: ${TASKS.length} total  (${green}× green | ${orange}× orange | ${gold}× gold)`);
}

async function seedEvent(): Promise<void> {
  await db.doc(pubDoc('events', 'current')).set({
    id: 'current',
    name: 'Race to Tzion 2026 — Dev Session',
    nameHe: 'המירוץ לציון 2026 — סשן פיתוח',
    status: 'live',
    startedAt: minsAgo(120),
    settings: {
      maxTeamsPerStation:     3,
      freezeMinutesBeforeEnd: 30,
      clueHintPenaltyPoints:  50,
      clueHintLockSeconds:    60,
      stationaryAlertMinutes: 15,
    },
  }, { merge: !RESET });
  console.info(`  ✅ Event config seeded`);
}

async function seedLeaderboard(): Promise<void> {
  await db.doc(pubDoc('leaderboard', 'current')).set({
    eventId:  'current',
    frozen:   false,
    updatedAt: now(),
    rankings: [
      { rank: 1, teamId: TEAMS.D.uid, teamName: TEAMS.D.name, score: 2104, completedSlots: 8, finishedAt: minsAgo(5), durationSeconds: 95 * 60 },
      { rank: 2, teamId: TEAMS.C.uid, teamName: TEAMS.C.name, score: 550,  completedSlots: 5 },
      { rank: 3, teamId: TEAMS.B.uid, teamName: TEAMS.B.name, score: 100,  completedSlots: 1 },
      { rank: 4, teamId: TEAMS.A.uid, teamName: TEAMS.A.name, score: 0,    completedSlots: 0 },
    ],
  }, { merge: !RESET });
  console.info(`  ✅ Leaderboard seeded  (4 teams ranked)`);
}

// ─── Access codes — pre-generated, handed out at the event ────────────────────
// Path: artifacts/{appId}/accessCodes/{code}
// Unclaimed codes route to registration; claimed codes log into an existing team.
const ACCESS_CODES = ['LION01', 'BEAR02', 'WOLF03'];

async function seedAccessCodes(): Promise<void> {
  const batch = db.batch();
  for (const code of ACCESS_CODES) {
    batch.set(
      db.doc(codeDoc(code)),
      { code, claimed: false, teamId: null, createdAt: now() },
      { merge: !RESET },
    );
  }
  await batch.commit();
  console.info(`  ✅ Access codes seeded: ${ACCESS_CODES.join(', ')}  (all unclaimed)`);
}

async function seedTeam(
  team: typeof TEAMS[keyof typeof TEAMS],
  members: string[],
  status: string,
  startedMinsAgo: number,
  gameState: object,
  checkIn?: object,
  finishedMinsAgo?: number,
): Promise<void> {
  const profile = {
    id:          team.uid,
    name:        team.name,
    code:        team.code,
    memberNames: members,
    status,
    createdAt:   minsAgo(startedMinsAgo + 2),
    startedAt:   minsAgo(startedMinsAgo),
    ...(finishedMinsAgo !== undefined && { finishedAt: minsAgo(finishedMinsAgo) }),
  };

  const batch = db.batch();
  batch.set(db.doc(prvDoc(team.uid, 'profile',   'team')),    profile,   { merge: !RESET });
  batch.set(db.doc(prvDoc(team.uid, 'gameState', 'current')), gameState, { merge: !RESET });
  if (checkIn) {
    const ci = checkIn as { id: string };
    batch.set(db.doc(prvDoc(team.uid, 'checkIns', ci.id)), checkIn, { merge: !RESET });
  }
  await batch.commit();

  console.info(`  ✅ ${team.name.padEnd(22)} code=${team.code}  status=${status}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.info('\n╔══════════════════════════════════════════════╗');
  console.info('║    RushPoint — Emulator Seed Script v2.0    ║');
  console.info('╚══════════════════════════════════════════════╝');
  console.info(`  App ID:     ${APP_ID}`);
  console.info(`  Project:    ${PROJECT_ID}`);
  console.info(`  Firestore:  ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.info(`  Mode:       ${RESET ? '⚠️  RESET + seed' : 'merge (idempotent)'}\n`);

  if (RESET) {
    await resetEmulator();
    console.info('');
  }

  console.info('🌱 Seeding tasks & event...');
  await seedTasks();
  await seedEvent();
  await seedLeaderboard();
  await seedAccessCodes();

  console.info('\n🌱 Seeding Auth users...');
  await seedAuthUsers();

  console.info('\n🌱 Seeding team profiles & game states...');

  // Team A — just logged in
  await seedTeam(
    TEAMS.A,
    ['David Ben-Ami', 'Rachel Goldberg', 'Noam Fischer'],
    'active',
    2,         // started 2 min ago
    gameStateA,
  );

  // Team B — mid-race, 1 green done
  await seedTeam(
    TEAMS.B,
    ['Tamar Shapiro', 'Yonatan Mizrahi', 'Liora Cohen', 'Eitan Peretz'],
    'active',
    45,        // started 45 min ago
    gameStateB,
  );

  // Team C — in the park, pending judge check-in
  await seedTeam(
    TEAMS.C,
    ['Shira Levi', 'Avi Katz', 'Maya Friedman', 'Roi Ben-David', 'Noa Stern'],
    'park',
    100,       // started 100 min ago
    gameStateC,
    checkInC,  // ← shows up in Judge Panel as 'pending'
  );

  // Team D — finished, judge score applied
  await seedTeam(
    TEAMS.D,
    ['Uri Avraham', 'Yael Cohen', 'Gal Levy', 'Nir Greenberg'],
    'finished',
    95,        // started 95 min ago
    gameStateD,
    checkInD,  // ← approved, judgeScore: 82
    5,         // finished 5 min ago
  );

  console.info('\n╔══════════════════════════════════════════════╗');
  console.info('║  ✅  Seed complete!                          ║');
  console.info('╚══════════════════════════════════════════════╝');
  console.info(`\n  Firestore UI  → http://localhost:4000/firestore`);
  console.info(`  Path root     → artifacts/${APP_ID}/`);
  console.info('\n  Teams seeded:');
  console.info(`    ${TEAMS.A.code}  ${TEAMS.A.name.padEnd(22)} → slot 0 active, 0 pts`);
  console.info(`    ${TEAMS.B.code}  ${TEAMS.B.name.padEnd(22)} → slot 1 active, 100 pts`);
  console.info(`    ${TEAMS.C.code}  ${TEAMS.C.name.padEnd(22)} → park, pending judge check-in, 550 pts`);
  console.info(`    ${TEAMS.D.code}  ${TEAMS.D.name.padEnd(22)} → finished, judge scored (82), 2104 pts\n`);
  console.info('  Unclaimed access codes (for registration flow):');
  console.info(`    ${ACCESS_CODES.join('   ')}\n`);
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err);
  process.exit(1);
});
