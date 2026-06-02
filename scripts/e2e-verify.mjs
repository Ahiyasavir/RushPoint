// Ephemeral end-to-end verification against the running emulator.
// Exercises the full mobile->admin sync path through the public callable API.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, collection, getDocs } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'emulator-key',
  projectId: 'rushpoint-pwa-7daaa',
  appId: 'emulator-app-id',
});
const auth = getAuth(app);
const functions = getFunctions(app);
const fs = getFirestore(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
connectFirestoreEmulator(fs, '127.0.0.1', 8080);
const APP_ID = 'rushpoint-pwa-7daaa';
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
        { name: 'Dave', age: '12' },
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
      check('  team carries member names', Array.isArray(mine.memberNames) && mine.memberNames.length === 4,
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

    // 2c. A SECOND consecutive skip must ALSO award (bug: "255 once, then 0").
    const beforeScore2 = after?.score ?? 0;
    const activeIdx2 = after?.slots?.findIndex((s) => s.status === 'active');
    const res2 = await call('skipTask', { teamId: uid });
    const awarded2 = res2?.awardedScore ?? 0;
    const after2 = await readGameState(uid);
    check('  second consecutive skip ALSO awards points (not 0)', awarded2 > 0,
      `2nd awardedScore=${awarded2} (slot ${activeIdx2})`);
    check('  second skip adds its award to the score', (after2?.score ?? 0) === beforeScore2 + awarded2,
      `score ${beforeScore2} + ${awarded2} -> ${after2?.score}`);
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
        missingMembers: 1,
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
      check('  cohesion penalty recorded (1 missing = 100)', b.cohesionPenalty === 100,
        `cohesionPenalty=${b.cohesionPenalty} missingMembers=${b.missingMembers}`);
    }
  } catch (e) {
    check('judge flow succeeds', false, e.message);
  }

  // 6. Clue hint — increments bonusPenalty by 50 (server-authoritative).
  try {
    const before = (await readGameState(uid))?.bonusPenalty ?? 0;
    const res = await call('requestClueHint', {});
    const after = (await readGameState(uid))?.bonusPenalty ?? 0;
    check('requestClueHint adds a 50pt penalty', after === before + 50,
      `bonusPenalty ${before} -> ${after} (applied=${res?.penaltyApplied})`);
  } catch (e) {
    check('requestClueHint succeeds', false, e.message);
  }

  // 7. Flash mission — admin broadcast lands on the canonical public path.
  try {
    const res = await call('pushFlashMission', {
      title: 'E2E Flash', titleHe: 'ברק E2E', description: 'test',
      bonusPoints: 200, ttlSeconds: 120,
    });
    check('pushFlashMission returns an id + expiry', !!res?.id && !!res?.expiresAt,
      JSON.stringify(res));
    const snap = await getDocs(collection(fs, `artifacts/${APP_ID}/public/data/flashMissions`));
    const mine = snap.docs.find((d) => d.id === res.id);
    check('  flash mission written to canonical path', !!mine,
      `docs=${snap.size}`);
    check('  flash mission carries bilingual fields + bonus', !!mine && mine.data().titleHe === 'ברק E2E' && mine.data().bonusPoints === 200,
      mine ? JSON.stringify(mine.data()).slice(0, 160) : 'missing');
  } catch (e) {
    check('pushFlashMission succeeds', false, e.message);
  }

  // 8. SOS — team raises an alert, admin acknowledges it.
  try {
    const res = await call('triggerSOS', { lat: 31.7717, lng: 35.2035 });
    check('triggerSOS returns an alert id', !!res?.id, JSON.stringify(res));
    const snap = await getDocs(collection(fs, `artifacts/${APP_ID}/public/data/adminAlerts`));
    const mine = snap.docs.find((d) => d.id === res.id);
    check('  alert written with type=sos + location', !!mine && mine.data().type === 'sos' && !!mine.data().location,
      mine ? JSON.stringify(mine.data()).slice(0, 160) : 'missing');
    const ack = await call('acknowledgeAlert', { alertId: res.id });
    check('  acknowledgeAlert succeeds', ack?.success === true, JSON.stringify(ack));
    const after = await getDoc(doc(fs, `artifacts/${APP_ID}/public/data/adminAlerts/${res.id}`));
    check('  alert marked acknowledged', after.exists() && after.data().acknowledged === true,
      `acknowledged=${after.data()?.acknowledged}`);
  } catch (e) {
    check('SOS flow succeeds', false, e.message);
  }

  // 9. saveTeneSelection — persists the crafting menu picks to gameState.
  try {
    const res = await call('saveTeneSelection', { productIds: ['olives', 'pomegranates', 'bogus-id'] });
    const sel = res?.teneSelection ?? [];
    check('saveTeneSelection drops unknown ids', !sel.includes('bogus-id') && sel.includes('olives') && sel.includes('pomegranates'),
      JSON.stringify(sel));
    const gs = await readGameState(uid);
    check('  selection mirrored onto gameState', Array.isArray(gs?.teneSelection) && gs.teneSelection.includes('olives'),
      JSON.stringify(gs?.teneSelection));
  } catch (e) {
    check('saveTeneSelection succeeds', false, e.message);
  }

  // 10. joinTeam — a SECOND device joins the same (already-claimed) code and
  //     receives a custom token for the original team uid.
  try {
    const app2  = initializeApp({ apiKey: 'emulator-key', projectId: 'rushpoint-pwa-7daaa', appId: 'emulator-app-id' }, 'device2');
    const auth2 = getAuth(app2);
    const fns2  = getFunctions(app2);
    connectAuthEmulator(auth2, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(fns2, '127.0.0.1', 5001);
    await signInAnonymously(auth2);
    const res = await httpsCallable(fns2, 'joinTeam')({ code }).then((r) => r.data);
    check('joinTeam returns a custom token for the original team', !!res?.token && res?.teamId === uid,
      `teamId=${res?.teamId} (reg uid=${uid})`);
  } catch (e) {
    check('joinTeam succeeds', false, e.message);
  }

  // 11. Matchmaking — only the winner advances; the loser is re-queued ('waiting').
  try {
    const oppApp  = initializeApp({ apiKey: 'emulator-key', projectId: 'rushpoint-pwa-7daaa', appId: 'emulator-app-id' }, 'opponent');
    const oppAuth = getAuth(oppApp);
    const oppFns  = getFunctions(oppApp);
    const oppFs   = getFirestore(oppApp);
    connectAuthEmulator(oppAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(oppFns, '127.0.0.1', 5001);
    connectFirestoreEmulator(oppFs, '127.0.0.1', 8080);
    const oppCred = await signInAnonymously(oppAuth);
    const oppUid  = oppCred.user.uid;
    await httpsCallable(oppFns, 'registerTeam')({
      code: 'BEAR02', teamName: 'E2E Opponent', captainPhone: '0500000001',
      participants: [{ name: 'Dee', age: '12' }, { name: 'Eli', age: '13' }, { name: 'Fox', age: '12' }, { name: 'Gil', age: '11' }], waiverAccepted: true,
    });

    // Matchmaking pairs teams within 300 pts. The main team has accumulated score
    // from earlier checks, so bring the opponent to parity before queueing.
    const myScore = (await readGameState(uid))?.score ?? 0;
    await call('adjustTeamScore', { teamId: oppUid, kind: 'score_override', setTo: myScore, reason: 'e2e match parity' });

    await call('joinMatchQueue', {});                                   // main team waits
    const matched = await httpsCallable(oppFns, 'joinMatchQueue')({}).then((r) => r.data); // opponent matches
    check('joinMatchQueue pairs two waiting teams', matched?.matched === true && !!matched?.matchId,
      JSON.stringify(matched));

    if (matched?.matchId) {
      await call('resolveMatch', { matchId: matched.matchId, winnerId: uid });  // main team wins
      // Read each team's private gameState with that team's own auth (rules block
      // cross-team reads — by design).
      const winnerGs = await readGameState(uid);
      const loserGs  = await getDoc(doc(oppFs, `artifacts/${APP_ID}/users/${oppUid}/gameState/current`)).then((s) => (s.exists() ? s.data() : null));
      check('  winner matchStatus = won', winnerGs?.matchStatus === 'won', `status=${winnerGs?.matchStatus}`);
      check('  loser matchStatus = lost', loserGs?.matchStatus === 'lost', `status=${loserGs?.matchStatus}`);
      const lq = await getDoc(doc(fs, `artifacts/${APP_ID}/public/data/matchQueue/${oppUid}`));
      check('  loser re-queued as waiting', lq.exists() && lq.data().status === 'waiting',
        `queueStatus=${lq.data()?.status}`);
    }
  } catch (e) {
    check('matchmaking flow succeeds', false, e.message);
  }

  // 12. Operational features — location, announcements, score adjust + audit.
  try {
    await call('updateLocation', { lat: 31.7717, lng: 35.2035, teamName: 'E2E Test Squad' });
    const loc = await getDoc(doc(fs, `artifacts/${APP_ID}/public/data/teamLocations/${uid}`));
    check('updateLocation writes a team location', loc.exists() && loc.data().lat === 31.7717,
      `lat=${loc.data()?.lat}`);
  } catch (e) {
    check('updateLocation succeeds', false, e.message);
  }

  try {
    const res = await call('pushAnnouncement', { message: 'E2E weather warning', messageHe: 'אזהרת מזג אוויר', level: 'warning' });
    check('pushAnnouncement returns an id', !!res?.id, JSON.stringify(res));
    const snap = await getDocs(collection(fs, `artifacts/${APP_ID}/public/data/announcements`));
    const mine = snap.docs.find((d) => d.id === res.id);
    check('  announcement written + active', !!mine && mine.data().active === true && mine.data().level === 'warning',
      mine ? JSON.stringify(mine.data()).slice(0, 120) : 'missing');
  } catch (e) {
    check('pushAnnouncement succeeds', false, e.message);
  }

  try {
    const before = (await readGameState(uid))?.score ?? 0;
    const res = await call('adjustTeamScore', { teamId: uid, kind: 'fine', delta: -50, reason: 'e2e fine' });
    const { newScore } = res.data ?? res;
    const after = (await readGameState(uid))?.score ?? 0;
    check('adjustTeamScore applies a fine', after === Math.max(0, before - 50),
      `score ${before} → ${after}`);
    const { logs } = await call('listAuditLogs', {});
    const fineLog = (logs ?? []).find((l) => l.teamId === uid && l.actionType === 'fine');
    check('  audit log records the fine with prev/new', !!fineLog && fineLog.previousValue === before && fineLog.newValue === after,
      fineLog ? `${fineLog.previousValue}→${fineLog.newValue}` : 'no fine log');
  } catch (e) {
    check('adjustTeamScore + listAuditLogs succeed', false, e.message);
  }

  // 13. setStationStatus removes a paused station from routing recommendations.
  try {
    const recs0 = (await call('getRecommendedTasks', { lat: 31.7717, lng: 35.2035, targetType: 'green' })).recommendations || [];
    const target = recs0[0]?.taskId;
    check('have a green station to pause', !!target, `count=${recs0.length}`);
    if (target) {
      await call('setStationStatus', { taskId: target, status: 'paused' });
      const recs1 = (await call('getRecommendedTasks', { lat: 31.7717, lng: 35.2035, targetType: 'green' })).recommendations || [];
      check('paused station excluded from recommendations', !recs1.some((r) => r.taskId === target),
        `target=${target} stillListed=${recs1.some((r) => r.taskId === target)}`);
      await call('setStationStatus', { taskId: target, status: 'active' }); // restore
    }
  } catch (e) {
    check('setStationStatus succeeds', false, e.message);
  }

  // 14. evacuateStation releases a team off a station (fresh team on task-green-001).
  try {
    const evApp  = initializeApp({ apiKey: 'emulator-key', projectId: 'rushpoint-pwa-7daaa', appId: 'emulator-app-id' }, 'evacteam');
    const evAuth = getAuth(evApp);
    const evFns  = getFunctions(evApp);
    const evFs   = getFirestore(evApp);
    connectAuthEmulator(evAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(evFns, '127.0.0.1', 5001);
    connectFirestoreEmulator(evFs, '127.0.0.1', 8080);
    const evCred = await signInAnonymously(evAuth);
    const evUid  = evCred.user.uid;
    await httpsCallable(evFns, 'registerTeam')({
      code: 'WOLF03', teamName: 'E2E Evac', captainPhone: '0500000002',
      participants: [{ name: 'Fae', age: '12' }, { name: 'Gus', age: '13' }, { name: 'Hal', age: '12' }, { name: 'Ivy', age: '11' }], waiverAccepted: true,
    });
    // Slot 0 is load-balance-routed at registration, so read the station the team
    // actually landed on (not a hardcoded id) and evacuate that.
    const preGs = await getDoc(doc(evFs, `artifacts/${APP_ID}/users/${evUid}/gameState/current`)).then((s) => (s.exists() ? s.data() : null));
    const evTaskId = preGs?.slots?.find((s) => s.status === 'active')?.taskId;
    check('fresh team was routed to a green station', !!evTaskId, `taskId=${evTaskId}`);
    const res = await call('evacuateStation', { taskId: evTaskId });
    const { evacuatedCount } = res;
    check('evacuateStation releases at least the fresh team', (evacuatedCount ?? 0) >= 1, `count=${evacuatedCount}`);
    const evGs = await getDoc(doc(evFs, `artifacts/${APP_ID}/users/${evUid}/gameState/current`)).then((s) => (s.exists() ? s.data() : null));
    const evActiveTask = evGs?.slots?.find((s) => s.status === 'active')?.taskId;
    check('  evacuated team flagged + slot cleared', evGs?.evacuatedFrom != null && evActiveTask == null,
      `evacuatedFrom=${evGs?.evacuatedFrom} activeTask=${evActiveTask}`);
    const { logs } = await call('listAuditLogs', {});
    check('  evacuation recorded in audit log', (logs ?? []).some((l) => l.teamId === evUid && l.actionType === 'evacuation'),
      `logs=${logs?.length}`);
  } catch (e) {
    check('evacuateStation succeeds', false, e.message);
  }

  // 15. Race Builder — saveRaceConfig + upsertStation (create→update) + deleteStation.
  try {
    await call('saveRaceConfig', {
      start: { lat: 31.79, lng: 35.164 }, finish: { lat: 31.8155, lng: 35.1875 },
      gate: { lat: 31.811, lng: 35.184 }, center: { lat: 31.803, lng: 35.176 }, zoom: 13.5,
    });
    const cfg = await getDoc(doc(fs, `artifacts/${APP_ID}/public/data/raceConfig/current`));
    check('saveRaceConfig writes the race config', cfg.exists() && cfg.data().zoom === 13.5,
      `zoom=${cfg.data()?.zoom}`);

    const created = await call('upsertStation', {
      kind: 'task', type: 'green', title: 'E2E Builder Station', coordinates: { lat: 31.8, lng: 35.17 },
      difficulty: 6, pointValue: 120,
    });
    const newId = created?.id;
    check('upsertStation creates a station with an id', !!newId, JSON.stringify(created));
    const taskDoc = await getDoc(doc(fs, `artifacts/${APP_ID}/public/data/tasks/${newId}`));
    check('  new station persisted with a generated QR code', taskDoc.exists() && taskDoc.data().qrCode === `QR-${newId}`,
      `qrCode=${taskDoc.data()?.qrCode} count=${taskDoc.data()?.currentTeamCount}`);

    await call('upsertStation', { kind: 'task', id: newId, type: 'green', title: 'E2E Renamed', coordinates: { lat: 31.8, lng: 35.17 } });
    const updated = await getDoc(doc(fs, `artifacts/${APP_ID}/public/data/tasks/${newId}`));
    check('  update preserves id + counter, changes title', updated.data()?.title === 'E2E Renamed' && updated.data()?.currentTeamCount === 0,
      `title=${updated.data()?.title}`);

    await call('deleteStation', { id: newId, kind: 'task' });
    const gone = await getDoc(doc(fs, `artifacts/${APP_ID}/public/data/tasks/${newId}`));
    check('  deleteStation removes the station', !gone.exists());
  } catch (e) {
    check('Race Builder callables succeed', false, e.message);
  }

  // 16. selfVerifyStation — a team self-confirms its ACTIVE green slot by entering
  //     the station code (mirrors the seed's server-only codes). Wrong code → no
  //     state change; correct code → slot scored + advanced (judge-pass parity).
  try {
    // Same green codes the seed writes to stationSecrets/{taskId} (server-only).
    const GREEN_CODES = {
      'task-green-001': 'LANDMARK', 'task-green-002': 'RELAY',
      'task-green-003': 'TRIVIA',   'task-green-004': 'KNOT',
    };
    const svApp  = initializeApp({ apiKey: 'emulator-key', projectId: 'rushpoint-pwa-7daaa', appId: 'emulator-app-id' }, 'selfverify');
    const svAuth = getAuth(svApp);
    const svFns  = getFunctions(svApp);
    const svFs   = getFirestore(svApp);
    connectAuthEmulator(svAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(svFns, '127.0.0.1', 5001);
    connectFirestoreEmulator(svFs, '127.0.0.1', 8080);
    const svCred = await signInAnonymously(svAuth);
    const svUid  = svCred.user.uid;
    const svCall = (name, data) => httpsCallable(svFns, name)(data).then((r) => r.data);
    const svGameState = () =>
      getDoc(doc(svFs, `artifacts/${APP_ID}/users/${svUid}/gameState/current`)).then((s) => (s.exists() ? s.data() : null));

    await svCall('registerTeam', {
      code: 'EAGLE4', teamName: 'E2E Self-Verify', captainPhone: '0500000003',
      participants: [{ name: 'Jo', age: '12' }, { name: 'Kai', age: '13' }, { name: 'Lee', age: '12' }, { name: 'Mo', age: '11' }],
      waiverAccepted: true,
    });
    const gs0 = await svGameState();
    const activeSlot = gs0?.slots?.find((s) => s.status === 'active');
    const greenTaskId = activeSlot?.type === 'green' ? activeSlot.taskId : undefined;
    check('self-verify: fresh team is active on a green station', !!greenTaskId,
      `taskId=${greenTaskId} type=${activeSlot?.type}`);

    if (greenTaskId) {
      // Wrong code → correct:false, slot stays active, score unchanged.
      const beforeScore = gs0?.score ?? 0;
      const wrong = await svCall('selfVerifyStation', { taskId: greenTaskId, answer: 'definitely-wrong' });
      const gsWrong = await svGameState();
      const stillActive = gsWrong?.slots?.find((s) => s.status === 'active')?.taskId === greenTaskId;
      check('  wrong code returns correct:false', wrong?.correct === false && wrong?.completed !== true,
        JSON.stringify(wrong));
      check('  wrong code leaves the slot active + score unchanged', stillActive && (gsWrong?.score ?? 0) === beforeScore,
        `active=${stillActive} score=${gsWrong?.score}`);

      // Ineligible: self-verify a station the team is NOT active on → rejected.
      let rejected = false;
      try { await svCall('selfVerifyStation', { taskId: 'task-gold-001', answer: 'x' }); }
      catch { rejected = true; }
      check('  self-verify rejected when not active at that station', rejected);

      // Correct code → slot completes, next unlocks, score increases (judge parity).
      const slotIdx = activeSlot.index;
      const correct = await svCall('selfVerifyStation', { taskId: greenTaskId, answer: GREEN_CODES[greenTaskId].toLowerCase() });
      const gsDone = await svGameState();
      const doneSlot = gsDone?.slots?.[slotIdx];
      const nextSlot = gsDone?.slots?.[slotIdx + 1];
      check('  correct code completes the slot (judge-pass parity)', correct?.completed === true && correct?.taskScore > 0,
        JSON.stringify(correct));
      check('  completed slot stores the sigmoid task score', doneSlot?.status === 'completed' && (doneSlot?.earnedScore ?? 0) === correct.taskScore,
        `status=${doneSlot?.status} earned=${doneSlot?.earnedScore}`);
      check('  next slot unlocks + score increases by the award', nextSlot?.status === 'active' && (gsDone?.score ?? 0) === beforeScore + correct.taskScore,
        `next=${nextSlot?.status} score ${beforeScore}+${correct.taskScore}->${gsDone?.score}`);
    }
  } catch (e) {
    check('selfVerifyStation flow succeeds', false, e.message);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
