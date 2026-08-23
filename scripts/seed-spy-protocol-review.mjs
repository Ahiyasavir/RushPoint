// One-off: seed the user's real exported "פרוטוקול האפלה" .rushpoint.json
// template into the shared local emulator under a UNIQUE game id, so it never
// collides with another session's data. Runs extractQuickSetupSteps exactly
// like the admin action does, then writes the cleaned game + wizardSteps.
// Emulator only.
import fs from 'node:fs';
import admin from 'firebase-admin';
import { extractQuickSetupSteps } from '@rushpoint/shared';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
if (!/^(127\.0\.0\.1|localhost):/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('[spy-protocol] refusing to run against a non-local Firestore.');
  process.exit(1);
}

admin.initializeApp({ projectId: 'rushpoint-pwa-7daaa' });
const db = admin.firestore();

const OWNER_UID = 'demo-creator';
const GAME_ID = 'demo-spy-protocol-review';

const filePath = process.argv[2];
if (!filePath) {
  console.error('[spy-protocol] usage: node scripts/seed-spy-protocol-review.mjs "<path>"');
  process.exit(1);
}

const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const source = parsed.game ?? parsed;
const now = new Date().toISOString();

// Extract FIRST, then rewrite: the notes are what produce the setup steps, so
// replacing a note only description before extraction would leave that
// mission with clean copy and no step at all, exactly the missions that most
// need one.
const extraction = extractQuickSetupSteps(source);

// The pre field primer (instructions.bodyHe, shown to PLAYERS under "לפני
// שיוצאים לשטח") is a genuine content bug in this export, not just a leftover
// note: extraction only strips the bracket TAG when it detects an "adapt"
// hint (the word "התאימו"), and this primer's opening bracket carries exactly
// that word. So the note test correctly kept going past the tag, but the
// paragraph it kept is entirely CREATOR planning text (how many locations to
// configure, which tasks share a location) with no player facing content in
// it at all. That is invisible to a text search for "delete this" markers,
// because the author never asked anyone to delete it, only to adapt it, and
// what an "adapt" note protects is exactly what a template's real briefing
// text looks like elsewhere. Replaced with a short, real, in character
// briefing instead.
const GAME_PRIMER_BODY = [
  'לפני שיוצאים לשטח, כמה כללים מהצופה.',
  'תתנהגו כמו קבוצת נוער רגילה במשחק שדה. בלי לרוץ בטירוף, בלי להסתכן, ובלי להטריד מישהו שלא רוצה לדבר איתכם.',
  'אם מישהו לא רוצה לענות, מוותרים בנימוס וממשיכים הלאה.',
  'קראו כל הודעה עד הסוף לפני שאתם זזים. פרטים קטנים כאן חשובים.',
  'שעון עצר רץ ברקע. הוא לא עוצר בשבילכם.',
].join('\n\n');
if (extraction.instructions) {
  extraction.instructions = { ...extraction.instructions, bodyHe: GAME_PRIMER_BODY };
}

// Two more fields extraction never looks at at all: `locationClue` and
// `smart.longInstructions`. Both are PLAYER facing (the clue is the riddle
// text; longInstructions is what a smart_station shows while a team is
// solving it), so a leftover operator bracket in either one ships straight to
// a player's screen with no step ever raised for it. Fixed as plain copy,
// keyed by task id, same as every other override in this script.
const LOCATION_CLUE_FIX = {
  'd0000000-0000-4000-8000-000000000032': 'לכו אל הכיכר המרכזית.',
  'd0000000-0000-4000-8000-000000000033': 'לכו אל הגן הציבורי הקרוב.',
};
const LONG_INSTRUCTIONS_FIX = {
  // Matches the existing secretCode "27": two statues, seven benches. Picked
  // as a concrete, playable example rather than left as bracketed prose, the
  // same reasoning as every DESCRIPTION_FIX below.
  'd0000000-0000-4000-8000-000000000032': 'כמה פסלים יש כאן? זו הספרה הראשונה.\nכמה ספסלים יש כאן? זו הספרה השנייה.\nחברו את שתי הספרות לפי הסדר הזה.',
};

