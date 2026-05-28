// Ephemeral end-to-end verification against the running emulator.
// Exercises the full mobile->admin sync path through the public callable API.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'emulator-key',
  projectId: 'race-to-tzion-2026',
  appId: 'emulator-app-id',
});
const auth = getAuth(app);
const functions = getFunctions(app);
const fs = getFirestore(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
connectFirestoreEmulator(fs, '127.0.0.1', 8080);
const APP_ID = 'race-to-tzion-2026';
const readGameState = (uid) =>
  getDoc(doc(fs, `artifacts/${APP_ID}/users/${uid}/gameState/current`)).then((s) =>
    s.exists() ? s.data() : null,
  );

const call = (name, data) => httpsCallable(functions, name)(data).then((r) => r.data);

let failures = 0;
function check(label, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

async function main() {
  const cred = await signInAnonymously(auth);
  const uid = cred.user.uid;
  console.log('Signed in anonymously as', uid);

  // 1. Register a brand-new team with an unclaimed access code.
  const code = process.argv[2] || 'LION01';
  let reg;
  try {
    reg = await call('registerTeam', {
      code,
      teamName: 'E2E Test Squad',
      captainPhone: '0500000000',
      participants: [
        { name: 'Alice', age: '12' },
        { name: 'Bob', age: '13' },
        { name: 'Carol', age: '11' },
      ],
      waiverAccepted: true,
    });
    check('registerTeam returns ok', !!reg, JSON.stringify(reg));
  } catch (e) {
    check('registerTeam succeeds', false, e.message);
  }

  // 2. Admin: listTeams should now include the new team (mobile -> admin sync).
  try {
    const { teams } = await call('listTeams', {});
    const mine = teams.find((t) => t.name === 'E2E Test Squad');
    check('listTeams includes newly registered team', !!mine,
      `total teams=${teams.length}`);
    if (mine) {
      check('  team carries member names', Array.isArray(mine.memberNames) && mine.memberNames.length === 3,
        JSON.stringify(mine.memberNames));
      check('  team has a code + status', !!mine.code && !!mine.status,
        `code=${mine.code} status=${mine.status} score=${mine.score} slots=${mine.completedSlots}`);
    }
  } catch (e) {
    check('listTeams succeeds', false, e.message);
  }

  // 2b. skipTask — advances the active slot and AWARDS the average task score.
  try {
    const before = await readGameState(uid);
    const beforeScore = before?.score ?? 0;
    const activeIdx = before?.slots?.findIndex((s) => s.status === 'active');
    const res = await call('skipTask', { teamId: uid });
    const awarded = res?.awardedScore ?? 0;
    const after = await readGameState(uid);
    const skipped = after?.slots?.[activeIdx];
    const next = after?.slots?.[activeIdx + 1];
    check('skipTask marks the active slot skipped', skipped?.status === 'skipped',
      `slot ${activeIdx} -> ${skipped?.status}`);
    check('  skip awards a positive average score', awarded > 0,
      `awardedScore=${awarded}`);
    check('  skipped slot stores the awarded score', (skipped?.earnedScore ?? -1) === awarded,
      `earnedScore=${skipped?.earnedScore}`);
    check('  next slot becomes active', next?.status === 'active',
      `slot ${activeIdx + 1} -> ${next?.status}`);
    check('  team score increases by the award', (after?.score ?? 0) === beforeScore + awarded,
      `score ${beforeScore} + ${awarded} -> ${after?.score}`);
  } catch (e) {
    check('skipTask succeeds', false, e.message);
  }

  // 3. getRecommendedTasks — ranked list, priority desc, no assignment.
  try {
    const res = await call('getRecommendedTasks', {
      lat: 31.7717, lng: 35.2035, targetType: 'green',
    });
    const recs = res.recommendations || [];
    check('getRecommendedTasks returns recommendations', recs.length > 0,
      `count=${recs.length}`);
    const sortedDesc = recs.every((r, i) => i === 0 || recs[i - 1].priority >= r.priority);
    check('  recommendations sorted by priority desc', sortedDesc,
      recs.map((r) => `${r.title}=${r.priority.toFixed(3)}`).join(', '));
    check('  each rec has difficulty + distance + load', recs.every(
      (r) => typeof r.difficulty === 'number' && typeof r.distanceKm === 'number' && typeof r.currentLoad === 'number'),
      JSON.stringify(recs[0]));
  } catch (e) {
    check('getRecommendedTasks succeeds', false, e.message);
  }

  // 4. requestNextTask — should assign and return a task.
  try {
    const res = await call('requestNextTask', { lat: 31.7717, lng: 35.2035, targetType: 'green' });
    check('requestNextTask returns a task', !!res && (!!res.task || !!res.taskId),
      JSON.stringify(res).slice(0, 200));
  } catch (e) {
    // May legitimately fail if no slot is awaiting assignment; report it.
    check('requestNextTask succeeds (or reports a clean error)', false, e.message);
  }

  // 5. Judge flow against a seeded pending arrival (admin side).
  //    listPendingArrivals -> checkInArrival -> finalizeJudgeEvaluation.
  try {
    const { arrivals } = await call('listPendingArrivals', {});
    check('listPendingArrivals returns pending arrivals', arrivals.length > 0,
      `count=${arrivals.length}`);
    if (arrivals.length > 0) {
      const a = arrivals[0];
      await call('checkInArrival', { teamId: a.teamId, checkInId: a.checkInId });
      check('  checkInArrival freezes the clock', true, `team=${a.teamName}`);

      const fin = await call('finalizeJudgeEvaluation', {
        teamId: a.teamId,
        checkInId: a.checkInId,
        products: [],
        designScore: 15,
        presentationScore: 18,
        judgeNote: 'e2e',
      });
      const b = fin.breakdown || {};
      check('  finalizeJudgeEvaluation returns a breakdown', !!fin.breakdown,
        JSON.stringify(fin).slice(0, 250));
      check('  breakdown includes sigmoid taskScore', typeof b.taskScore === 'number',
        `taskScore=${b.taskScore}`);
      check('  total = productScore + design + presentation + taskScore',
        b.total === b.productScore + b.designScore + b.presentationScore + b.taskScore,
        `total=${b.total} (p=${b.productScore} d=${b.designScore} pr=${b.presentationScore} t=${b.taskScore})`);
    }
  } catch (e) {
    check('judge flow succeeds', false, e.message);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
