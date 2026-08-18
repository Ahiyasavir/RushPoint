// One-off: seed the user's real exported .rushpoint.json template into the
// shared local emulator under a UNIQUE game id, so it never collides with
// another session's data. Runs extractQuickSetupSteps exactly like the admin
// action does, then writes the cleaned game + wizardSteps. Emulator only.
import fs from 'node:fs';
import admin from 'firebase-admin';
import { extractQuickSetupSteps } from '@rushpoint/shared';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
if (!/^(127\.0\.0\.1|localhost):/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('[real-template] refusing to run against a non-local Firestore.');
  process.exit(1);
}

admin.initializeApp({ projectId: 'rushpoint-pwa-7daaa' });
const db = admin.firestore();

const OWNER_UID = 'demo-creator';
const GAME_ID = 'demo-real-template-review';

const filePath = process.argv[2];
if (!filePath) {
  console.error('[real-template] usage: node scripts/seed-real-template-review.mjs "<path>"');
  process.exit(1);
}

const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const source = parsed.game ?? parsed;

// Demo-only content polish, not a code fix. This real export carries three
// copy problems that extraction alone cannot solve, so the demo game fixes them
// as DATA: two missions share the title "מצאו את המקום"; several missions'
// entire description was operator-only prose, so stripping it leaves the player
// with nothing; and two missions had their player text glued onto the note with
// no separator ("…נקודת הסיוםתבנו דגל"), so it went with the note.
const DUPLICATE_TITLE_FIX = {
  '50ba08c5-1417-4d3e-8bdb-1480d347e263': 'מצאו את המקום הראשון',
  'f0672f8a-8869-493f-aa79-552717147ea1': 'מצאו את המקום השני',
};
// A short, player-facing line for every mission whose cleaned description would
// otherwise be empty or truncated. The two photo puzzles also drop "קשה לזיהוי"
// (hard to identify), which pulled against the title's own promise that the
// place CAN be found — title and description now ask for the same thing.
const DESCRIPTION_FIX = {
  'e4ce4d0f-83c1-4274-983a-d1046eb6ad46': 'נפגשים כאן ויוצאים לדרך. כשכל הקבוצה כאן, המשחק מתחיל.',
  '50ba08c5-1417-4d3e-8bdb-1480d347e263': 'הביטו היטב בתמונה שצורפה למשימה, ונווטו אל המקום שהיא מציגה.',
  'f0672f8a-8869-493f-aa79-552717147ea1': 'הביטו היטב בתמונה שצורפה למשימה, ונווטו אל המקום שהיא מציגה.',
  'd1f81f77-b071-428e-bd33-5956142eda54': 'פענחו את רמז האימוג׳ים, הגיעו למקום שהוא מוביל אליו, וספרו כמה יש שם מהחפץ שברמז.',
  '30356fe1-0c41-4de7-981e-fe8fecf042df': 'צלמו מישהו עם בקבוק או פחית קולה.',
  '57f5bee0-b504-4f83-b858-fd5998115dd6': 'בנו דגל ישראל ענק מחפצים שאתם מוצאים בסביבה, וצלמו אותו.',
  'de2e96eb-47af-431f-ade3-6b6b18642cd8': 'נווטו אל נקודת הסיום של המירוץ.',
  // Two source typos, fixed here for the same reason: 'בורחים!הקבוצה' lost the
  // space between two sentences, and 'כתט' should read 'כתב'.
  'ab526845-400d-4caf-b989-7bbb6738a102': 'עצרו הכל! אתם בסצנת שיא של סרט פעולה: הרגע חילצתם חבר משוטרים, ועכשיו אתם בורחים! הקבוצה כולה חייבת ליצור תמונה קפואה (Freeze Frame) של רגע הבריחה. תהיו יצירתיים: מי מרים את החבר המחולץ? מי מסתכל אחורה בפחד? מי צועק "קדימה לרוץ!"?',
  'aec0cc7f-902b-4b28-bab0-d1679a54a32b': 'אחד מכם הוא כתב טלוויזיה שמדווח "בשידור חי" על אירוע מוזר שקרה עכשיו במקום! השאר משמשים כניצבים, עוברי אורח מזועזעים, או גיבורי האירוע. יש לכם 40 שניות לכתבה מלאה עם פתיחה וסיום!',
};
// The emoji riddle's clue still carried its own authoring placeholders
// ("[הכנס אימוג'ים כאן]", "[חפץ כלשהו במיקום…]"). Those brackets name no
// operator, so nothing strips them, and a player would read them verbatim.
const CLUE_FIX = {
  'd1f81f77-b071-428e-bd33-5956142eda54': 'פצחו את צופן האימוג׳ים כדי לגלות לאן לרוץ. כשתגיעו, ספרו כמה יש שם מהחפץ שברמז, והקלידו את המספר המדויק.',
};
const now = new Date().toISOString();

