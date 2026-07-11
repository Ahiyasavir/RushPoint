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
// Two modes, ONE shared game definition (buildStages) so the tested game and the
// game you actually run tonight are byte-identical:
//
//   node scripts/sansana-game.mjs --simulate     ← 2 teams play it via the REAL
//        callable API (GPS check-ins, quiz/numeric answers, auto-approved photos)
//        then a full consistency audit. Proves the design before you go outside.
//
//   node scripts/sansana-game.mjs --seed         ← writes it (Admin SDK) as a LIVE
//        run under creator "sansana-creator" with join code SANSANA, so it is the
//        game your groups join tonight over `npm run playtest:ngrok`.
//
// Needs the emulator running (Firestore 8080 / Auth 9099 / Functions 5001).
// ═══════════════════════════════════════════════════════════════════════════════

const MODE = process.argv.includes('--seed') ? 'seed'
  : process.argv.includes('--simulate') ? 'simulate'
  : 'simulate'; // default: verify the design

const PROJECT = 'rushpoint-pwa-7daaa';

// ── Real Sansana coordinates ─────────────────────────────────────────────────
const LOC = {
  home:      { lat: 31.364043, lng: 34.900706 }, // פרדס רימונים 10
  synagogue: { lat: 31.362156, lng: 34.900368 }, // בית הכנסת (כניסה לישוב)
  benDor:    { lat: 31.363144, lng: 34.902861 }, // פארק בן דור (שכונה א׳)
  heartPark: { lat: 31.362143, lng: 34.904173 }, // פארק הלב (מפת ארץ ישראל + תצפית)
};
const RADIUS = 70; // GPS geofence tolerance (m) — generous for phone jitter at night

// ── The vault code, one digit per station ────────────────────────────────────
// 4 = paws of the dog · 7 = chosen · 6 = swings in Ben-Dor · 3 = chosen
const VAULT_CODE = 4763;

