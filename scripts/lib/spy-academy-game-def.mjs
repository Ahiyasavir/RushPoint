// ═══════════════════════════════════════════════════════════════════════════════
// RushPoint — FLAGSHIP instant-play demo: "אקדמיית הסוכנים" (The Pocket Spy Academy)
//
// This is the FACE of the app. A first time visitor taps "נסה משחק לדוגמה" /
// "Try a sample game" and lands straight inside this game: solo, free, anonymous,
// from anywhere on earth, in seconds — no organizer, no staff, no GPS, no map, no
// review queue, nothing that blocks on another human.
//
// It launches through the existing `startInstantPlay` callable, which requires the
// game to be PUBLISHED to publicGames with `allowInstantPlay: true` and NOT
// `requiresGuardianConsent` (instant-play refuses consent gated games). Every task
// is `locationless` (triggerMode 'locationless') and every photo task is
// `autoApprove: true`, so the whole experience is staffless and self-guiding.
//
// A light spy-academy narrative wraps it: you are a fresh recruit earning full
// clearance across three short missions. Quick wins early, two optional paid
// hints on the trickier stops, a satisfying auto-approved "agent ID" selfie, and
// a final vault code. Gentle throughout and always winnable.
//
// The invariants that make all of the above true are pinned by
// scripts/test-flagship-demo.ts (pure, in `npm test`). Seeded on every emulator
// boot by scripts/seed-local.mjs (idempotent), and it is what the creator landing
// page's demo button points at.
// ═══════════════════════════════════════════════════════════════════════════════

import { publicTaskLocation } from '@rushpoint/shared';

export const PROJECT = 'rushpoint-pwa-7daaa';

export const OWNER_UID = 'demo-spy-academy';
export const GAME_ID = 'demo-instant-spy';
export const RUN_ID = 'demo-spy-open';
export const CODE = 'AGENT007';
export const OWNER_DISPLAY_NAME = 'RushPoint';

export const GAME_META = {
  title: 'אקדמיית הסוכנים 🕵️',
  description:
    'התקבלתם לאקדמיית הסוכנים החשאית. שלוש משימות, דרגת חיסיון אחת, וכוס קפה שמתקררת. ' +
    'הוכיחו שיש לכם את זה, מכל מקום בעולם.\n\n' +
    'Welcome to the secret Agent Academy. Three missions, one security clearance, and a ' +
    'coffee going cold. Prove you have what it takes, from anywhere on earth.',
  mode: 'individual',
  scoringPreset: 'smart_weighted',
};

export const INSTRUCTIONS = {
  title: 'תדריך פתיחה',
  body:
    'You are a fresh recruit. Answer, solve, and snap your way to full clearance. Every ' +
    'mission plays from your chair, no map needed. A hint costs a few points, but it can ' +
    'rescue a stuck agent.',
  bodyHe:
    'אתם מגויסים טריים. עונים, פותרים ומצלמים בדרך לדרגת חיסיון מלאה. כל משימה משוחקת ' +
    'מהכיסא, בלי מפה. רמז עולה כמה נקודות, אבל הוא מציל סוכן תקוע.',
};

export const REGISTRATION_FIELDS = [
  { id: 'teamName', label: 'שם הסוכן', type: 'text', required: true, level: 'team' },
];