// Extract FIRST, then rewrite: the notes are what produce the setup steps, so
// replacing a note-only description before extraction would leave that mission
// with clean copy and no step at all — exactly the missions that most need one.
const extraction = extractQuickSetupSteps(source);
for (const stage of extraction.stages ?? []) {
  for (const t of stage.tasks ?? []) {
    if (DUPLICATE_TITLE_FIX[t.id]) t.title = DUPLICATE_TITLE_FIX[t.id];
    if (DESCRIPTION_FIX[t.id]) t.description = DESCRIPTION_FIX[t.id];
    if (CLUE_FIX[t.id]) t.locationClue = CLUE_FIX[t.id];
  }
}

// The extracted `instructionPrompt` is the ORIGINAL operator note verbatim —
// several clauses long, still carrying its own self-destruct ("מחקו את הפסקה
// הזו"), and repeated in full on every field it touched (one note naming a
// location, an answer and a hint produces three steps that all quote the whole
// note). Demo-only: replace each with a short, single-purpose line, keyed by the
// exact (mission, field) it targets so a step this map does not name is left as
// extraction produced it, never silently dropped.
const SHORT_INSTRUCTION = {
  'e4ce4d0f-83c1-4274-983a-d1046eb6ad46|coordinates': 'סמנו על המפה את נקודת ההתחלה של המשחק.',
  'ca238dc1-7b54-4f1c-98e9-da568f592709|smart.autoApprove': 'בחרו אם לאשר את הסרטונים אוטומטית או לבדוק כל אחד בעצמכם.',
  'd7246fc2-7572-49fa-a2c2-0c78365b3545|coordinates': 'אפשר לקבוע למשימה מיקום, או להשאיר אותה פתוחה מכל מקום.',
  '50ba08c5-1417-4d3e-8bdb-1480d347e263|media': 'צרפו תמונת תקריב של המקום, מסקרנת אך פתירה.',
  '50ba08c5-1417-4d3e-8bdb-1480d347e263|coordinates': 'סמנו על המפה את המקום שבתמונה.',
  'd1f81f77-b071-428e-bd33-5956142eda54|coordinates': 'סמנו על המפה את המקום שהחידה מובילה אליו.',
  'd1f81f77-b071-428e-bd33-5956142eda54|numericAnswer': 'ספרו כמה יש במקום מהחפץ שברמז, וזו התשובה.',
  'd1f81f77-b071-428e-bd33-5956142eda54|hint': 'כתבו רמז אימוג׳ים שמוביל למקום, למשל: 🌳🪑📖.',
  'aec0cc7f-902b-4b28-bab0-d1679a54a32b|coordinates': 'בחרו מיקום מעניין שמתאים לכתבה.',
  '30356fe1-0c41-4de7-981e-fe8fecf042df|coordinates': 'בחרו מיקום עם הרבה אנשים, או השאירו את המשימה פתוחה מכל מקום.',
  'ed4957e5-6e80-4602-82b6-96333df1c1bc|coordinates': 'בחרו מיקום הומה אדם, כדי שיהיה קל למצוא מי שיעזור.',
  'f0672f8a-8869-493f-aa79-552717147ea1|media': 'צרפו תמונת תקריב של מקום אחר, מסקרנת אך פתירה.',
  'f0672f8a-8869-493f-aa79-552717147ea1|coordinates': 'סמנו על המפה את המקום שבתמונה.',
  '056bfda6-4cdc-4afd-bd83-f2e79ba0fb02|coordinates': 'בחרו מיקום עם הרבה אנשים.',
  '056bfda6-4cdc-4afd-bd83-f2e79ba0fb02|smart.autoApprove': 'בחרו אם לאשר את התמונות אוטומטית או לבדוק כל אחת בעצמכם.',
  '57f5bee0-b504-4f83-b858-fd5998115dd6|media': 'אפשר לצרף תמונת דוגמה, כדי להראות מה מצפים לקבל.',
  '57f5bee0-b504-4f83-b858-fd5998115dd6|coordinates': 'המשימה פתוחה מכל מקום. רוצים לקבע אותה? סמנו מיקום על המפה.',
  'de2e96eb-47af-431f-ade3-6b6b18642cd8|coordinates': 'סמנו על המפה את נקודת הסיום של המשחק.',
};
for (const step of extraction.wizardSteps) {
  const short = SHORT_INSTRUCTION[`${step.taskId}|${step.targetFieldPath}`];
  if (short) step.instructionPrompt = short;
}

const game = {
  ...source,
  id: GAME_ID,
  ownerUid: OWNER_UID,
  stages: extraction.stages,
  ...(extraction.instructions ? { instructions: extraction.instructions } : {}),
  wizardSteps: extraction.wizardSteps,
  visibility: 'private',
  playCount: 0,
  createdAt: now,
  updatedAt: now,
};

await db.doc(`users/${OWNER_UID}/games/${GAME_ID}`).set(game);
console.log(`[real-template] wrote users/${OWNER_UID}/games/${GAME_ID}`);
console.log(`[real-template] ${extraction.wizardSteps.length} quick setup step(s) extracted:`);
for (const s of extraction.wizardSteps) {
  console.log(`  · ${s.isRequired ? 'REQUIRED' : 'optional'}  ${s.targetFieldPath.padEnd(20)}  ${s.instructionPrompt.slice(0, 70)}`);
}
process.exit(0);
