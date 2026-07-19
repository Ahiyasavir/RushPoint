// WO Fix 1 — atomic complete-and-release, deterministic emulator integration test.
//
// completeTaskForTeam is an INTERNAL helper (not a callable), so the callable-only
// e2e suite can't reach it directly. This test imports the built internal and calls
// it once against the emulator, then asserts the station-occupancy slot was released
// IN THE SAME transaction as the completion — i.e. run.taskCounts is already
// decremented the instant the call returns, with NO follow-up releaseTask.
//
// RED before the fix (the caller, not completeTaskForTeam, used to decrement, so the
// counter was still 1 here); GREEN once the release is folded into the txn.
//
// Requires the emulator running + functions built (functions/lib). Run under the
// emulator gate:  node scripts/test-atomic-release.mjs
//
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PROJECT = 'rushpoint-pwa-7daaa';
process.env.GCLOUD_PROJECT ??= PROJECT;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

// Import the BUILT functions lib. Importing it initializes the default Admin app
// (functions/src/firebase.ts), so we reuse that same default app for seeding — the
// exact Firestore instance completeTaskForTeam writes to.
const libPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'functions', 'lib', 'runs', 'index.js')
  .replace(/\\/g, '/');
const { completeTaskForTeam } = await import(libPath);
const adminSdk = (await import('firebase-admin')).default;
const db = adminSdk.firestore();

let failures = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}${detail != null ? ' :: ' + detail : ''}`);
  }
}

const gamePath = (o, g) => `users/${o}/games/${g}`;
const runPath = (o, g, r) => `users/${o}/games/${g}/runs/${r}`;
const teamPath = (o, g, r, t) => `users/${o}/games/${g}/runs/${r}/teams/${t}`;

async function readCounts(o, g, r) {
  const snap = await db.doc(runPath(o, g, r)).get();
  return snap.data()?.taskCounts ?? {};
}

const OWNER = 'atomic-owner';
const now = new Date().toISOString();

// ── Case 1: a single completed task releases its own slot atomically ──────────
{
  const gameId = `atomic-g1-${Date.now()}`;
  const runId = 'r1';
  const teamId = 'team1';

  await db.doc(gamePath(OWNER, gameId)).set({
    id: gameId, title: 'Atomic G1', mode: 'individual', scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 's0', order: 0, title: 'S0',
      tasks: [{ id: 'taskX', title: 'X', type: 'field', coordinates: { lat: 0, lng: 0 },
        difficulty: 3, estimatedMinutes: 5, expectedDurationMinutes: 5, pointValue: 50, maxConcurrentTeams: 3 }],
    }],
  });
  await db.doc(runPath(OWNER, gameId, runId)).set({
    ownerUid: OWNER, gameId, status: 'active', launchedAt: now, taskCounts: { taskX: 1 },
  });
  await db.doc(teamPath(OWNER, gameId, runId, teamId)).set({
    id: teamId, displayName: teamId, launched: true, status: 'active',
    activeTaskId: 'taskX', startedAt: now, score: 0, bonusPenalty: 0,
    stages: [{ stageId: 's0', status: 'active',
      tasks: [{ taskId: 'taskX', taskIndex: 0, status: 'assigned', startedAt: now }] }],
  });

  const result = await completeTaskForTeam(OWNER, gameId, runId, teamId, 'taskX', new Date().toISOString());
  check('case1: completeTaskForTeam reports completed', result?.completed === true, JSON.stringify(result));
  check('case1: completeTaskForTeam reports heldSlot', result?.heldSlot === true, JSON.stringify(result));

  const counts = await readCounts(OWNER, gameId, runId);
  check('case1: run.taskCounts.taskX === 0 immediately after the call (no follow-up release)',
    counts.taskX === 0, `taskX=${counts.taskX}`);
}

// ── Case 2: partial-stage auto-skip releases the skipped assigned slot too ─────
{
  const gameId = `atomic-g2-${Date.now()}`;
  const runId = 'r2';
  const teamId = 'team2';

  await db.doc(gamePath(OWNER, gameId)).set({
    id: gameId, title: 'Atomic G2', mode: 'individual', scoringPreset: 'fixed_points_speed',
    stages: [{
      id: 's0', order: 0, title: 'S0', isFinal: true,
      tasks: [
        { id: 'taskX', title: 'X', type: 'field', coordinates: { lat: 0, lng: 0 },
          difficulty: 3, estimatedMinutes: 5, expectedDurationMinutes: 5, pointValue: 50, maxConcurrentTeams: 3 },
        { id: 'taskY', title: 'Y', type: 'field', coordinates: { lat: 0, lng: 0 },
          difficulty: 3, estimatedMinutes: 5, expectedDurationMinutes: 5, pointValue: 50, maxConcurrentTeams: 3 },
      ],
    }],
  });
  await db.doc(runPath(OWNER, gameId, runId)).set({
    ownerUid: OWNER, gameId, status: 'active', launchedAt: now, taskCounts: { taskX: 1, taskY: 1 },
  });
  await db.doc(teamPath(OWNER, gameId, runId, teamId)).set({
    id: teamId, displayName: teamId, launched: true, status: 'active',
    activeTaskId: 'taskX', startedAt: now, score: 0, bonusPenalty: 0,
    stages: [{ stageId: 's0', status: 'active', requiredTaskCount: 1,
      tasks: [
        { taskId: 'taskX', taskIndex: 0, status: 'assigned', startedAt: now },
        { taskId: 'taskY', taskIndex: 1, status: 'assigned', startedAt: now },
      ] }],
  });

  const result = await completeTaskForTeam(OWNER, gameId, runId, teamId, 'taskX', new Date().toISOString());
  check('case2: completeTaskForTeam reports completed', result?.completed === true, JSON.stringify(result));

  const counts = await readCounts(OWNER, gameId, runId);
  check('case2: completed slot released atomically (taskX === 0)', counts.taskX === 0, `taskX=${counts.taskX}`);
  check('case2: auto-skipped assigned slot released atomically (taskY === 0)', counts.taskY === 0, `taskY=${counts.taskY}`);
}

console.log(failures === 0 ? '\n✅ ALL ATOMIC-RELEASE TESTS PASSED' : `\n❌ ${failures} ATOMIC-RELEASE ASSERTION(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
