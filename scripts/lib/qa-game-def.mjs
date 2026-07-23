// ═══════════════════════════════════════════════════════════════════════════════
// RushPoint — "מגרש הבדיקות" (QA Playground)
//
// A deliberately EXHAUSTIVE game whose only purpose is manual QA from a phone:
// every TaskType and every meaningful Task/Stage/Game option is represented at
// least once, so one play-through exercises the whole participant surface.
//
//   Every located task sits on ONE pin:  31.809413, 35.192348
//   Join code:  TESTALL
//
// Coverage map (task id → what it proves):
//   qa-checkin-radius   field · radius trigger · task media (image) · big radius
//   qa-instant          field · instant trigger (no GPS gate)
//   qa-selfreport       self_report · locationless
//   qa-quiz-choices     quiz · multiple choice
//   qa-quiz-text        quiz · typed answer · PAID hint + auto-escalation
//   qa-quiz-order       quiz · ordering variant (drag to sort)
//   qa-numeric          numeric · tolerance ±2
//   qa-numeric-presence numeric · requirePresence (must be at the pin)
//   qa-survey-choice    survey · choice buttons (no right answer)
//   qa-survey-text      survey · free text
//   qa-photo-review     photo · staff review queue (autoApprove OFF)
//   qa-photo-auto       photo · auto-approved (instant points, photo feed)
//   qa-audio            photo · captureKind 'audio' (voice recorder)
//   qa-smart-code       smart_station · secret code / QR scan (RP1:MAGIC77) · attempt limit
//   qa-youtube          self_report · YouTube media embed
//   qa-sequence         sequence · 3 ordered steps (2 answered, 1 tap-confirm)
//   qa-geofence         geofence · auto check-in inside 120 m
//   qa-hidden           field · hideLocation + locationClue (treasure-hunt, no pin)
//   qa-unlocked         field · unlockAfterTaskIds (locked until qa-sequence done)
//   qa-timed            self_report · releaseAfterMinutes (countdown) + expiry
//   qa-pick-a/b/c       stage requiredTaskCount = 2 (do any 2 of 3)
//   qa-alt-x / qa-alt-y exclusiveGroups (pick ONE — the other locks)
//   qa-final            numeric · final stage → Final screen
//
// Game-level: narrative chapters · "how to play" primer · power-ups · photo feed ·
// safe zone · instant play · all 5 registration field types (team + member level).
//
// Used by scripts/qa-game.mjs (--seed / --simulate) and re-seeded on every
// emulator boot by scripts/seed-local.mjs so it never disappears.
// ═══════════════════════════════════════════════════════════════════════════════

import { publicTaskLocation } from '@rushpoint/shared';

export const PROJECT = 'rushpoint-pwa-7daaa';

export const OWNER_UID = 'qa-creator';
export const GAME_ID = 'qa-playground';
export const RUN_ID = 'qa-run-open';
export const CODE = 'TESTALL';

/** The single pin every located task shares (requested for check-in testing). */
export const PIN = { lat: 31.809413, lng: 35.192348 };

/** smart_station secret code — also printable as the QR payload `RP1:MAGIC77`. */
export const STATION_CODE = 'MAGIC77';
export const FINAL_ANSWER = 2026;

export const GAME_META = {
  title: 'מגרש הבדיקות 🧪',
  description:
    'משחק QA שמכיל את כל סוגי המשימות וכל האפשרויות: צ׳ק-אין, תמונה, הקלטה, חידון, ' +
    'מספר, סקר, רצף, גיאופנס, תחנה חכמה עם קוד/QR, מיקום נסתר, נעילות, טיימרים ובחירה.',
  mode: 'team',
  scoringPreset: 'smart_weighted',
};

export const REGISTRATION_FIELDS = [
  { id: 'teamName', label: 'שם הקבוצה', type: 'text', required: true, level: 'team' },
  { id: 'teamSize', label: 'כמה אתם?', type: 'number', required: false, level: 'team' },
  { id: 'shirt', label: 'צבע חולצה', type: 'select', required: false, level: 'team',
    options: ['אדום', 'כחול', 'ירוק'] },
  { id: 'memberName', label: 'שם מלא', type: 'text', required: true, level: 'member' },
  { id: 'phone', label: 'טלפון', type: 'phone', required: false, level: 'member' },
  { id: 'waiver', label: 'אני מאשר/ת את תנאי המשחק', type: 'checkbox', required: false, level: 'member' },
];

