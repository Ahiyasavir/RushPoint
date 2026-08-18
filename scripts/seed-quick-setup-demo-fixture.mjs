// Ad-hoc demo fixture for showing off the redesigned הקמה מהירה / Quick Setup UX
// (welcome card, context cards, own-voice bar, "explain then place" ordering,
// celebration). Builds a small game carrying REAL operator notes in its prose
// (the shape a real exported template ships), then runs it through
// `extractQuickSetupSteps` exactly like the admin action does, and writes the
// cleaned result to the demo creator. Emulator only.
import admin from 'firebase-admin';
import { extractQuickSetupSteps } from '@rushpoint/shared';

const PROJECT_ID = 'rushpoint-pwa-7daaa';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
if (!/^(127\.0\.0\.1|localhost):/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('[qs-demo] refusing to run against a non-local Firestore.');
  process.exit(1);
}

const OWNER_UID = 'demo-creator';
const GAME_ID = 'demo-game-quicksetup-review';

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const now = new Date().toISOString();

const source = {
  id: GAME_ID,
  ownerUid: OWNER_UID,
  title: 'ציד האוצר של הרובע העתיק',
  description: 'משחק שטח למשפחות ולקבוצות ברחבי הרובע העתיק',
  mode: 'team',
  scoringPreset: 'smart_weighted',
  registrationFields: [],
  visibility: 'private',
  tags: [],
  playCount: 0,
  createdAt: now,
  updatedAt: now,
  instructions: {
    title: 'ברוכים הבאים',
    bodyHe: '[הערת מפעיל - למחוק/התאימו לפי הצורך]: המשחק נפתח בנקודת התחלה משותפת ליד השער. ודאו שיש שילוט ברור.',
  },
  stages: [
    {
      id: 'st1', order: 0, title: 'שלב 1: השער העתיק',
      tasks: [
        {
          id: 't1', title: 'מצאו את השער', type: 'field',
          description: '[הערת מפעיל - למחוק]: הגדירו את המיקום בשלב 1 וצרפו תמונה תקריב (קלוז-אפ) של השער. נווטו אל שער יפו וצלמו את הקבוצה מולו.',
          coordinates: { lat: 0, lng: 0 },
          difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 5,
        },
        {
          id: 't2', title: 'חידת הסוחר', type: 'quiz',
          description: 'שאלו את אחד הסוחרים בשוק מה השם העתיק של הרחוב, ובחרו את התשובה הנכונה.',
          answers: ['(ערכו את התשובה) / (edit this answer)'],
          coordinates: { lat: 31.7767, lng: 35.2280 },
          difficulty: 6, estimatedMinutes: 8, pointValue: 120, maxConcurrentTeams: 5,
        },
      ],
    },
    {
      id: 'st2', order: 1, title: 'שלב 2: תחנת האימות', isFinal: true,
      tasks: [
        {
          id: 't3', title: 'תחנת הקוד הסודי', type: 'smart_station',
          description: '[הוראות למפעיל - למחוק]: הוסיפו את נקודת הסיום במפה במערכת, ולאחר הקריאה מחקו את הפסקה הזו.לאישור ידני, כבו אישור אוטומטי בביצוע ותוספות.מצאו את השומר בכיכר המרכזית וקבלו ממנו קוד.',
          smart: { enabled: true, verificationType: 'code', autoApprove: true },
          coordinates: { lat: 0, lng: 0 },
          difficulty: 7, estimatedMinutes: 12, pointValue: 150, maxConcurrentTeams: 3,
        },
      ],
    },
  ],
};

const extraction = extractQuickSetupSteps(source);

const game = {
  ...source,
  stages: extraction.stages,
  ...(extraction.instructions ? { instructions: extraction.instructions } : {}),
  wizardSteps: extraction.wizardSteps,
};

await db.doc(`users/${OWNER_UID}/games/${GAME_ID}`).set(game);

console.log(`[qs-demo] wrote users/${OWNER_UID}/games/${GAME_ID}`);
console.log(`[qs-demo] ${extraction.wizardSteps.length} quick setup step(s):`);
for (const s of extraction.wizardSteps) {
  console.log(`  · ${s.isRequired ? 'REQUIRED' : 'optional'}  ${s.targetFieldPath.padEnd(18)}  ${s.instructionPrompt.slice(0, 80)}`);
}
process.exit(0);
