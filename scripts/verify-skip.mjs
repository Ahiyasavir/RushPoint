// Focused verification of the station-aware skip scoring (Part A2/A3).
// Registers a fresh team, then skips through several stages and asserts each skip
// awards a sensible, stage-appropriate, NON-ZERO amount (the old bug: 255 then 0),
// and that listTeams progress advances on skip.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc } from 'firebase/firestore';

const app = initializeApp({ apiKey: 'emulator-key', projectId: 'race-to-tzion-2026', appId: 'emulator-app-id' });
const auth = getAuth(app); const functions = getFunctions(app); const fs = getFirestore(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
connectFunctionsEmulator(functions, '127.0.0.1', 5001);
connectFirestoreEmulator(fs, '127.0.0.1', 8080);
const APP_ID = 'race-to-tzion-2026';
const call = (n, d) => httpsCallable(functions, n)(d).then((r) => r.data);
const readGS = (uid) => getDoc(doc(fs, `artifacts/${APP_ID}/users/${uid}/gameState/current`)).then((s) => s.data());

let failures = 0;
const check = (label, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`); if (!cond) failures++; };

async function main() {
  const { user } = await signInAnonymously(auth);
  const uid = user.uid;
  const code = process.argv[2] || 'BEAR02';
  await call('registerTeam', {
    code, teamName: 'Skip Verify', captainPhone: '0500000001',
    participants: [{ name: 'A', age: '12' }, { name: 'B', age: '12' }, { name: 'C', age: '11' }, { name: 'D', age: '13' }], waiverAccepted: true,
  });
  console.log('Registered', uid, 'with', code);

  const awards = [];
  // Skip every slot to the end; capture the award + active slot each time.
  for (let i = 0; i < 6; i++) {
    const before = await readGS(uid);
    const active = before.slots.find((s) => s.status === 'active');
    if (!active) break;
    const res = await call('skipTask', { teamId: uid });
    awards.push({ index: active.index, type: active.type, hadTask: !!active.taskId, award: res.awardedScore });
    console.log(`  skipped slot ${active.index} (${active.type}, task=${active.taskId ?? 'none'}) → +${res.awardedScore}`);
    if (res.allDone) break;
  }

  // A3: every skip is non-zero and stage-appropriate (no more "255 then 0").
  check('every skip awarded > 0 (station-aware)', awards.every((a) => a.award > 0),
    awards.map((a) => `${a.type}:${a.award}`).join(' '));
  const gate = awards.find((a) => a.type === 'gate');
  check('gate skip awards the duel-win value (150)', gate && gate.award === 150, gate ? `gate=${gate.award}` : 'no gate slot reached');
  const orange = awards.find((a) => a.type === 'orange');
  check('orange skip awards a stage baseline (>0)', orange && orange.award > 0, orange ? `orange=${orange.award}` : 'no orange slot reached');

  // A2: progress (completedSlots) reflects skipped slots — team isn't "stuck".
  const { teams } = await call('listTeams', {});
  const mine = teams.find((t) => t.id === uid);
  check('listTeams counts skipped slots as progress', mine && mine.completedSlots === awards.length,
    `completedSlots=${mine?.completedSlots} skips=${awards.length}`);

  console.log(`\n${failures === 0 ? 'ALL SKIP CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('verify-skip failed:', e.message); process.exit(1); });