// ── Shared game definition (identical for sim + real) ─────────────────────────
function buildStages() {
  const station = (over) => ({
    difficulty: 3, estimatedMinutes: 6, pointValue: 100, maxConcurrentTeams: 5,
    triggerMode: 'radius', geofenceRadiusMeters: RADIUS, ...over,
  });
  const anywhere = (over) => ({
    coordinates: { lat: 0, lng: 0 }, locationless: true, triggerMode: 'locationless',
    difficulty: 3, estimatedMinutes: 3, pointValue: 100, maxConcurrentTeams: 20, ...over,
  });

  return [
    // ── שלב 1 — הבית: יוצאים לדרך, אוספים את הספרה הראשונה ──────────────────────
    {
      id: 'stage-home-start', order: 0, title: '🏠 יוצאים מהבית',
      tasks: [station({
        id: 'home-selfie', title: 'סלפי פתיחה עם הכלב', type: 'photo',
        coordinates: LOC.home,
        description:
          'כל מסע מתחיל מהמפתן. צלמו סלפי של כל הקבוצה עם השומר הכי נאמן של הבית 🐶.\n\n' +
          '🔑 הספרה הראשונה לכספת = מספר כפות הרגליים של הכלב. רשמו אותה!',
        smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true },
      })],
    },

    // ── שלב 2 — בית הכנסת (מיקום נסתר, מודרך ברמז) ─────────────────────────────
    {
      id: 'stage-synagogue', order: 1, title: '⛪ תחנה: בית הכנסת',
      tasks: [
        station({
          id: 'syn-arrive', title: 'הגיעו לבית הכנסת', type: 'field',
          coordinates: LOC.synagogue, hideLocation: true,
          locationClueHe:
            'בשער הכניסה לישוב, שכן טוב לסניף שחולצתו כתומה-ירוקה, ' +
            'אני עשוי מבתים ניידים רבים שחוברו יחד. התפללתם בי הבוקר. בואו אליי.',
          description:
            'הגעתם! 🔑 הספרה השנייה לכספת היא 7. רשמו אותה, ואז ענו על השאלה.',
        }),
        anywhere({
          id: 'syn-quiz', title: 'שאלת בית הכנסת', type: 'quiz',
          description: 'לאיזו תנועת נוער שייך הסניף שצמוד לבית הכנסת?',
          choices: ['בני עקיבא', 'הצופים', 'הנוער העובד'], answers: ['בני עקיבא'],
        }),
      ],
    },

    // ── שלב 3 — פארק בן דור ────────────────────────────────────────────────────
    {
      id: 'stage-bendor', order: 2, title: '🛝 תחנה: פארק בן דור',
      tasks: [
        station({
          id: 'bendor-arrive', title: 'הגיעו לפארק בן דור', type: 'field',
          coordinates: LOC.benDor, hideLocation: true,
          locationClueHe:
            'הפארק הכי ותיק בשכונה א׳. מגלשות קטנות, מתקן חבלים, ' +
            'ומגרש כדורסל עגול. משהו כאן מתנדנד — לכו לספור אותו.',
          description:
            'הגעתם! 🔑 הספרה השלישית לכספת היא 6. רשמו אותה, ואז פתרו את המשימות.',
        }),
        station({
          id: 'bendor-count', title: 'ספירת הנדנדות', type: 'numeric',
          coordinates: LOC.benDor,
          description: 'כמה נדנדות (מכל הסוגים) יש בפארק? ספרו בשטח והזינו את המספר.',
          numericAnswer: 6, numericTolerance: 0, pointValue: 120, difficulty: 4,
        }),
        station({
          id: 'bendor-ropes', title: 'כולם על החבלים', type: 'photo',
          coordinates: LOC.benDor,
          description: 'כל הקבוצה נתלית על מתקן החבלים בו-זמנית — תמונה אחת, כולם באוויר 🧗',
          smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true },
        }),
      ],
    },

    // ── שלב 4 — פארק הלב (תצפית + מפת ארץ ישראל) ───────────────────────────────
    {
      id: 'stage-heart', order: 3, title: '🗺️ תחנה: פארק הלב',
      tasks: [
        station({
          id: 'heart-arrive', title: 'הגיעו לפארק הלב', type: 'field',
          coordinates: LOC.heartPark, hideLocation: true,
          locationClueHe:
            'פארק של גלגלים — אופניים וקורקינטים זרוקים בכל פינה — ' +
            'ועל רצפתו מצוירת כל ארץ ישראל. מהתצפית רואים יישוב אחד מנצנץ באופק בחושך.',
          description:
            'הגעתם! 🔑 הספרה הרביעית והאחרונה לכספת היא 3. רשמו אותה, ואז פתרו את המשימות.',
        }),
        anywhere({
          id: 'heart-town', title: 'היישוב באופק', type: 'quiz',
          description: 'מהתצפית רואים יישוב מנצנץ מעבר לגבעה. מה שמו?',
          choices: ['מיתר', 'להבים', 'עומר'], answers: ['מיתר'],
        }),
        station({
          id: 'heart-view', title: 'נדנדה אל הנוף', type: 'photo',
          coordinates: LOC.heartPark,
          description: 'שבו על הנדנדה שמשקיפה לנוף וצלמו את קו האורות של מיתר ברקע 🌃',
          smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true },
        }),
      ],
    },

    // ── שלב 5 — חזרה הביתה: פתיחת הכספת ────────────────────────────────────────
    {
      id: 'stage-home-final', order: 4, title: '🔐 הגמר: הכספת', isFinal: true,
      tasks: [station({
        id: 'home-vault', title: 'פתחו את הכספת', type: 'numeric',
        coordinates: LOC.home, hideLocation: true,
        locationClueHe:
          'אספתם 4 ספרות. חזרו למקום שבו הכל התחיל — הכלב שומר על הכספת.',
        description:
          'הרכיבו את 4 הספרות שאספתם בסדר האיסוף (בית → בית כנסת → בן דור → פארק הלב) ' +
          'והזינו את הקוד בן 4 הספרות כדי לפתוח את הכספת ולנצח! 🏆',
        numericAnswer: VAULT_CODE, numericTolerance: 0, pointValue: 200, difficulty: 5,
      })],
    },
  ];
}

const GAME_META = {
  title: 'מפת האוצר של סנסנה 🌙',
  description:
    'משחק שדה לילי בסנסנה: מסע חידות דרך פארק בן דור, בית הכנסת, פארק הלב והבית. ' +
    'כל תחנה חושפת ספרה אחת לכספת — פענחו את הקוד וחזרו הביתה לנצח.',
  mode: 'individual',
  scoringPreset: 'smart_weighted',
};

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

  // Vault must have been entered correctly → each team finished the final numeric.
  const states = await Promise.all(teams.map(({ p }) => p.call('getMyTeamState', { code: accessCode })));
  await auditRun({ creator, ownerUid, gameId, runId, states, audit });

  console.log(violations === 0
    ? '\n✅ הסימולציה עקבית — המשחק עובד מקצה לקצה (מסלול, חידות, קוד כספת, ניקוד).'
    : `\n❌ ${violations} הפרות עקביות`);
  process.exit(violations === 0 ? 0 : 1);
}

