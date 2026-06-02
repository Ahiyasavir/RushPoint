/**
 * RushPoint — Reset & re-seed 30 fresh teams
 *
 * Wipes EVERY team (the 4 mock teams, any admin-created teams, and any teams
 * registered live from the mobile app — found via collectionGroup), clears the
 * transient runtime collections (matchmaking, alerts, locations, leaderboard),
 * then creates 30 brand-new teams each with:
 *   • a distinct, human-friendly access code (TZN-001 … TZN-030)
 *   • a real Auth identity (uid)
 *   • a seeded gameState (slot 0 active — load-balancing happens at run time)
 *   • a claimed accessCodes/{code} doc
 *
 * Run (emulator must be up — `npm run dev:all` or `npm run emulator`):
 *   node scripts/reset-teams.mjs            # 30 teams (default)
 *   node scripts/reset-teams.mjs --count=20 # custom count
 *   node scripts/reset-teams.mjs --keep     # keep existing teams, just add 30
 *
 * Stop the emulator with Ctrl+C afterwards so --export-on-exit persists the data.
 */

import admin from 'firebase-admin';

// ─── Emulator connection (127.0.0.1 — not localhost; Windows IPv6 mismatch) ────
process.env.FIRESTORE_EMULATOR_HOST     ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

const APP_ID     = process.env.RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';
const PROJECT_ID = process.env.GCLOUD_PROJECT   ?? 'rushpoint-pwa-7daaa';

admin.initializeApp({ projectId: PROJECT_ID });
const db   = admin.firestore();
const auth = admin.auth();

// ─── Args ──────────────────────────────────────────────────────────────────────
const args  = process.argv.slice(2);
const COUNT = Number((args.find((a) => a.startsWith('--count=')) ?? '').split('=')[1]) || 30;
const KEEP  = args.includes('--keep');

// ─── Path helpers ───────────────────────────────────────────────────────────────
const pub     = (col) => `artifacts/${APP_ID}/public/data/${col}`;
const userDoc = (uid, col, id) => `artifacts/${APP_ID}/users/${uid}/${col}/${id}`;
const userCol = (uid, col) => `artifacts/${APP_ID}/users/${uid}/${col}`;
const codeDoc = (code) => `artifacts/${APP_ID}/accessCodes/${code}`;

const nowIso = () => new Date().toISOString();

// ─── Hebrew/English team name pool (cycled + numbered past 30) ──────────────────
const NAME_POOL = [
  'Lions', 'Eagles', 'Wolves', 'Foxes', 'Bears', 'Hawks', 'Panthers', 'Tigers',
  'Falcons', 'Cobras', 'Jaguars', 'Ravens', 'Stallions', 'Vipers', 'Dragons',
  'Phoenix', 'Scorpions', 'Sharks', 'Rhinos', 'Cheetahs', 'Griffins', 'Bulls',
  'Owls', 'Pumas', 'Lynx', 'Bisons', 'Cougars', 'Coyotes', 'Mustangs', 'Titans',
];

function teamName(i) {
  const base = NAME_POOL[i % NAME_POOL.length];
  const suffix = i >= NAME_POOL.length ? ` ${Math.floor(i / NAME_POOL.length) + 1}` : '';
  return `The ${base}${suffix}`;
}

/** Distinct, ordered access code: TZN-001 … TZN-030. */
function teamCode(i) {
  return `TZN-${String(i + 1).padStart(3, '0')}`;
}

// Initial 6-slot board: slot 0 active + unassigned (routing assigns at run time),
// matching functions/src/index.ts buildInitialSlots().
function buildInitialSlots(iso) {
  return [
    { index: 0, type: 'green',  status: 'active', startedAt: iso },
    { index: 1, type: 'green',  status: 'locked' },
    { index: 2, type: 'green',  status: 'locked' },
    { index: 3, type: 'gate',   status: 'locked' },
    { index: 4, type: 'orange', status: 'locked' },
    { index: 5, type: 'gold',   status: 'locked' },
  ];
}

// ─── Wipe every existing team ───────────────────────────────────────────────────
async function deleteDocAndSubcollections(docRef) {
  const subs = await docRef.listCollections();
  for (const sub of subs) {
    const snap = await sub.get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
  }
  await docRef.delete().catch(() => {});
}