// ── The game's stages ─────────────────────────────────────────────────────────
export function buildStages() {
  // Every task plays from anywhere: locationless, no map pin, no GPS gate, zero
  // transit in routing. Null island coordinates are the "not placed" sentinel.
  const anywhere = (over) => ({
    coordinates: { lat: 0, lng: 0 }, locationless: true, triggerMode: 'locationless',
    difficulty: 2, estimatedMinutes: 2, pointValue: 100, maxConcurrentTeams: 500, ...over,
  });

  return [
    // ── שלב 1 — גיוס: ניצחונות מהירים כדי להתחמם ───────────────────────────────
    {
      id: 'spy-stage-recruit', order: 0, title: 'גיוס 🎖️',
      narrative: {
        intro: {
          title: 'ברוכים הבאים לאקדמיה',
          body: 'Badge in hand. Two quick checks and you are on the roster. Move, recruit.',
          bodyHe: 'התג בידיים. שתי בדיקות מהירות ואתם ברשימה. קדימה, מגויסים.',
        },
        outro: {
          title: 'גויסתם',
          body: 'Basics cleared. Field training is where it gets fun.',
          bodyHe: 'היסודות מאחוריכם. באימון השטח מתחיל הכיף.',
        },
      },
      tasks: [
        anywhere({
          id: 'spy-quiz-intro', title: 'מבחן הקבלה 🧠', type: 'quiz',
          description:
            'מה הכלי הכי חשוב בערכה של סוכן טוב?\n\n' +
            'What is the most important tool in a good agent’s kit?',
          choices: ['🧠 שכל ישר / A sharp mind', '🕶️ משקפי שמש / Sunglasses', '🧦 גרביים תואמות / Matching socks'],
          answers: ['🧠 שכל ישר / A sharp mind'],
          difficulty: 1, pointValue: 100, estimatedMinutes: 1,
        }),
        anywhere({
          id: 'spy-codename', title: 'שם הקוד שלכם 🏷️', type: 'self_report',
          description:
            'המציאו לעצמכם שם קוד ואמרו אותו בקול משכנע. סוכן בלי שם קוד הוא סתם אדם עם סוד.\n\n' +
            'Invent a codename and say it out loud, with conviction. An agent without a ' +
            'codename is just a person with a secret.',
          difficulty: 1, pointValue: 100, estimatedMinutes: 1,
        }),
      ],
    },

    // ── שלב 2 — אימון שטח: חידה, פיצוח קוד, ונטרול מנגנון ──────────────────────
    {
      id: 'spy-stage-field', order: 1, title: 'אימון שטח 🧭',
      narrative: {
        intro: {
          title: 'אימון שטח',
          body: 'Three drills. Stuck on one? A hint is a tap away, for a small price.',
          bodyHe: 'שלושה תרגילים. נתקעתם? רמז במרחק הקשה אחת, במחיר קטן.',
        },
      },
      tasks: [
        anywhere({
          id: 'spy-riddle-echo', title: 'חידת ההד 🔊', type: 'quiz',
          description:
            'מדבר בלי פה, שומע בלי אוזניים, נולד מהרים ומת בשקט. מי אני? (הקלידו את התשובה)\n\n' +
            'Speaks without a mouth, hears without ears, born from mountains, dies in ' +
            'silence. What am I? (type your answer)',
          answers: ['הד', 'echo', 'אקו', 'an echo'],
          hint: 'תצעקו בקניון ריק ותקשיבו למה שחוזר. / Shout in an empty canyon and listen to what comes back.',
          hintPenalty: 20, hintAutoRevealAttempts: 3, hintAutoRevealMinutes: 3,
          difficulty: 4, pointValue: 140, estimatedMinutes: 2,
        }),
        anywhere({
          id: 'spy-vault-math', title: 'פיצוח הכספת 🔢', type: 'numeric',
          description:
            'צירוף הכספת = מספר הרגליים של עכביש, ועוד מספר הימים בשבוע. מה הצירוף?\n\n' +
            'The vault combination = a spider’s number of legs, plus the number of ' +
            'days in a week. What is it?',
          numericAnswer: 15, numericTolerance: 0,
          hint: 'עכביש: 8 רגליים. שבוע: 7 ימים. / Spider: 8 legs. Week: 7 days.',
          hintPenalty: 15, hintAutoRevealAttempts: 3,
          difficulty: 3, pointValue: 130, estimatedMinutes: 2,
        }),
        anywhere({
          id: 'spy-defuse', title: 'נטרול המנגנון 🧨', type: 'sequence',
          description:
            'שלושה צעדים לפי הסדר. אל תזוזו עד שהמנגנון נוטרל.\n\n' +
            'Three steps, in order. Do not move until the mechanism is disarmed.',
          difficulty: 4, pointValue: 160, estimatedMinutes: 3,
          steps: [
            {
              id: 'spy-defuse-1',
              prompt: 'צעד 1: חברו את החוט הכחול. הקישו אישור. / Step 1: connect the blue wire. Tap confirm.',
            },
            {
              id: 'spy-defuse-2',
              prompt: 'צעד 2: הקלידו את מילת הקוד: protocol / Step 2: type the code word: protocol',
              answer: 'protocol',
            },
            {
              id: 'spy-defuse-3',
              prompt: 'צעד 3: קחו נשימה עמוקה והקישו לנטרול סופי. / Step 3: take a deep breath and tap to disarm.',
            },
          ],
        }),
      ],
    },

    // ── שלב 3 — המשימה הסופית: דעה, תעודת סוכן, וקוד סיום ──────────────────────
    {
      id: 'spy-stage-final', order: 2, title: 'המשימה הסופית 🏆', isFinal: true,
      narrative: {
        intro: {
          title: 'המשימה הסופית',
          body: 'Last stretch, agent. Pick your gear, get your ID photo, crack the code.',
          bodyHe: 'הישורת האחרונה, סוכן. בחרו ציוד, צלמו תעודה, פצחו את הקוד.',
        },
      },
      tasks: [
        anywhere({
          id: 'spy-gadget', title: 'בחירת גאדג’ט 🎒', type: 'survey',
          description:
            'אין תשובה נכונה: איזה גאדג’ט תיקחו למשימה?\n\n' +
            'No wrong answer: which gadget do you take on the mission?',
          surveyChoices: [
            '🚁 רחפן כיס / Pocket drone',
            '👞 נעל עם וו קרס / Grappling shoe',
            '⌚ שעון לייזר / Laser watch',
            '🐈 חתול ריגול / Spy cat',
          ],
          difficulty: 1, pointValue: 60, estimatedMinutes: 1,
        }),
        anywhere({
          id: 'spy-id-photo', title: 'תעודת סוכן 📸', type: 'photo',
          description:
            'צלמו סלפי בתנוחת הסוכן הכי מגניבה שלכם. התמונה מאושרת אוטומטית, בלי המתנה.\n\n' +
            'Snap a selfie in your coolest secret agent pose. The photo is auto approved, ' +
            'no waiting.',
          difficulty: 2, pointValue: 150, estimatedMinutes: 2,
          smart: {
            enabled: true, verificationType: 'photo_upload', autoApprove: true,
            showIntroScreen: true, showSuccessScreen: true, allowRetry: true,
          },
        }),
        anywhere({
          id: 'spy-final-code', title: 'קוד החיסיון הסופי 🔐', type: 'numeric',
          description:
            'דרגת חיסיון אחרונה: לסוכן הסודי הכי מפורסם בעולם יש שם קוד שרובו אפסים, ' +
            'חוץ מספרה אחת. הקלידו רק את הספרה הזו.\n\n' +
            'Final clearance: the world’s most famous secret agent has a codename that’s ' +
            'mostly zeros, except for one digit. Type just that digit.',
          numericAnswer: 7, numericTolerance: 0,
          hint: 'הרמז: 007. בונד, ג׳יימס בונד. הקלידו את הספרה שהיא לא אפס. / 007. Bond, James Bond. Type the digit that isn’t a zero.',
          hintPenalty: 25, hintAutoRevealAttempts: 3,
          difficulty: 3, pointValue: 200, estimatedMinutes: 1,
        }),
      ],
    },
  ];
}