// ══════════════════════════════════════════════════════════════════════════════
// MODE: --seed — write the game as a LIVE run (join code SANSANA) for tonight.
// ══════════════════════════════════════════════════════════════════════════════
async function runSeed() {
  const admin = (await import('firebase-admin')).default;
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  admin.initializeApp({ projectId: PROJECT });
  const db = admin.firestore(), auth = admin.auth();

  const OWNER_UID = 'sansana-creator';
  const GAME_ID = 'sansana-treasure-map';
  const RUN_ID = 'sansana-run-tonight';
  const CODE = 'SANSANA';
  const now = new Date().toISOString();

  try {
    await auth.createUser({ uid: OWNER_UID, email: 'sansana@rushpoint.dev', password: 'test1234', displayName: 'Sansana Creator' });
  } catch (e) {
    const code = e?.errorInfo?.code ?? e?.code;
    if (code !== 'auth/uid-already-exists' && code !== 'auth/email-already-exists') throw e;
  }

  await db.doc(`users/${OWNER_UID}`).set({ uid: OWNER_UID, displayName: 'Sansana Creator', email: 'sansana@rushpoint.dev', createdAt: now }, { merge: true });
  await db.doc(`wallets/${OWNER_UID}`).set({
    uid: OWNER_UID, eventCredits: 5, lifetimeFreeRunsUsed: 0, bonusFreeRuns: 0,
    plan: 'free', proExpiresAt: null, stripeSubscriptionId: null, lastPackageMaxParticipants: 30, updatedAt: now,
  }, { merge: true });

  const stages = buildStages();
  const tags = ['סנסנה', 'לילה', 'חידות'];
  const game = {
    id: GAME_ID, ownerUid: OWNER_UID, ...GAME_META, stages,
    registrationFields: [{ id: 'teamName', label: 'שם הקבוצה', type: 'text', required: true, level: 'team' }],
    visibility: 'public', tags,
    approxLocation: { lat: LOC.home.lat, lng: LOC.home.lng, label: 'סנסנה' },
    playCount: 0, createdAt: now, updatedAt: now,
  };
  await db.doc(`users/${OWNER_UID}/games/${GAME_ID}`).set(game);

  // ── Publish to the public gallery (the "everyone's library" the user asked
  //    for): the denormalized publicGames card + a publicTasks library entry per
  //    task. Hidden-location tasks are published with NULL-ISLAND coords so the
  //    treasure-hunt spots never leak through the task library. ──
  const allTasks = stages.flatMap((s) => s.tasks);
  await db.doc(`publicGames/${GAME_ID}`).set({
    id: GAME_ID, ownerUid: OWNER_UID, ownerDisplayName: 'Sansana Creator',
    title: GAME_META.title, description: GAME_META.description, mode: GAME_META.mode,
    scoringPreset: GAME_META.scoringPreset, tags, approxLocation: game.approxLocation,
    playCount: 0, stageCount: stages.length, taskCount: allTasks.length,
    estimatedTotalMinutes: allTasks.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0),
    requirement: 'gps',
    createdAt: now, updatedAt: now,
  });
  const pb = db.batch();
  for (const t of allTasks) {
    pb.set(db.doc(`publicTasks/${GAME_ID}_${t.id}`), {
      id: `${GAME_ID}_${t.id}`, sourceGameId: GAME_ID, sourceGameTitle: GAME_META.title,
      ownerUid: OWNER_UID, ownerDisplayName: 'Sansana Creator',
      title: t.title, description: t.description ?? '', type: t.type,
      coordinates: t.hideLocation ? { lat: 0, lng: 0 } : t.coordinates,
      difficulty: t.difficulty, estimatedMinutes: t.estimatedMinutes, pointValue: t.pointValue,
      tags: t.tags ?? [], copyCount: 0, createdAt: now,
    });
  }
  await pb.commit();

  await db.doc(`users/${OWNER_UID}/games/${GAME_ID}/runs/${RUN_ID}`).set({
    id: RUN_ID, gameId: GAME_ID, ownerUid: OWNER_UID, status: 'live',
    accessCode: CODE, billingType: 'free', maxParticipants: 10, participantCount: 0,
    launchedAt: now, createdAt: now, updatedAt: now,
  });
  await db.doc(`accessCodes/${CODE}`).set({
    code: CODE, ownerUid: OWNER_UID, gameId: GAME_ID, runId: RUN_ID, status: 'unused', createdAt: now,
  });

  console.log('✅ נזרע המשחק "מפת האוצר של סנסנה" כ-run חי + פורסם לגלריה הציבורית.');
  console.log(`   קוד הצטרפות: ${CODE}`);
  console.log(`   שלבים: ${stages.length} · קוד כספת: ${VAULT_CODE}`);
  console.log('   מופיע כעת בספריית המשחקים של כולם (searchGallery / דף הגלריה).');
  console.log('   הצטרפו מהנייד עם הקוד SANSANA (הריצו npm run playtest:ngrok לקישור ציבורי).');
  process.exit(0);
}

(MODE === 'seed' ? runSeed() : runSimulate()).catch((e) => {
  console.error('\n💥 שגיאה:', e?.message ?? e);
  console.error(e);
  process.exit(1);
});