async function wipeAllTeams() {
  console.info('🔥 Wiping all existing teams…');

  // Find every team via the profile collectionGroup (covers mock + admin + live).
  const profiles = await db.collectionGroup('profile').get();
  const teamUids = new Set();
  for (const doc of profiles.docs) {
    if (doc.id !== 'team') continue;
    const parts = doc.ref.path.split('/');
    teamUids.add(parts[parts.indexOf('users') + 1]);
  }

  for (const uid of teamUids) {
    // Delete all known private sub-collections.
    for (const col of ['profile', 'gameState', 'checkIns', 'assignments']) {
      const snap = await db.collection(userCol(uid, col)).get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
    // Public traces keyed by uid.
    await db.doc(pub(`teamLocations/${uid}`)).delete().catch(() => {});
    await db.doc(pub(`matchQueue/${uid}`)).delete().catch(() => {});
    // Auth identity.
    await auth.deleteUser(uid).catch(() => {});
  }
  console.info(`  🗑  Removed ${teamUids.size} team(s)`);

  // Clear all access codes + transient runtime state so nothing leaks into the run.
  // (accessCodes lives at artifacts/{appId}/accessCodes — not under public/data.)
  await clearCollection(`artifacts/${APP_ID}/accessCodes`);
  for (const col of ['matchQueue', 'matches', 'adminAlerts', 'announcements', 'teamLocations', 'flashMissions']) {
    await clearCollection(pub(col));
  }
  // Reset leaderboard to empty.
  await db.doc(pub('leaderboard/current')).set(
    { eventId: 'current', frozen: false, rankings: [], updatedAt: nowIso() },
    { merge: false },
  );
  console.info('  🗑  Cleared access codes + matchmaking/alerts/locations + leaderboard');
}

async function clearCollection(path) {
  const snap = await db.collection(path).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// ─── Create N fresh teams ───────────────────────────────────────────────────────
async function createTeams(count) {
  console.info(`\n🌱 Creating ${count} fresh teams…`);
  const created = [];
  for (let i = 0; i < count; i++) {
    const name = teamName(i);
    const code = teamCode(i);
    const iso  = nowIso();

    const user = await auth.createUser({ displayName: name });
    const uid  = user.uid;

    const members = [`Captain ${i + 1}`, `Member ${i + 1}A`, `Member ${i + 1}B`, `Member ${i + 1}C`];

    const batch = db.batch();
    batch.set(db.doc(userDoc(uid, 'profile', 'team')), {
      id: uid,
      name,
      code,
      captainPhone: `05${String(20000000 + i).padStart(8, '0')}`,
      memberNames: members,
      participants: members.map((m) => ({ name: m, age: '16' })),
      waiverAccepted: true,
      status: 'registered',
      createdAt: iso,
    });
    batch.set(db.doc(userDoc(uid, 'gameState', 'current')), {
      teamId: uid,
      slots: buildInitialSlots(iso),
      score: 0,
      bonusPenalty: 0,
      updatedAt: iso,
    });
    batch.set(db.doc(codeDoc(code)), { code, claimed: true, teamId: uid, createdAt: iso });
    await batch.commit();

    created.push({ name, code, uid });
    if ((i + 1) % 10 === 0) console.info(`  …${i + 1}/${count}`);
  }
  return created;
}

// ─── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.info('\n╔══════════════════════════════════════════════╗');
  console.info('║   RushPoint — Reset & seed 30 fresh teams    ║');
  console.info('╚══════════════════════════════════════════════╝');
  console.info(`  App ID:    ${APP_ID}`);
  console.info(`  Firestore: ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.info(`  Count:     ${COUNT}   Mode: ${KEEP ? 'KEEP existing + add' : 'WIPE + reseed'}\n`);

  if (!KEEP) await wipeAllTeams();
  const teams = await createTeams(COUNT);

  console.info('\n✅ Done. Teams + access codes:');
  for (const t of teams) {
    console.info(`   ${t.code}   ${t.name}`);
  }
  console.info(`\n  ${teams.length} teams ready. Codes ${teams[0].code} … ${teams[teams.length - 1].code}.`);
  console.info('  ⚠️  Stop the emulator with Ctrl+C so --export-on-exit persists this data.\n');
}

main().catch((err) => {
  console.error('\n❌ reset-teams failed:', err);
  process.exit(1);
});
