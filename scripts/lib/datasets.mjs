// ─────────────────────────────────────────────────────────────────────────────
// DATASET REGISTRY — the single place that maps a data file/tab to Firestore.
//
// To add a new dataset to the app's backend:
//   1. add a `<name>.csv` under scripts/data/sheets/ (with a header row),
//   2. append one entry to DATASETS below.
// The sync (scripts/sync-sheets.mjs) does the rest, on every boot.
//
// Each entry is one of:
//   • collection  — one Firestore doc per CSV row at `${path}/${id}`.
//   • singleton   — the whole sheet collapses into one doc at `doc`.
//   • custom      — provide `apply(ctx, rows)` for anything bespoke (e.g. teams,
//                   which also create an auth user + gameState).
//
// `createOnly` fields are written only when a doc is NEW, so a re-sync never
// clobbers runtime state (live team counts, claimed codes, scores, progress).
// ─────────────────────────────────────────────────────────────────────────────

const APP_ID = process.env.RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';
export const pub      = (col) => `artifacts/${APP_ID}/public/data/${col}`;
export const priv     = (uid, col) => `artifacts/${APP_ID}/users/${uid}/${col}`;
export const codesCol = () => `artifacts/${APP_ID}/accessCodes`;

// ── Cell coercion ──────────────────────────────────────────────────────────────
const str  = (v) => (v == null ? '' : String(v).trim());
const num  = (v, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
const bool = (v) => str(v).toLowerCase() === 'true';
const nowIso  = () => new Date().toISOString();
const minsAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

// ── Demo gameState templates (used by the `teams` dataset, seed-if-absent) ──────
const slot = (index, type, status, extra = {}) => ({ index, type, status, ...extra });

function gameStateFor(state, uid) {
  const base = { teamId: uid, bonusPenalty: 0, judging: null, updatedAt: nowIso() };
  switch (state) {
    case 'midway':
      return { ...base, score: 100, currentTaskId: 'task-green-002', slots: [
        slot(0, 'green', 'completed', { taskId: 'task-green-001', taskTitle: 'Jerusalem Landmarks Photo Hunt', completedAt: minsAgo(30) }),
        slot(1, 'green', 'active', { startedAt: minsAgo(5) }),
        slot(2, 'green', 'locked'), slot(3, 'gate', 'locked'), slot(4, 'orange', 'locked'), slot(5, 'gold', 'locked'),
      ] };
    case 'park':
      return { ...base, score: 450, currentTaskId: 'task-gold-001', slots: [
        slot(0, 'green', 'completed', { taskId: 'task-green-001', taskTitle: 'Jerusalem Landmarks Photo Hunt', completedAt: minsAgo(90) }),
        slot(1, 'green', 'completed', { taskId: 'task-green-002', taskTitle: 'Blindfolded Trust Relay', completedAt: minsAgo(75) }),
        slot(2, 'green', 'completed', { taskId: 'task-green-003', taskTitle: 'Bible Trivia Blitz', completedAt: minsAgo(58) }),
        slot(3, 'gate', 'completed', { taskId: '', taskTitle: 'Matchmaking Duel', completedAt: minsAgo(44) }),
        slot(4, 'orange', 'completed', { taskId: 'task-orange-001', taskTitle: 'Find Your Tene in the Bible Park', completedAt: minsAgo(25) }),
        slot(5, 'gold', 'active', { startedAt: minsAgo(8) }),
      ] };
    case 'finished':
      return { ...base, score: 2104, currentTaskId: null, slots: [
        slot(0, 'green', 'completed', { taskId: 'task-green-001', taskTitle: 'Jerusalem Landmarks Photo Hunt', completedAt: minsAgo(85) }),
        slot(1, 'green', 'completed', { taskId: 'task-green-002', taskTitle: 'Blindfolded Trust Relay', completedAt: minsAgo(70) }),
        slot(2, 'green', 'completed', { taskId: 'task-green-003', taskTitle: 'Bible Trivia Blitz', completedAt: minsAgo(55) }),
        slot(3, 'gate', 'completed', { taskId: '', taskTitle: 'Matchmaking Duel', completedAt: minsAgo(43) }),
        slot(4, 'orange', 'completed', { taskId: 'task-orange-001', taskTitle: 'Find Your Tene in the Bible Park', completedAt: minsAgo(30) }),
        slot(5, 'gold', 'completed', { taskId: 'task-gold-001', taskTitle: 'Ancient Grape Press', completedAt: minsAgo(22) }),
      ] };
    default: // 'start'
      return { ...base, score: 0, currentTaskId: 'task-green-001', slots: [
        slot(0, 'green', 'active', { startedAt: minsAgo(2), taskId: 'task-green-001', taskTitle: 'Jerusalem Landmarks Photo Hunt' }),
        slot(1, 'green', 'locked'), slot(2, 'green', 'locked'), slot(3, 'gate', 'locked'), slot(4, 'orange', 'locked'), slot(5, 'gold', 'locked'),
      ] };
  }
}

const profileStatusFor = (state) => (state === 'park' ? 'park' : state === 'finished' ? 'finished' : 'active');

async function ensureAuthUser(auth, uid, displayName) {
  try {
    await auth.createUser({ uid, email: `${uid}@rushpoint.dev`, password: 'test1234', displayName });
  } catch (e) {
    const code = e?.errorInfo?.code ?? e?.code;
    if (code !== 'auth/uid-already-exists' && code !== 'auth/email-already-exists') throw e;
  }
}

// ── The registry ────────────────────────────────────────────────────────────────
export const DATASETS = [
  {
    name: 'tasks',
    tab: 'tasks',
    kind: 'collection',
    path: pub('tasks'),
    createOnly: ['currentTeamCount', 'qrCode'], // preserve live load counter
    toDoc(r) {
      const id = str(r.id);
      const type = r.type === 'gold' ? 'gold' : r.type === 'orange' ? 'orange' : 'green';
      return { id, data: {
        id, type,
        title: str(r.title), titleHe: str(r.titleHe),
        description: str(r.description), descriptionHe: str(r.descriptionHe),
        coordinates: { lat: num(r.lat), lng: num(r.lng) },
        locationHint: str(r.locationHint),
        difficulty: num(r.difficulty, 5),
        pointValue: num(r.pointValue, 100),
        estimatedMinutes: num(r.estimatedMinutes, 15),
        maxConcurrentTeams: num(r.maxConcurrentTeams, 3),
        maxDurationMinutes: num(r.maxDurationMinutes, 30),
        photoRequired: bool(r.photoRequired),
        isActive: str(r.status) !== 'inactive',
        status: ['active', 'paused', 'closed'].includes(str(r.status)) ? str(r.status) : 'active',
        currentTeamCount: 0,
        qrCode: `QR-${id}`,
      } };
    },
  },
  {
    name: 'basketZones',
    tab: 'basketZones',
    kind: 'collection',
    path: pub('basketZones'),
    createOnly: ['currentTeamCount'],
    toDoc(r) {
      const id = str(r.id);
      return { id, data: {
        id, name: str(r.name), nameHe: str(r.nameHe),
        riddle: str(r.riddle), riddleHe: str(r.riddleHe),
        coordinates: { lat: num(r.lat), lng: num(r.lng) },
        maxTeams: num(r.maxTeams, 3),
        currentTeamCount: 0,
      } };
    },
  },
  {
    name: 'accessCodes',
    tab: 'accessCodes',
    kind: 'collection',
    path: codesCol(),
    createOnly: ['claimed', 'teamId', 'createdAt'], // never un-claim a used code
    toDoc(r) {
      const code = str(r.code);
      return { id: code, data: {
        code, claimed: false, teamId: null, createdAt: nowIso(), note: str(r.note),
      } };
    },
  },
  {
    name: 'raceConfig',
    tab: 'raceConfig',
    kind: 'singleton',
    doc: `${pub('raceConfig')}/current`,
    fromRows(rows) {
      const r = rows[0] ?? {};
      return {
        start:  { lat: num(r.startLat, 31.7905), lng: num(r.startLng, 35.164) },
        finish: { lat: num(r.finishLat, 31.8155), lng: num(r.finishLng, 35.1875) },
        gate:   { lat: num(r.gateLat, 31.811), lng: num(r.gateLng, 35.184) },
        center: { lat: num(r.centerLat, 31.803), lng: num(r.centerLng, 35.176) },
        zoom:   num(r.zoom, 13.5),
        routeWaypoints: [{ lat: num(r.gateLat, 31.811), lng: num(r.gateLng, 35.184) }],
        updatedAt: nowIso(),
      };
    },
  },
  {
    name: 'teams',
    tab: 'teams',
    kind: 'custom',
    async apply(ctx, rows) {
      const { db, auth } = ctx;
      for (const r of rows) {
        const uid = str(r.uid);
        if (!uid) continue;
        const code = str(r.code);
        const members = str(r.members).split('|').map((s) => s.trim()).filter(Boolean);

        await ensureAuthUser(auth, uid, str(r.name));

        // Profile identity/config — upsert; create with status+timestamps if new.
        const profRef = db.doc(`${priv(uid, 'profile')}/team`);
        const identity = {
          id: uid, name: str(r.name), code,
          captainPhone: str(r.captainPhone), memberNames: members,
          participants: members.map((n) => ({ name: n, age: '' })),
          waiverAccepted: true,
        };
        if ((await profRef.get()).exists) {
          await profRef.set(identity, { merge: true });
        } else {
          await profRef.set({ ...identity, status: profileStatusFor(str(r.state)), createdAt: nowIso(), startedAt: nowIso() });
        }

        // The team's own code is claimed by them.
        if (code) {
          await db.doc(`${codesCol()}/${code}`).set(
            { code, claimed: true, teamId: uid, createdAt: nowIso() }, { merge: true });
        }

        // gameState + demo check-in: seed only if absent (never overwrite progress).
        const gsRef = db.doc(`${priv(uid, 'gameState')}/current`);
        if (!(await gsRef.get()).exists) await gsRef.set(gameStateFor(str(r.state), uid));

        if (str(r.state) === 'park') {
          const ciRef = db.doc(`${priv(uid, 'checkIns')}/checkin-${uid}-gold`);
          if (!(await ciRef.get()).exists) {
            await ciRef.set({
              id: `checkin-${uid}-gold`, teamId: uid, taskId: 'task-gold-001',
              timestamp: minsAgo(3), status: 'pending', location: { lat: 31.8155, lng: 35.1875 },
            });
          }
        }
      }
      return rows.length;
    },
  },
];
