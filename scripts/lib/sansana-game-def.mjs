// ═══════════════════════════════════════════════════════════════════════════════
// Shared definition of the Sansana night field-game "מפת האוצר של סנסנה".
// Imported by BOTH scripts/sansana-game.mjs (sim + standalone seed) and
// scripts/seed-local.mjs (so every fresh emulator boot seeds it → it is in the
// gallery "from now on"). Keep the game in ONE place so the two never drift.
// ═══════════════════════════════════════════════════════════════════════════════

import { publicTaskLocation } from '@rushpoint/shared';

export const PROJECT = 'rushpoint-pwa-7daaa';

export const OWNER_UID = 'sansana-creator';
export const GAME_ID = 'sansana-treasure-map';
export const RUN_ID = 'sansana-run-tonight';
export const CODE = 'SANSANA';

// ── Real Sansana coordinates ─────────────────────────────────────────────────
export const LOC = {
  home:      { lat: 31.364043, lng: 34.900706 }, // פרדס רימונים 10
  synagogue: { lat: 31.362156, lng: 34.900368 }, // בית הכנסת (כניסה לישוב)
  benDor:    { lat: 31.363144, lng: 34.902861 }, // פארק בן דור (שכונה א׳)
  heartPark: { lat: 31.362143, lng: 34.904173 }, // פארק הלב (מפת ארץ ישראל + תצפית)
};
const RADIUS = 70; // GPS geofence tolerance (m) — generous for phone jitter at night

// ── The vault code, one digit per station ────────────────────────────────────
// 4 = paws of the dog · 7 = chosen · 6 = swings in Ben-Dor · 3 = chosen
export const VAULT_CODE = 4763;

export const GAME_META = {
  title: 'מפת האוצר של סנסנה 🌙',
  description:
    'משחק שדה לילי בסנסנה: מסע חידות דרך פארק בן דור, בית הכנסת, פארק הלב והבית. ' +
    'כל תחנה חושפת ספרה אחת לכספת — פענחו את הקוד וחזרו הביתה לנצח.',
  mode: 'individual',
  scoringPreset: 'smart_weighted',
};

// ── The game's stages (identical for sim + real) ──────────────────────────────
export function buildStages() {
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

// ── Seed the game as a LIVE run + publish it to the public gallery (Admin SDK).
//    Idempotent (set/merge). Used by --seed and by seed-local's fresh-boot seed. ──
export async function seedSansana(admin, db, auth, now) {
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

  // Public gallery: the denormalized publicGames card + a publicTasks library
  // entry per task. Hidden-location tasks are published with NULL-ISLAND coords
  // so the treasure-hunt spots never leak through the task library.
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
    // publicTasks is world-readable: the coarse ~1 km AREA, never the authored
    // point, and NOTHING at all for a hidden / locationless / unplaced task
    // (change: public-task-area-visibility). The old `hideLocation ? {0,0}`
    // improvisation is gone — the shared rule already omits the field, and a
    // stored (0,0) is still a stored field the map would have to special-case.
    const approxLocation = publicTaskLocation(t);
    pb.set(db.doc(`publicTasks/${GAME_ID}_${t.id}`), {
      id: `${GAME_ID}_${t.id}`, sourceGameId: GAME_ID, sourceGameTitle: GAME_META.title,
      ownerUid: OWNER_UID, ownerDisplayName: 'Sansana Creator',
      title: t.title, description: t.description ?? '', type: t.type,
      ...(approxLocation ? { approxLocation } : {}),
      difficulty: t.difficulty, estimatedMinutes: t.estimatedMinutes, pointValue: t.pointValue,
      tags: t.tags ?? [], copyCount: 0, createdAt: now,
    });
  }
  await pb.commit();

  // Live run + join code.
  await db.doc(`users/${OWNER_UID}/games/${GAME_ID}/runs/${RUN_ID}`).set({
    id: RUN_ID, gameId: GAME_ID, ownerUid: OWNER_UID, status: 'live',
    accessCode: CODE, billingType: 'free', maxParticipants: 10, participantCount: 0,
    launchedAt: now, createdAt: now, updatedAt: now,
  });
  await db.doc(`accessCodes/${CODE}`).set({
    code: CODE, ownerUid: OWNER_UID, gameId: GAME_ID, runId: RUN_ID, status: 'unused', createdAt: now,
  });

  return { gameId: GAME_ID, code: CODE, stageCount: stages.length };
}
