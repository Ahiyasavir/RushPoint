// ═══════════════════════════════════════════════════════════════════════════════
// RushPoint — "מפת האוצר של סנסנה" (Sansana Treasure Map)
//
// A real, playable night field-game for Sansana: a linear clue-hunt through four
// real locations. Each station reveals ONE digit of a 4-digit vault code; the code
// is entered back home to win. The map hides each next location — players are
// guided ONLY by a Hebrew riddle and must physically arrive (server-validated GPS).
//
//   Route:  Home → Synagogue → Ben-Dor Park → Heart Park → Home (finale)
//   Vault code:  4 · 7 · 6 · 3  →  "4763"
//
// The game definition lives in scripts/lib/sansana-game-def.mjs and is shared with
// scripts/seed-local.mjs (so a fresh emulator seeds it into the gallery). Two modes:
//
//   node scripts/sansana-game.mjs --simulate     ← 2 teams play it via the REAL
//        callable API (GPS check-ins, quiz/numeric answers, auto-approved photos)
//        then a full consistency audit. Proves the design before you go outside.
//
//   node scripts/sansana-game.mjs --seed         ← writes it (Admin SDK) as a LIVE
//        run + public gallery entry, join code SANSANA. Use to (re)seed a running
//        emulator on demand; fresh boots already seed it via seed-local.
//
// Needs the emulator running (Firestore 8080 / Auth 9099 / Functions 5001).
// ═══════════════════════════════════════════════════════════════════════════════
import {
  PROJECT, LOC, VAULT_CODE, GAME_META, buildStages, seedSansana, CODE,
} from './lib/sansana-game-def.mjs';

const MODE = process.argv.includes('--seed') ? 'seed'
  : process.argv.includes('--simulate') ? 'simulate'
  : 'simulate'; // default: verify the design