export const INSTRUCTIONS = {
  title: 'איך משחקים',
  body: 'A QA playground: every task type in one game. Follow the app, it routes you.',
  bodyHe:
    'זהו משחק בדיקות. כל המשימות הממוקמות נמצאות באותה נקודה אחת במפה — ' +
    'אפשר לעמוד במקום ולעבור על כל סוגי המשימות בזו אחר זו.\n\n' +
    '• משימות צ׳ק-אין דורשות GPS · משימות "מכל מקום" לא.\n' +
    '• בתחנה החכמה הקוד הוא MAGIC77 (או סריקת QR).\n' +
    '• יש משימה עם רמז בתשלום, משימה נעולה, ומשימה שנפתחת אחרי דקה.',
};

// ── The game's stages ─────────────────────────────────────────────────────────
export function buildStages() {
  // Located task at the one pin.
  const at = (over) => ({
    coordinates: PIN, difficulty: 3, estimatedMinutes: 3, pointValue: 100,
    maxConcurrentTeams: 20, triggerMode: 'radius', geofenceRadiusMeters: 150, ...over,
  });
  // Play-from-anywhere task (no pin, no GPS gate).
  const anywhere = (over) => ({
    coordinates: { lat: 0, lng: 0 }, locationless: true, triggerMode: 'locationless',
    difficulty: 2, estimatedMinutes: 2, pointValue: 100, maxConcurrentTeams: 50, ...over,
  });

  return [
    // ── שלב 1 — צ׳ק-אין ומצבי הפעלה ──────────────────────────────────────────
    {
      id: 'qa-stage-checkin', order: 0, title: '📍 שלב 1 — צ׳ק-אין',
      narrative: {
        intro: {
          title: 'ברוכים הבאים למגרש הבדיקות',
          body: 'Every task type lives here. Nothing is real — break it on purpose.',
          bodyHe: 'כאן נבדק הכל. השלב הראשון: הגעה לנקודה, משימה מיידית ומשימה מכל מקום.',
        },
        outro: {
          title: 'שלב 1 הושלם',
          body: 'Check-ins work. On to the questions.',
          bodyHe: 'הצ׳ק-אין עובד. ממשיכים לשאלות.',
        },
      },
      tasks: [
        at({
          id: 'qa-checkin-radius', title: 'צ׳ק-אין בנקודה', type: 'field',
          description:
            'זו משימת הצ׳ק-אין הקלאסית. הגיעו לנקודה במפה (רדיוס 150 מ׳) ולחצו "בוצע".\n' +
            'הקואורדינטה: 31.809413, 35.192348',
          pointValue: 120,
          media: [{
            id: 'qa-media-img', kind: 'image',
            url: 'https://images.unsplash.com/photo-1544984243-ec57ea16fe25?w=800',
            caption: 'תמונה מצורפת למשימה (בדיקת מדיה)',
          }],
        }),
        at({
          id: 'qa-instant', title: 'משימה מיידית (ללא GPS)', type: 'field',
          triggerMode: 'instant', description:
            'triggerMode = instant — נפתחת מיד ואפשר לסמן "בוצע" בלי בדיקת מיקום.',
        }),
        anywhere({
          id: 'qa-selfreport', title: 'דיווח עצמי', type: 'self_report',
          description: 'משימת self_report מכל מקום: עשו 10 קפיצות ודווחו שסיימתם.',
        }),
      ],
    },

    // ── שלב 2 — כל סוגי השאלות ──────────────────────────────────────────────
    {
      id: 'qa-stage-answers', order: 1, title: '❓ שלב 2 — שאלות',
      tasks: [
        anywhere({
          id: 'qa-quiz-choices', title: 'חידון — בחירה מרובה', type: 'quiz',
          description: 'מה צבע השמיים ביום בהיר?',
          choices: ['כחול', 'ירוק', 'סגול', 'כתום'], answers: ['כחול'],
        }),
        anywhere({
          id: 'qa-quiz-text', title: 'חידון — תשובה חופשית + רמז בתשלום', type: 'quiz',
          description: 'מה שם הבירה של ישראל? (הקלידו את התשובה)',
          answers: ['ירושלים', 'jerusalem'],
          hint: 'הרמז: העיר שבה נמצאת הכנסת.',
          hintPenalty: 25,
          hintAutoRevealMinutes: 2,
          hintAutoRevealAttempts: 2,
          difficulty: 4,
        }),
        anywhere({
          id: 'qa-quiz-order', title: 'חידון — סדרו לפי הסדר', type: 'quiz',
          description: 'סדרו את ימות השבוע לפי הסדר הנכון.',
          orderItems: ['ראשון', 'שני', 'שלישי', 'רביעי'],
          difficulty: 4, pointValue: 130,
        }),
        anywhere({
          id: 'qa-numeric', title: 'מספר עם סובלנות ±2', type: 'numeric',
          description: 'כמה שחקנים יש בקבוצת כדורגל על המגרש? (מתקבל 9–13)',
          numericAnswer: 11, numericTolerance: 2,
        }),
        at({
          id: 'qa-numeric-presence', title: 'מספר — חובה להיות בנקודה', type: 'numeric',
          description:
            'requirePresence — התשובה תיבדק רק אם אתם באמת ליד הנקודה. ' +
            'כמה אצבעות יש בשתי ידיים?',
          numericAnswer: 10, numericTolerance: 0, requirePresence: true,
        }),
        anywhere({
          id: 'qa-survey-choice', title: 'סקר — בחירה', type: 'survey',
          description: 'איך מרגישה האפליקציה עד עכשיו? (אין תשובה נכונה)',
          surveyChoices: ['מעולה', 'בסדר', 'מבלבל', 'נתקעתי'], pointValue: 0,
        }),
        anywhere({
          id: 'qa-survey-text', title: 'סקר — טקסט חופשי', type: 'survey',
          description: 'ספרו במשפט אחד מה הכי בלט לכם עד כה.', pointValue: 0,
        }),
      ],
    },

    // ── שלב 3 — מדיה, תמונות, אודיו ותחנה חכמה ──────────────────────────────
    {
      id: 'qa-stage-media', order: 2, title: '📷 שלב 3 — מדיה ותחנות',
      tasks: [
        at({
          id: 'qa-photo-auto', title: 'תמונה — אישור אוטומטי', type: 'photo',
          description: 'צלמו כל דבר. התמונה תאושר מיד ותיכנס לפיד התמונות של הריצה.',
          smart: {
            enabled: true, verificationType: 'photo_upload', autoApprove: true,
            showIntroScreen: true, showSuccessScreen: true, allowRetry: true,
            longInstructionsHe: 'הוראות ארוכות: החזיקו את הטלפון לרוחב וצלמו את כל הקבוצה.',
          },
        }),
        at({
          id: 'qa-photo-review', title: 'תמונה — ממתינה לאישור צוות', type: 'photo',
          description:
            'autoApprove כבוי: התמונה נכנסת לתור אישור בקונסולת הצוות/היוצר. ' +
            'אישרו אותה משם כדי להמשיך.',
          pointValue: 150, difficulty: 4,
          smart: {
            enabled: true, verificationType: 'photo_upload', autoApprove: false,
            photoReviewRequired: true, showPendingReviewScreen: true, allowRetry: true,
          },
        }),
        at({
          id: 'qa-audio', title: 'הקלטת קול', type: 'photo',
          description: 'captureKind = audio — הקליטו את הקבוצה שרה שורה משיר.',
          smart: {
            enabled: true, verificationType: 'photo_upload',
            captureKind: 'audio', autoApprove: true, allowRetry: true,
          },
        }),
        at({
          id: 'qa-smart-code', title: 'תחנה חכמה — קוד סודי / QR', type: 'smart_station',
          description:
            'הזינו את הקוד שמופיע בתחנה, או סרקו את ה-QR. הקוד לבדיקה: MAGIC77 ' +
            '(ה-QR מקודד את המחרוזת RP1:MAGIC77). יש הגבלה של 5 ניסיונות.',
          pointValue: 150, difficulty: 5,
          smart: {
            enabled: true, verificationType: 'code_verification',
            hasCode: true, secretCode: STATION_CODE, codeInputLabel: 'קוד התחנה',
            attemptLimit: 5, allowRetry: true,
            showIntroScreen: true, showSuccessScreen: true, showFailureScreen: true,
            longInstructionsHe: 'חפשו את השלט עם הקוד. אפשר גם לסרוק את ה-QR מהמצלמה באפליקציה.',
          },
        }),
        anywhere({
          id: 'qa-youtube', title: 'משימה עם וידאו', type: 'self_report',
          description: 'צפו בקליפ המצורף ואז סמנו שסיימתם — בדיקת הטמעת YouTube.',
          media: [{
            id: 'qa-media-yt', kind: 'youtube',
            url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
            caption: 'וידאו מוטמע (בדיקת נגן)',
          }],
        }),
      ],
    },

    // ── שלב 4 — מנגנונים מתקדמים ────────────────────────────────────────────
    {
      id: 'qa-stage-advanced', order: 3, title: '🧩 שלב 4 — מנגנונים',
      exclusiveGroups: [{ id: 'qa-either-or', taskIds: ['qa-alt-x', 'qa-alt-y'] }],
      tasks: [
        at({
          id: 'qa-sequence', title: 'רצף שלבים באותה נקודה', type: 'sequence',
          description: 'שלושה שלבים בזה אחר זה — המשימה נסגרת רק אחרי האחרון.',
          pointValue: 160, difficulty: 5,
          steps: [
            { id: 'st1', prompt: 'שלב 1: כמה זה 3 × 7?', answer: '21' },
            { id: 'st2', prompt: 'שלב 2: הקיפו את הנקודה פעם אחת ולחצו אישור' },
            { id: 'st3', prompt: 'שלב 3: מה המילה הראשונה בשם המשחק?', answer: 'מגרש' },
          ],
        }),
        at({
          id: 'qa-geofence', title: 'גיאופנס אוטומטי (120 מ׳)', type: 'geofence',
          description: 'ברגע שאתם בתוך 120 מ׳ מהנקודה — המשימה מסתמנת אוטומטית.',
          geofenceRadiusMeters: 120,
        }),
        at({
          id: 'qa-hidden', title: 'מיקום נסתר — לכו לפי הרמז', type: 'field',
          hideLocation: true, geofenceRadiusMeters: 200,
          locationClue: 'No pin for this one — find the spot from the clue.',
          locationClueHe:
            'אין סיכה במפה. הנקודה היא בדיוק אותה נקודה של כל שאר המשימות — ' +
            'עמדו שם ולחצו "בוצע" (הרדיוס נדיב, 200 מ׳).',
          description: 'בדיקת מצב חיפוש-אוצר: המיקום מוסתר מהשחקן, השרת עדיין מאמת GPS.',
          pointValue: 140, difficulty: 4,
        }),
        at({
          id: 'qa-unlocked', title: 'משימה נעולה (נפתחת אחרי הרצף)', type: 'field',
          unlockAfterTaskIds: ['qa-sequence'],
          description: 'unlockAfterTaskIds — הופיעה כנעולה עד שסיימתם את משימת הרצף.',
        }),
        anywhere({
          id: 'qa-timed', title: 'משימה מתוזמנת (נפתחת אחרי דקה)', type: 'self_report',
          releaseAfterMinutes: 1, expiresAfterMinutes: 240,
          description:
            'releaseAfterMinutes = 1 — יש ספירה לאחור עד שהיא נפתחת, ' +
            'ו-expiresAfterMinutes = 240 מציג "פג תוקף בעוד…".',
        }),
        anywhere({
          id: 'qa-alt-x', title: 'אפשרות א׳ — בדיחה', type: 'self_report',
          description: 'בחרו אחת מהשתיים: ספרו בדיחה. אם תבחרו בזו — אפשרות ב׳ תינעל.',
        }),
        anywhere({
          id: 'qa-alt-y', title: 'אפשרות ב׳ — שיר', type: 'self_report',
          description: 'בחרו אחת מהשתיים: שירו שיר. אם תבחרו בזו — אפשרות א׳ תינעל.',
        }),
      ],
    },

    // ── שלב 5 — בחרו 2 מתוך 3 ───────────────────────────────────────────────
    {
      id: 'qa-stage-partial', order: 4, title: '🎯 שלב 5 — בחרו 2 מתוך 3',
      requiredTaskCount: 2,
      tasks: [
        anywhere({ id: 'qa-pick-a', title: 'אפשרות 1 — צילום מסך', type: 'self_report',
          description: 'requiredTaskCount = 2: מספיק לסיים שתיים מהשלוש והשלב ייסגר.' }),
        anywhere({ id: 'qa-pick-b', title: 'אפשרות 2 — סיבוב', type: 'self_report',
          description: 'requiredTaskCount = 2: מספיק לסיים שתיים מהשלוש והשלב ייסגר.' }),
        anywhere({ id: 'qa-pick-c', title: 'אפשרות 3 — מחיאות כפיים', type: 'self_report',
          description: 'requiredTaskCount = 2: מספיק לסיים שתיים מהשלוש והשלב ייסגר.' }),
      ],
    },

    // ── שלב 6 — הגמר ────────────────────────────────────────────────────────
    {
      id: 'qa-stage-final', order: 5, title: '🏁 שלב 6 — הגמר', isFinal: true,
      narrative: {
        intro: { title: 'המשימה האחרונה', bodyHe: 'עוד תשובה אחת וסיימתם את מגרש הבדיקות.' },
      },
      tasks: [
        at({
          id: 'qa-final', title: 'קוד סיום', type: 'numeric',
          description: `הזינו את השנה הנוכחית כדי לסיים (${FINAL_ANSWER}).`,
          numericAnswer: FINAL_ANSWER, numericTolerance: 0,
          pointValue: 200, difficulty: 5,
        }),
      ],
    },
  ];
}

