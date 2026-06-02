import admin from 'firebase-admin';

const PROJECT_ID = 'rushpoint-pwa-7daaa';
const APP_ID     = 'rushpoint-pwa-7daaa';

process.env.FIRESTORE_EMULATOR_HOST     ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

admin.initializeApp({ projectId: PROJECT_ID });
const db   = admin.firestore();
const auth = admin.auth();

const codesPath = `artifacts/${APP_ID}/accessCodes`;
const tasksPath = `artifacts/${APP_ID}/public/data/tasks`;
const lbPath    = `artifacts/${APP_ID}/public/data/leaderboard/current`;
const userPath  = (uid) => `artifacts/${APP_ID}/users/${uid}`;

const DEMO_UID   = 'demo-team-lions';
const CHECKIN_ID = 'checkin-demo-lions-gold-001';

async function ensureUser(uid, email, displayName) {
  try {
    await auth.createUser({ uid, email, password: 'test1234', displayName });
    console.log(`[seed-local] Created auth user ${uid}`);
  } catch (e) {
    const code = e?.errorInfo?.code ?? e?.code;
    if (code === 'auth/uid-already-exists' || code === 'auth/email-already-exists') {
      console.log(`[seed-local] Auth user ${uid} already exists - skipped.`);
    } else { throw e; }
  }
}