// ══════════════════════════════════════════════════════════════════════════════
// MODE: --simulate — 2 teams play the real API, then a full run audit.
// ══════════════════════════════════════════════════════════════════════════════
async function runSimulate() {
  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import('firebase/auth');
  const { getFunctions, connectFunctionsEmulator, httpsCallable } = await import('firebase/functions');
  const { getFirestore, connectFirestoreEmulator, doc, getDoc } = await import('firebase/firestore');
  const { auditRun } = await import('./lib/run-audit.mjs');

  const TEAMS = 2;
  let _seed = 20260711;
  const rand = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
  const jitter = (p, m = 20) => ({
    lat: p.lat + ((rand() - 0.5) * 2 * m) / 111_320,
    lng: p.lng + ((rand() - 0.5) * 2 * m) / 111_320,
  });

  function makeParty(name) {
    const app = initializeApp({ apiKey: 'emulator-key', projectId: PROJECT, appId: `sim-${name}` }, name);
    const auth = getAuth(app), functions = getFunctions(app), db = getFirestore(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    return {
      auth,
      call: (fn, data) => httpsCallable(functions, fn)(data).then((r) => r.data),
      getDocAt: (path) => getDoc(doc(db, path)).then((s) => ({ exists: s.exists(), data: s.data() })),
    };
  }

  let violations = 0;
  const audit = (label, cond, detail) => {
    console.log(`${cond ? 'OK  ' : 'VIOLATION'}  ${label}${detail ? ' :: ' + detail : ''}`);
    if (!cond) violations++;
  };

  console.log('── סימולציה: 2 קבוצות משחקות את "מפת האוצר של סנסנה" ──\n');

  const creator = makeParty('sansana-sim-creator');
  const creatorCred = await signInAnonymously(creator.auth);
  const ownerUid = creatorCred.user.uid;

  const { gameId } = await creator.call('createGame', { title: GAME_META.title, mode: GAME_META.mode });
  await creator.call('updateGame', {
    gameId, description: GAME_META.description, scoringPreset: GAME_META.scoringPreset, stages: buildStages(),
  });
  const { runId, accessCode } = await creator.call('launchRun', { gameId });
  console.log(`game=${gameId} run=${runId} code=${accessCode}\n`);

  const teams = await Promise.all(Array.from({ length: TEAMS }, async (_, i) => {
    const p = makeParty(`sansana-team-${i}`);
    const cred = await signInAnonymously(p.auth);
    await p.call('joinRun', { code: accessCode, displayName: `קבוצה ${i + 1}` });
    return { p, uid: cred.user.uid, idx: i };
  }));
  const started = await creator.call('startTeams', { gameId, runId });
  audit(`startTeams הפעיל את כל ${TEAMS} הקבוצות`, started?.launched === TEAMS, JSON.stringify(started));

  const coordOf = {
    'home-selfie': LOC.home, 'home-vault': LOC.home,
    'syn-arrive': LOC.synagogue, 'bendor-arrive': LOC.benDor, 'bendor-count': LOC.benDor,
    'bendor-ropes': LOC.benDor, 'heart-arrive': LOC.heartPark, 'heart-view': LOC.heartPark,
  };
  const photoUrl = (runId, uid, name) =>
    `https://firebasestorage.googleapis.com/v0/b/${PROJECT}.appspot.com/o/` +
    `${encodeURIComponent(`runs/${runId}/teams/${uid}/${name}`)}?alt=media`;

  async function playTeam({ p, uid }) {
    const C = { ownerUid, gameId, runId };
    for (let turn = 0; turn < 60; turn++) {
      const state = await p.call('getMyTeamState', { code: accessCode });
      if (state?.team?.status === 'finished') return { finished: true, turns: turn };

      const tasks = (state?.team?.stages ?? []).flatMap((s) => s.tasks ?? []);
      const assigned = tasks.find((t) => t.status === 'assigned');
      if (!assigned) {
        const here = jitter(LOC.home, 15);
        await p.call('requestNextTask', { code: accessCode, lat: here.lat, lng: here.lng });
        continue;
      }
      const id = assigned.taskId;
      if (id === 'syn-quiz') {
        await p.call('submitTaskAnswer', { ...C, taskId: id, answer: 'בני עקיבא' });
      } else if (id === 'heart-town') {
        await p.call('submitTaskAnswer', { ...C, taskId: id, answer: 'מיתר' });
      } else if (id === 'bendor-count') {
        await p.call('submitTaskAnswer', { ...C, taskId: id, answer: '6' });
      } else if (id === 'home-vault') {
        await p.call('submitTaskAnswer', { ...C, taskId: id, answer: String(VAULT_CODE) });
      } else if (['home-selfie', 'bendor-ropes', 'heart-view'].includes(id)) {
        await p.call('submitStationPhoto', { ...C, teamId: uid, taskId: id, photoUrl: photoUrl(runId, uid, `${id}.jpg`) });
      } else {
        const spot = jitter(coordOf[id] ?? LOC.home, 15);
        await p.call('completeTask', { ...C, taskId: id, lat: spot.lat, lng: spot.lng });
      }
    }
    return { finished: false, turns: 60 };
  }

  const results = await Promise.all(teams.map(playTeam));
  const unfinished = results.filter((r) => !r.finished).length;
  audit('כל הקבוצות סיימו את המסלול', unfinished === 0, `${unfinished} לא סיימו`);

  const states = await Promise.all(teams.map(({ p }) => p.call('getMyTeamState', { code: accessCode })));
  await auditRun({ creator, ownerUid, gameId, runId, states, audit });

  console.log(violations === 0
    ? '\n✅ הסימולציה עקבית — המשחק עובד מקצה לקצה (מסלול, חידות, קוד כספת, ניקוד).'
    : `\n❌ ${violations} הפרות עקביות`);
  process.exit(violations === 0 ? 0 : 1);
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE: --seed — write the game as a LIVE run + gallery entry (join code SANSANA).
// ══════════════════════════════════════════════════════════════════════════════
async function runSeed() {
  const admin = (await import('firebase-admin')).default;
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  admin.initializeApp({ projectId: PROJECT });

  const { stageCount } = await seedSansana(admin, admin.firestore(), admin.auth(), new Date().toISOString());

  console.log('✅ נזרע המשחק "מפת האוצר של סנסנה" כ-run חי + פורסם לגלריה הציבורית.');
  console.log(`   קוד הצטרפות: ${CODE}`);
  console.log(`   שלבים: ${stageCount} · קוד כספת: ${VAULT_CODE}`);
  console.log('   מופיע כעת בספריית המשחקים של כולם (searchGallery / דף הגלריה).');
  console.log('   הצטרפו מהנייד עם הקוד SANSANA (הריצו npm run playtest:ngrok לקישור ציבורי).');
  process.exit(0);
}

(MODE === 'seed' ? runSeed() : runSimulate()).catch((e) => {
  console.error('\n💥 שגיאה:', e?.message ?? e);
  console.error(e);
  process.exit(1);
});