// Six missions whose cleaned description would otherwise be wrong, not just
// noisy: the extractor's sentence walker stops at the first sentence that
// does not read as an operator note, so a long note that later uses
// authoring vocabulary its own keyword list does not cover ("ביצוע ותוספות",
// "קוד סודי", "הגדרות מתקדמות") leaves everything AFTER that sentence stuck
// to the player text. Rather than widen the keyword list (an algorithm
// change, out of scope for a copy fix), each of these six gets its full,
// correct player facing text written out directly.
const DESCRIPTION_FIX = {
  'd0000000-0000-4000-8000-000000000025': 'המניפסט המקורי של ARCHIVE POINT פוצל בכוונה לשלושה חלקים. פתרו אותם לפי הסדר, ותגלו מה באמת נשבעו לשמור.',
  'd0000000-0000-4000-8000-000000000021': 'המסירה מחכה כאן. אל תרוצו אליה ישר. תראו כמו קבוצה שמסתובבת סתם, לא כמו קבוצה עם משימה.',
  'd0000000-0000-4000-8000-000000000022': 'קרובה יותר. קשה יותר לזהות. איפה שיש הכי הרבה עיניים, יש הכי הרבה מקומות להתחבא.',
  'd0000000-0000-4000-8000-000000000024': 'מצאו מישהו בסביבה שנראה כאילו הוא מכיר את המקום הזה הרבה זמן, עשר שנים ומעלה. סיפור אמיתי אחד, שהוא או היא באמת זוכרים. תעדו. הצופה כתבה שהעדויות האלה שוות יותר מכל דף בארכיון. עדיין לא הבנתם למה.',
  'd0000000-0000-4000-8000-000000000032': 'הקוד לא כתוב באף מקום. הוא המקום עצמו. תספרו נכון. תסדרו נכון. מי שיפצח את זה יבין בשביל מה כל זה קרה.',
  'd0000000-0000-4000-8000-000000000033': 'התיק מסומן במספר, לא בשם. ספרו בדיוק את המדרגות בגרם המדרגות ליד הכניסה, והקלידו.',
};

for (const stage of extraction.stages ?? []) {
  for (const t of stage.tasks ?? []) {
    if (DESCRIPTION_FIX[t.id]) t.description = DESCRIPTION_FIX[t.id];
    if (LOCATION_CLUE_FIX[t.id]) t.locationClue = LOCATION_CLUE_FIX[t.id];
    if (LONG_INSTRUCTIONS_FIX[t.id] && t.smart) t.smart = { ...t.smart, longInstructions: LONG_INSTRUCTIONS_FIX[t.id] };
  }
}

// The extracted `instructionPrompt` is the ORIGINAL operator note verbatim,
// several clauses long, still carrying its own self destruct ("מחקו פסקה זו
// לאחר הקריאה"). Demo only: replace each with a short, single purpose line,
// keyed by the exact (mission, field) it targets so a step this map does not
// name is left as extraction produced it, never silently dropped.
const SHORT_INSTRUCTION = {
  'd0000000-0000-4000-8000-000000000001|coordinates': 'סמנו על המפה את נקודת ההתחלה של המשחק, וקבעו אזור בטיחות סביב מסלול המשחק בהגדרות המתקדמות.',
  'd0000000-0000-4000-8000-000000000023|coordinates': 'בחרו מיקום שקט וטוב לריכוז, למשל ספסל או מדשאה.',
  'd0000000-0000-4000-8000-000000000025|coordinates': 'בחרו מיקום שקט, בלי הרבה אנשים סביב.',
  'd0000000-0000-4000-8000-000000000021|coordinates': 'סמנו על המפה את המקום שבתמונה.',
  'd0000000-0000-4000-8000-000000000021|media': 'צרפו תמונת תקריב מסקרנת של המקום.',
  'd0000000-0000-4000-8000-000000000022|coordinates': 'סמנו על המפה מיקום נוסף, חלופי למסירה הראשונה. כל קבוצה מבצעת רק אחת מהשתיים.',
  'd0000000-0000-4000-8000-000000000024|coordinates': 'קבעו כאן את אותו מיקום שבחרתם למסירה השקטה, עם רדיוס רחב יותר.',
  'd0000000-0000-4000-8000-000000000032|description': 'בחרו מקום עם שני סוגי חפצים קלים לספירה, ועדכנו את הקוד הסודי, הרמז וההוראות בהתאם.',
  'd0000000-0000-4000-8000-000000000033|description': 'בחרו מקום עם פרט אחד שניתן לספור בדיוק, ועדכנו את הרמז ואת התשובה המספרית בהתאם.',
  'd0000000-0000-4000-8000-000000000042|coordinates': 'סמנו על המפה את נקודת הסיום של המשחק.',
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
console.log(`[spy-protocol] wrote users/${OWNER_UID}/games/${GAME_ID}`);
console.log(`[spy-protocol] ${extraction.wizardSteps.length} quick setup step(s) extracted:`);
for (const s of extraction.wizardSteps) {
  console.log(`  · ${s.isRequired ? 'REQUIRED' : 'optional'}  ${s.targetFieldPath.padEnd(20)}  ${s.instructionPrompt.slice(0, 70)}`);
}
process.exit(0);