// ── Seed the QA game as a LIVE run + gallery entry (Admin SDK). Idempotent. ──
export async function seedQaGame(admin, db, auth, now) {
  try {
    await auth.createUser({
      uid: OWNER_UID, email: 'qa@rushpoint.dev', password: 'test1234', displayName: 'QA Creator',
    });
  } catch (e) {
    const code = e?.errorInfo?.code ?? e?.code;
    if (code !== 'auth/uid-already-exists' && code !== 'auth/email-already-exists') throw e;
  }

  await db.doc(`users/${OWNER_UID}`).set(
    { uid: OWNER_UID, displayName: 'QA Creator', email: 'qa@rushpoint.dev', createdAt: now },
    { merge: true },
  );
  await db.doc(`wallets/${OWNER_UID}`).set({
    uid: OWNER_UID, eventCredits: 10, lifetimeFreeRunsUsed: 0, bonusFreeRuns: 0,
    plan: 'free', proExpiresAt: null, stripeSubscriptionId: null,
    lastPackageMaxParticipants: 30, updatedAt: now,
  }, { merge: true });

  const stages = buildStages();
  const tags = ['qa', 'בדיקות', 'כל-סוגי-המשימות'];
  const game = {
    id: GAME_ID, ownerUid: OWNER_UID, ...GAME_META, stages,
    registrationFields: REGISTRATION_FIELDS,
    instructions: INSTRUCTIONS,
    visibility: 'public', tags,
    approxLocation: { ...PIN, label: 'מגרש הבדיקות' },
    powerUpsEnabled: true,
    photoFeedEnabled: true,
    allowInstantPlay: true,
    manualLeaderboardReveal: false,
    safeZone: { center: PIN, radiusMeters: 5000 },
    playCount: 0, createdAt: now, updatedAt: now,
  };
  await db.doc(`users/${OWNER_UID}/games/${GAME_ID}`).set(game);

  // Public gallery card + task-library entries (hidden-location coords redacted).
  const allTasks = stages.flatMap((s) => s.tasks);
  await db.doc(`publicGames/${GAME_ID}`).set({
    id: GAME_ID, ownerUid: OWNER_UID, ownerDisplayName: 'QA Creator',
    title: GAME_META.title, description: GAME_META.description, mode: GAME_META.mode,
    scoringPreset: GAME_META.scoringPreset, tags, approxLocation: game.approxLocation,
    instructions: INSTRUCTIONS, allowInstantPlay: true,
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
      ownerUid: OWNER_UID, ownerDisplayName: 'QA Creator',
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
    accessCode: CODE, billingType: 'free', maxParticipants: 30, participantCount: 0,
    launchedAt: now, createdAt: now, updatedAt: now,
  }, { merge: true });
  await db.doc(`accessCodes/${CODE}`).set({
    code: CODE, ownerUid: OWNER_UID, gameId: GAME_ID, runId: RUN_ID,
    status: 'unused', createdAt: now,
  }, { merge: true });

  return { gameId: GAME_ID, code: CODE, stageCount: stages.length, taskCount: allTasks.length };
}