async function main() {
  const existing = await db.collection(codesPath).limit(1).get();
  if (!existing.empty) {
    console.log('[seed-local] Data already present - skipping seed.');
    return;
  }
  console.log('[seed-local] Empty database detected - seeding demo data...');

  const now     = new Date().toISOString();
  const minsAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

  // Tasks (green = mobile mission 01; gold = the basket the judge grades).
  await db.doc(`${tasksPath}/task-green-001`).set({
    id: 'task-green-001', title: 'Jerusalem Landmarks Photo Hunt',
    description: 'Photograph all 5 specified Jerusalem landmarks as a team.',
    type: 'green', qrCode: 'QR-GREEN-001', maxConcurrentTeams: 3, currentTeamCount: 0,
    difficulty: 3, photoRequired: true, pointValue: 100, estimatedMinutes: 15, isActive: true,
    status: 'active', maxDurationMinutes: 30, coordinates: { lat: 31.797, lng: 35.172 },
  });
  await db.doc(`${tasksPath}/task-green-002`).set({
    id: 'task-green-002', title: 'Blindfolded Trust Relay', titleHe: 'ריצת השליחות בעיניים עצומות',
    description: 'Guide a blindfolded teammate through a short course using only your voices.',
    type: 'green', qrCode: 'QR-GREEN-002', maxConcurrentTeams: 3, currentTeamCount: 0,
    difficulty: 5, photoRequired: true, pointValue: 100, estimatedMinutes: 20, isActive: true,
    status: 'active', maxDurationMinutes: 40, coordinates: { lat: 31.801, lng: 35.18 },
  });
  await db.doc(`${tasksPath}/task-green-003`).set({
    id: 'task-green-003', title: 'Bible Trivia Blitz', titleHe: 'חידון תנ"ך ירושלמי',
    description: 'Answer 10 Jerusalem-themed Bible trivia questions together.',
    type: 'green', qrCode: 'QR-GREEN-003', maxConcurrentTeams: 4, currentTeamCount: 0,
    difficulty: 4, photoRequired: false, pointValue: 100, estimatedMinutes: 12, isActive: true,
    status: 'active', maxDurationMinutes: 24, coordinates: { lat: 31.805, lng: 35.186 },
  });
  await db.doc(`${tasksPath}/task-gold-001`).set({
    id: 'task-gold-001', title: 'Ancient Grape Press',
    description: 'Use the replica press to fill and seal a clay flask for your Tene.',
    type: 'gold', qrCode: 'QR-GOLD-001', maxConcurrentTeams: 2, currentTeamCount: 1,
    difficulty: 8, photoRequired: true, pointValue: 200, estimatedMinutes: 20, isActive: true,
    status: 'active', maxDurationMinutes: 40, coordinates: { lat: 31.808885, lng: 35.193833 },
  });
  console.log('[seed-local] Seeded tasks: task-green-001/002/003, task-gold-001');

  // Race config (editable in the admin Race Builder; defaults match @rushpoint/shared).
  await db.doc(`artifacts/${APP_ID}/public/data/raceConfig/current`).set({
    start:  { lat: 31.79326,   lng: 35.165684 },  // Motza
    finish: { lat: 31.808885,  lng: 35.193833 },  // Gan HaKipod
    gate:   { lat: 31.807,     lng: 35.189 },
    center: { lat: 31.8011,    lng: 35.1798 },
    zoom:   13.5,
    routeWaypoints: [
      { lat: 31.797,    lng: 35.172    },
      { lat: 31.801,    lng: 35.18     },
      { lat: 31.805,    lng: 35.186    },
      { lat: 31.807,    lng: 35.189    },
      { lat: 31.808361, lng: 35.191167 },  // Bible Park (gat)
    ],
    updatedAt: now,
  });

  // Orange "find the Tene" basket zones, placed in-area near the orange stage.
  const zonesPath = `artifacts/${APP_ID}/public/data/basketZones`;
  await db.doc(`${zonesPath}/zone-a`).set({
    id: 'zone-a', name: 'Arazim Lookout', nameHe: 'מצפה ארזים',
    riddle: 'Where the valley opens to the hills, find your Tene by the lookout stones.',
    riddleHe: 'במקום שהעמק נפתח אל ההרים — מצאו את הטנא ליד אבני התצפית.',
    coordinates: { lat: 31.808361, lng: 35.191167 }, currentTeamCount: 0, maxTeams: 3,
  });
  await db.doc(`${zonesPath}/zone-b`).set({
    id: 'zone-b', name: 'Pine Grove', nameHe: 'חורשת האורנים',
    riddle: 'Under the pines on the climb to Ramot, your basket waits in the shade.',
    riddleHe: 'בין האורנים בעלייה לרמות — הסל מחכה בצל.',
    coordinates: { lat: 31.80857, lng: 35.19265 }, currentTeamCount: 0, maxTeams: 3,
  });
  console.log('[seed-local] Seeded raceConfig + basket zones (zone-a, zone-b).');

  // Access codes for the mobile registration flow.
  const codes = ['1234', 'LION01', 'BEAR02', 'WOLF03'];
  const cb = db.batch();
  for (const code of codes) cb.set(db.doc(`${codesPath}/${code}`), { code, claimed: false, teamId: null, createdAt: now });
  await cb.commit();
  console.log(`[seed-local] Seeded access codes: ${codes.join(', ')}`);

  await ensureUser('test-user', 'test@rushpoint.dev', 'Test User');

  // Complete demo team for the Admin Check-in / Judge panel.
  await ensureUser(DEMO_UID, 'lions@rushpoint.dev', 'The Lions');

  const done       = (i, type, taskId, taskTitle, mins) => ({ index: i, type, status: 'completed', taskId, taskTitle, completedAt: minsAgo(mins) });
  const goldActive = (i) => ({ index: i, type: 'gold', status: 'active', startedAt: minsAgo(8), taskId: 'task-gold-001', taskTitle: 'Ancient Grape Press' });

  await db.doc(`${userPath(DEMO_UID)}/profile/team`).set({
    id: DEMO_UID, name: 'The Lions', code: 'LION1', captainPhone: '+972-50-555-1234',
    participants: [{ name: 'Ari', age: '12' }, { name: 'Maya', age: '11' }],
    memberNames: ['Ari', 'Maya'], waiverAccepted: true, status: 'park',
    createdAt: minsAgo(100), startedAt: minsAgo(95),
  });

  // 6-slot layout: 3×green → gate (matchmaking) → orange (find Tene) → gold (craft+judge)
  await db.doc(`${userPath(DEMO_UID)}/gameState/current`).set({
    teamId: DEMO_UID, score: 550, bonusPenalty: 0, currentTaskId: 'task-gold-001',
    judging: null, updatedAt: now,
    slots: [
      done(0, 'green', 'task-green-001', 'Jerusalem Landmarks Photo Hunt', 80),
      done(1, 'green', 'task-green-002', 'Blindfolded Trust Relay', 70),
      done(2, 'green', 'task-green-003', 'Bible Trivia Blitz', 60),
      done(3, 'gate',   null, 'Matchmaking Duel', 30),
      done(4, 'orange', 'task-orange-001', 'Find Your Tene', 20),
      goldActive(5),
    ],
  });

  // The PENDING check-in is what makes the team appear in listPendingArrivals.
  await db.doc(`${userPath(DEMO_UID)}/checkIns/${CHECKIN_ID}`).set({
    id: CHECKIN_ID, teamId: DEMO_UID, taskId: 'task-gold-001',
    status: 'pending', timestamp: minsAgo(3), location: { lat: 31.808885, lng: 35.193833 },
  });
  console.log('[seed-local] Seeded demo team "The Lions" (LION1) with a PENDING check-in.');

  await db.doc(lbPath).set({
    eventId: 'current', frozen: false, updatedAt: now,
    rankings: [{ rank: 1, teamId: DEMO_UID, teamName: 'The Lions', score: 550, completedSlots: 5 }],
  });
  console.log('[seed-local] Seeded leaderboard. Done.');
}

main().catch((err) => { console.error('[seed-local] Seed failed:', err); process.exit(1); });