/**
 * The full private game-template document (users/{owner}/games/{gameId}).
 * Exported so the pure test can assert the instant-play + consent flags without
 * an emulator, and so the seeder writes exactly what the test verified.
 */
export function buildFlagshipGame(now) {
  const stages = buildStages();
  return {
    id: GAME_ID, ownerUid: OWNER_UID, ...GAME_META, stages,
    registrationFields: REGISTRATION_FIELDS,
    instructions: INSTRUCTIONS,
    visibility: 'public',
    tags: ['דמו', 'מכל-מקום', 'ריגול', 'משפחה', 'spy'],
    approxLocation: { lat: 32.0853, lng: 34.7818, label: 'מכל מקום / Anywhere' },
    allowInstantPlay: true,
    photoFeedEnabled: true,
    manualLeaderboardReveal: false,
    playCount: 0, createdAt: now, updatedAt: now,
  };
}

// ── Seed the flagship demo as a gallery-published, instant-play game (Admin SDK).
//    Idempotent (set/merge). Publishes publicGames (allowInstantPlay:true) + a
//    publicTasks library entry per task, and a stand-by live run + join code.
//    Instant-play mints its OWN run per player, so the seeded run is just a bonus
//    for anyone who prefers a join code. ──
export async function seedSpyAcademy(admin, db, auth, now) {
  try {
    await auth.createUser({
      uid: OWNER_UID, email: 'academy@rushpoint.dev', password: 'test1234',
      displayName: OWNER_DISPLAY_NAME,
    });
  } catch (e) {
    const code = e?.errorInfo?.code ?? e?.code;
    if (code !== 'auth/uid-already-exists' && code !== 'auth/email-already-exists') throw e;
  }

  await db.doc(`users/${OWNER_UID}`).set(
    { uid: OWNER_UID, displayName: OWNER_DISPLAY_NAME, email: 'academy@rushpoint.dev', createdAt: now },
    { merge: true },
  );
  await db.doc(`wallets/${OWNER_UID}`).set({
    uid: OWNER_UID, eventCredits: 5, lifetimeFreeRunsUsed: 0, bonusFreeRuns: 0,
    plan: 'free', proExpiresAt: null, stripeSubscriptionId: null,
    lastPackageMaxParticipants: 30, updatedAt: now,
  }, { merge: true });

  const game = buildFlagshipGame(now);
  const stages = game.stages;
  await db.doc(`users/${OWNER_UID}/games/${GAME_ID}`).set(game);

  // Public gallery card + task-library entries. Every task is locationless, so
  // publicTaskLocation() returns undefined for all of them and the `approxLocation`
  // field is omitted — correct, and what keeps them off the library map.
  const allTasks = stages.flatMap((s) => s.tasks);
  await db.doc(`publicGames/${GAME_ID}`).set({
    id: GAME_ID, ownerUid: OWNER_UID, ownerDisplayName: OWNER_DISPLAY_NAME,
    title: game.title, description: game.description, mode: game.mode,
    scoringPreset: game.scoringPreset, tags: game.tags, approxLocation: game.approxLocation,
    instructions: INSTRUCTIONS, allowInstantPlay: true,
    playCount: 0, stageCount: stages.length, taskCount: allTasks.length,
    estimatedTotalMinutes: allTasks.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0),
    // All tasks are locationless/instant → playable anywhere. Mirrors
    // describeGameRequirements() so the "playable anywhere" badge renders.
    requirement: 'anywhere',
    createdAt: now, updatedAt: now,
  });
  const pb = db.batch();
  for (const t of allTasks) {
    const approxLocation = publicTaskLocation(t); // undefined for every locationless task
    pb.set(db.doc(`publicTasks/${GAME_ID}_${t.id}`), {
      id: `${GAME_ID}_${t.id}`, sourceGameId: GAME_ID, sourceGameTitle: game.title,
      ownerUid: OWNER_UID, ownerDisplayName: OWNER_DISPLAY_NAME,
      title: t.title, description: t.description ?? '', type: t.type,
      ...(approxLocation ? { approxLocation } : {}),
      difficulty: t.difficulty, estimatedMinutes: t.estimatedMinutes, pointValue: t.pointValue,
      tags: t.tags ?? [], copyCount: 0, createdAt: now,
    });
  }
  await pb.commit();

  // Stand-by live run + join code (instant-play does not need it, but it keeps a
  // join code working for anyone who wants one).
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
