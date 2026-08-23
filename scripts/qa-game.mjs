// ═══════════════════════════════════════════════════════════════════════════════
// RushPoint — "מגרש הבדיקות" (QA Playground) runner.
//
//   node scripts/qa-game.mjs --seed       ← write the game (Admin SDK) as a LIVE
//        run + public gallery entry, join code TESTALL. Idempotent.
//
//   node scripts/qa-game.mjs --simulate   ← 1 team plays the WHOLE thing through
//        the real callable API (every task type) and audits the run. Proves the
//        design is completable before you walk outside with a phone.
//
// The game definition lives in scripts/lib/qa-game-def.mjs (shared with
// scripts/seed-local.mjs). Needs the emulator running (8080 / 9099 / 5001).
// ═══════════════════════════════════════════════════════════════════════════════
import {
  PROJECT, PIN, CODE, GAME_ID, RUN_ID, OWNER_UID, STATION_CODE, FINAL_ANSWER,
  GAME_META, REGISTRATION_FIELDS, INSTRUCTIONS, buildStages, seedQaGame,
} from './lib/qa-game-def.mjs';

const MODE = process.argv.includes('--simulate') ? 'simulate' : 'seed';

// ══════════════════════════════════════════════════════════════════════════════
// MODE: --seed
// ══════════════════════════════════════════════════════════════════════════════
async function runSeed() {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  const admin = (await import('firebase-admin')).default;
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore();
  const auth = admin.auth();
  const res = await seedQaGame(admin, db, auth, new Date().toISOString());
  console.log(`\n✅ QA playground seeded — ${res.stageCount} stages · ${res.taskCount} tasks`);
  console.log(`   join code: ${res.code}   ·   pin: ${PIN.lat}, ${PIN.lng}`);
  console.log(`   station code: ${STATION_CODE}  (QR payload "RP1:${STATION_CODE}")\n`);
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE: --simulate — one team plays every task type end-to-end.
// ══════════════════════════════════════════════════════════════════════════════
async function runSimulate() {
  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import('firebase/auth');
  const { getFunctions, connectFunctionsEmulator, httpsCallable } = await import('firebase/functions');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function makeParty(name) {
    const app = initializeApp({ apiKey: 'emulator-key', projectId: PROJECT, appId: `qa-${name}` }, name);
    const auth = getAuth(app), functions = getFunctions(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    // A bot plays far faster than a human, so it trips the per-minute rate
    // budgets (RATE_LIMITS) the real app never reaches. That's the limiter
    // working, not a bug — wait out the window instead of failing the run.
    const call = async (fn, data) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return (await httpsCallable(functions, fn)(data)).data;
        } catch (e) {
          if (attempt < 6 && String(e?.code ?? '').includes('resource-exhausted')) {
            await sleep(10_000);
            continue;
          }
          throw e;
        }
      }
    };
    return { auth, call };
  }

  let violations = 0;
  const audit = (label, ok, detail) => {
    console.log(`${ok ? 'OK  ' : 'VIOLATION'}  ${label}${detail ? ' :: ' + detail : ''}`);
    if (!ok) violations++;
  };

  const creator = makeParty('qa-sim-creator');
  const cred = await signInAnonymously(creator.auth);
  const ownerUid = cred.user.uid;

  const { gameId } = await creator.call('createGame', { title: GAME_META.title, mode: GAME_META.mode });
  await creator.call('updateGame', {
    gameId,
    description: GAME_META.description,
    scoringPreset: GAME_META.scoringPreset,
    registrationFields: REGISTRATION_FIELDS,
    instructions: INSTRUCTIONS,
    powerUpsEnabled: true,
    stages: buildStages(),
  });
  const { runId, accessCode } = await creator.call('launchRun', { gameId });
  console.log(`game=${gameId} run=${runId} code=${accessCode}\n`);

  const player = makeParty('qa-sim-team');
  const pCred = await signInAnonymously(player.auth);
  const uid = pCred.user.uid;
  await player.call('joinRun', { code: accessCode, displayName: 'קבוצת בדיקה' });
  const started = await creator.call('startTeams', { gameId, runId });
  audit('startTeams הפעיל את הקבוצה', started?.launched === 1, JSON.stringify(started));

  const C = { ownerUid, gameId, runId };
  const photoUrl = (name) =>
    `https://firebasestorage.googleapis.com/v0/b/${PROJECT}.appspot.com/o/` +
    `${encodeURIComponent(`runs/${runId}/teams/${uid}/${name}`)}?alt=media`;

  const seen = new Set();        // every task the router actually handed us
  const submitted = new Set();   // …and that we managed to submit without an error
  const fails = new Map();       // taskId → { hard, soft } retry budget
  const reported = new Set();    // audit each hard failure once, not once per turn
  let sequenceStep = 0;
  let aborted = null;

  for (let turn = 0; turn < 200; turn++) {
    const state = await player.call('getMyTeamState', { code: accessCode });
    if (state?.team?.status === 'finished') break;

    const tasks = (state?.team?.stages ?? []).flatMap((s) => s.tasks ?? []);
    const assigned = tasks.find((t) => t.status === 'assigned');
    if (!assigned) {
      await player.call('requestNextTask', { code: accessCode, lat: PIN.lat, lng: PIN.lng });
      // Breathe: nothing assignable usually means a gated task (qa-timed) is
      // still counting down. A tight spin here just burns the rate budget.
      await sleep(2000);
      continue;
    }
    const id = assigned.taskId;
    seen.add(id);
    try {
      switch (id) {
        case 'qa-quiz-choices':
          await player.call('submitTaskAnswer', { ...C, taskId: id, answer: 'כחול' }); break;
        case 'qa-quiz-text':
          await player.call('requestTaskHint', { ...C, taskId: id }).catch(() => {});
          await player.call('submitTaskAnswer', { ...C, taskId: id, answer: 'ירושלים' }); break;
        case 'qa-quiz-order':
          await player.call('submitTaskAnswer', {
            ...C, taskId: id, orderedAnswer: ['ראשון', 'שני', 'שלישי', 'רביעי'],
          }); break;
        case 'qa-numeric':
          await player.call('submitTaskAnswer', { ...C, taskId: id, answer: '11', lat: PIN.lat, lng: PIN.lng }); break;
        case 'qa-numeric-presence':
          await player.call('submitTaskAnswer', { ...C, taskId: id, answer: '10', lat: PIN.lat, lng: PIN.lng }); break;
        case 'qa-final':
          await player.call('submitTaskAnswer', { ...C, taskId: id, answer: String(FINAL_ANSWER), lat: PIN.lat, lng: PIN.lng }); break;
        case 'qa-survey-choice':
          await player.call('submitTaskAnswer', { ...C, taskId: id, answer: 'מעולה' }); break;
        case 'qa-survey-text':
          await player.call('submitTaskAnswer', { ...C, taskId: id, answer: 'הכל עבד חלק.' }); break;
        case 'qa-smart-code':
          await player.call('verifyStationCode', { ...C, taskId: id, code: STATION_CODE, lat: PIN.lat, lng: PIN.lng }); break;
        case 'qa-photo-auto':
          await player.call('submitStationPhoto', { ...C, teamId: uid, taskId: id, photoUrl: photoUrl(`${id}.jpg`) }); break;
        // captureKind:'audio' — submitStationPhoto validates the DECLARED
        // contentType against the task's captureKind (packages/shared
        // AUDIO_CONTENT_TYPES); omitting it is rejected for an audio task.
        case 'qa-audio':
          await player.call('submitStationPhoto', {
            ...C, teamId: uid, taskId: id, photoUrl: photoUrl(`${id}.m4a`), contentType: 'audio/mp4',
          }); break;
        // Staff review: reviewStationSubmission is keyed by teamId+taskId (there
        // is no submission id) and takes a boolean `approved`.
        case 'qa-photo-review': {
          await player.call('submitStationPhoto', { ...C, teamId: uid, taskId: id, photoUrl: photoUrl(`${id}.jpg`) });
          await creator.call('reviewStationSubmission', { ...C, teamId: uid, taskId: id, approved: true });
          break;
        }
        case 'qa-sequence': {
          const steps = ['21', null, 'מגרש'];
          for (sequenceStep = 0; sequenceStep < steps.length; sequenceStep++) {
            await player.call('submitSequenceStep', {
              ...C, taskId: id, stepIndex: sequenceStep,
              answer: steps[sequenceStep] ?? '', lat: PIN.lat, lng: PIN.lng,
            });
          }
          break;
        }
        default:
          await player.call('completeTask', { ...C, taskId: id, lat: PIN.lat, lng: PIN.lng });
      }
      submitted.add(id);
    } catch (e) {
      const msg = e?.message ?? '';
      const budget = fails.get(id) ?? { hard: 0, soft: 0 };
      fails.set(id, budget);
      // A timed task (qa-timed) is legitimately not-yet-released early on; retry
      // for up to ~2 min. Anything else is a real failure: report it ONCE and
      // give up on that task instead of burning every remaining turn on it.
      if (/released|not available|locked|not yet|עדיין/i.test(msg)) {
        budget.soft++;
        if (budget.soft > 40) { audit(`משימה ${id} לא נפתחה בזמן`, false, msg); aborted = id; break; }
        await sleep(3000);
      } else {
        budget.hard++;
        if (!reported.has(id)) { reported.add(id); audit(`משימה ${id} נכשלה`, false, msg); }
        if (budget.hard >= 3) { aborted = id; break; }
        await sleep(1000);
      }
    }
  }
  if (aborted) console.log(`\n⛔ הסימולציה נעצרה על ${aborted} — המשימה חוסמת את ההמשך.`);

  const final = await player.call('getMyTeamState', { code: accessCode });
  audit('הקבוצה סיימה את כל השלבים', final?.team?.status === 'finished', final?.team?.status);
  const expected = buildStages().flatMap((s) => s.tasks).map((t) => t.id);
  // Two groups are deliberately NOT all-playable, so a full sweep is the wrong
  // oracle for them: the exclusiveGroups pair yields exactly one, and the
  // requiredTaskCount=2 stage yields exactly two of three. Assert the counts.
  const alts = ['qa-alt-x', 'qa-alt-y'];
  const picks = ['qa-pick-a', 'qa-pick-b', 'qa-pick-c'];
  const optional = [...alts, ...picks];
  const nAlts = alts.filter((t) => submitted.has(t)).length;
  const nPicks = picks.filter((t) => submitted.has(t)).length;
  audit('exclusiveGroups — בדיוק משימה אחת מתוך qa-alt-x/y', nAlts === 1, `נבחרו ${nAlts}`);
  audit('requiredTaskCount — בדיוק 2 מתוך qa-pick-a/b/c', nPicks === 2, `הושלמו ${nPicks}`);

  const missed = expected.filter((t) => !submitted.has(t) && !optional.includes(t));
  audit('כל המשימות החובה הוגשו', missed.length === 0, missed.join(', '));
  console.log(`\nמשימות שהוגשו: ${submitted.size}/${expected.length} ` +
    `(מתוכן ${expected.length - optional.length} חובה + ${nAlts + nPicks}/3 אופציונליות)`);
  console.log(`משימות שהמנתב הקצה: ${seen.size}/${expected.length}`);

  console.log(violations === 0 ? '\n✅ הסימולציה עברה' : `\n❌ ${violations} כשלים`);
  process.exit(violations === 0 ? 0 : 1);
}

await (MODE === 'seed' ? runSeed() : runSimulate());
