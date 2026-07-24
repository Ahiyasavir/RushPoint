// Quick-start game templates — pre-fill the Builder with a working structure the
// creator can then edit. Each `build()` returns fresh stages (new ids each time).
// The niche templates (bar/bat mitzvah, youth group, corporate, birthday, school
// race) target RushPoint's launch wedges so a creator goes from idea to a runnable
// game in seconds.
//
// Every seeded task is FULLY LOCATIONLESS by default (coordinates {0,0},
// triggerMode 'locationless') so the game runs anywhere on earth with no staff and
// no GPS — mirroring the flagship instant-play demo. A creator can drop pins later.
//
// The picker's NAME + DESCRIPTION are NOT here: they live in both translation
// maps and resolve through lib/templateLabels.ts, because these literals used to
// make an English creator's very first screen Hebrew. The seeded stage/task
// CONTENT below is authored BILINGUAL demo data ("Hebrew\n\nEnglish" in one
// string) so it reads correctly whichever language the creator plays in.
import type { Stage, Task, ScoringPreset, GameMode } from '@rushpoint/shared';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

// All seeded tasks play from anywhere: no map pin, no GPS gate, zero transit in
// routing. Null-island coordinates are the "not placed" sentinel.
function task(over: Partial<Task>): Task {
  return {
    id: uuid(), title: '', type: 'field', coordinates: { lat: 0, lng: 0 },
    locationless: true, triggerMode: 'locationless',
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 5, ...over,
  };
}
function stage(title: string, tasks: Task[], over: Partial<Stage> = {}): Stage {
  // requiredTaskCount defaults to 1 (change: adaptive-difficulty-routing) — same
  // authoring default as the Builder's blankStage: a multi-task level means "do the
  // best-suited ONE" unless the template says otherwise via `over`.
  return { id: uuid(), order: 0, title, requiredTaskCount: 1, tasks, ...over };
}

// Shorthands for common task kinds (keeps the templates readable). Each takes an
// optional `over` so a template can bump difficulty / points or attach a hint.
const photo = (title: string, description: string, over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'photo', smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true }, ...over });
const quiz = (title: string, description: string, answers: string[], choices?: string[], over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'quiz', answers, choices, ...over });
const numeric = (title: string, description: string, numericAnswer: number, over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'numeric', numericAnswer, numericTolerance: 0, ...over });
const selfReport = (title: string, description: string, over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'self_report', ...over });
const survey = (title: string, description: string, surveyChoices: string[], over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'survey', surveyChoices, pointValue: 60, ...over });
const sequence = (title: string, description: string, steps: NonNullable<Task['steps']>, over: Partial<Task> = {}): Task =>
  task({ title, description, type: 'sequence', steps, ...over });

export interface GameTemplate {
  key: string;
  emoji: string;
  mode: GameMode;
  scoringPreset: ScoringPreset;
  build: () => Stage[];
}

export const TEMPLATES: GameTemplate[] = [
  // ── Launch-wedge niche templates (shown first) ──────────────────────────────
  {
    key: 'bar_mitzvah', emoji: '🕎',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [
      stage('יוצאים לחגוג / Let’s celebrate', [
        photo('קפיצת פתיחה / Opening jump', 'כל הקבוצה קופצת באוויר ביחד!\n\nWhole team jumps in the air together!', { difficulty: 2, pointValue: 100 }),
      ], {
        narrative: {
          intro: {
            title: 'מתחילים לחגוג',
            body: 'It’s a huge day. Grab your team and let’s make it unforgettable.',
            bodyHe: 'יום ענק. אספו את הקבוצה ובואו נהפוך אותו לבלתי נשכח.',
          },
        },
      }),
      stage('כמה אתם מכירים? / How well do you know them?', [
        quiz('שנת לידה / Birth year', 'באיזו שנה נולד/ה חתן/כלת השמחה? (ערכו את התשובה)\n\nWhat year was the guest of honour born? (edit this answer)', ['2013'], undefined, { difficulty: 3, pointValue: 120 }),
        quiz('תחביב / Hobby', 'מה התחביב האהוב על חתן/כלת השמחה? (ערכו את התשובה)\n\nWhat is the guest of honour’s favourite hobby? (edit this answer)', ['כדורגל', 'football'], undefined, {
          difficulty: 4, pointValue: 130,
          hint: 'שאלו בשקט את ההורים. / Quietly ask the parents.', hintPenalty: 20,
        }),
      ], { requiredTaskCount: 2 }),
      stage('משימת יצירתיות / Creative mission', [
        photo('חיקוי / Impression', 'צלמו חיקוי מצחיק של אחד מבני המשפחה.\n\nSnap a funny impression of a family member.', { difficulty: 4, pointValue: 140 }),
        photo('נאום / Toast', 'צלמו את הקבוצה נושאת נאום ברכה קצר.\n\nFilm the team giving a short toast.', { difficulty: 4, pointValue: 140 }),
      ], { requiredTaskCount: 1 }),
      stage('ריקוד הניצחון / Victory dance', [
        photo('ריקוד / Dance', 'כל הקבוצה רוקדת ריקוד ניצחון. צלמו!\n\nThe whole team does a victory dance. Snap it!', { difficulty: 5, pointValue: 160 }),
      ], {
        isFinal: true,
        narrative: {
          outro: {
            title: 'מזל טוב!',
            body: 'You did it. One last dance and the crown is yours.',
            bodyHe: 'עשיתם את זה. ריקוד אחרון והכתר שלכם.',
          },
        },
      }),
    ],
  },
  {
    key: 'youth_group', emoji: '🏕️',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [
      stage('יוצאים לשטח / Into the wild', [
        quiz('חידת השביל / Trail riddle', 'יש לי גזע וענפים אבל לא עלה. מה אני?\n\nI have a trunk and branches but no leaves. What am I?', ['נהר', 'river'], undefined, {
          difficulty: 3, pointValue: 110,
          hint: 'לא עץ. הוא זורם. / Not a tree. It flows.', hintPenalty: 15,
        }),
      ]),
      stage('ציד האוצר / Scavenger', [
        photo('משהו חי / Something alive', 'צלמו משהו חי, אבל בעדינות! חבר, חרק או עלה.\n\nPhoto something alive, gently! A friend, a bug, or a leaf.', { difficulty: 3, pointValue: 120 }),
        photo('משהו עגול / Something round', 'מצאו וצלמו את הדבר הכי עגול בסביבה.\n\nFind and snap the roundest thing around.', { difficulty: 3, pointValue: 120 }),
        photo('משהו ישן / Something old', 'משהו שנראה ותיק ומנוסה, צלמו אותו!\n\nSomething that looks old and wise. Snap it!', { difficulty: 4, pointValue: 130 }),
      ], { requiredTaskCount: 2 }),
      stage('מדורה / Campfire', [
        survey('שיר המדורה / Campfire pick', 'אין תשובה נכונה: מה פותח את המדורה?\n\nNo wrong answer: what kicks off the campfire?', [
          '🔥 שיר שקט / A quiet song',
          '🥁 שיר קצבי / A drum beat',
          '😂 שיר מצחיק / A funny song',
          '⭐ סיפור מפחיד / A scary story',
        ], { difficulty: 1 }),
        photo('שכבה שלמה / Whole group', 'כל השכבה בפריים אחד. חייכו!\n\nThe whole group in one frame. Smile!', { difficulty: 4, pointValue: 160 }),
      ], { isFinal: true, requiredTaskCount: 2 }),
    ],
  },
  {
    key: 'corporate', emoji: '🏢',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [
      stage('הרמת מסך / Kickoff', [
        numeric('כמה אנחנו? / Headcount guess', 'כמה עובדים בחברה? נחשו הכי קרוב. (ערכו את המספר)\n\nHow many people work here? Closest guess wins. (edit this answer)', 50, { numericTolerance: 10, difficulty: 2, pointValue: 100 }),
        selfReport('שובר קרח / Two truths', 'כל אחד אומר שתי אמיתות ושקר.\n\nEach person: two truths and a lie.', { difficulty: 2, pointValue: 100 }),
      ], { requiredTaskCount: 1 }),
      stage('שוד המשרד / The office heist', [
        photo('שלל הצבע / Color loot', 'צלמו 5 חפצים בצבע אחד מהמשרד.\n\nPhoto: 5 office objects, all one color.', { difficulty: 4, pointValue: 130 }),
        photo('מגדל / Tower', 'בנו את המגדל הכי גבוה מציוד משרדי וצלמו.\n\nBuild the tallest tower from office supplies. Snap it.', { difficulty: 5, pointValue: 140 }),
        quiz('לוגו / Blind logo', 'מה צבע הלוגו של החברה? (ערכו את התשובה)\n\nWhat is the company logo’s main color? (edit this answer)', ['כחול', 'blue'], undefined, {
          difficulty: 4, pointValue: 130,
          hint: 'הציצו על כרטיס ביקור או על האתר. / Peek at a business card or the website.', hintPenalty: 15,
        }),
      ], { requiredTaskCount: 2 }),
      stage('מרוץ הערכים / Values relay', [
        sequence('שרשרת הערכים / Values chain', 'שלושה צעדים לפי הסדר, כצוות אחד.\n\nThree steps, in order, as one team.', [
          { id: uuid(), prompt: 'צעד 1: הסכימו על שם לצוות והקישו אישור. / Step 1: agree on a team name and tap confirm.' },
          { id: uuid(), prompt: 'צעד 2: הקלידו את ערך החברה הראשון. (ערכו את התשובה בעורך) / Step 2: type company value #1. (edit this answer)', answer: 'חדשנות' },
          { id: uuid(), prompt: 'צעד 3: צעקת צוות אחת גדולה! הקישו לסיום. / Step 3: one big team cheer! Tap to finish.' },
        ], { difficulty: 6, pointValue: 170 }),
      ], { isFinal: true }),
    ],
  },
  {
    key: 'birthday', emoji: '🎂',
    mode: 'team', scoringPreset: 'fixed_points_speed',
    build: () => [
      stage('המסיבה מתחילה / Party on', [
        photo('פוזת מסיבה / Party pose', 'כל הקבוצה עם כובעי מסיבה!\n\nWhole team in party hats!', { difficulty: 2, pointValue: 100 }),
      ]),
      stage('מכירים את החוגג/ת? / Know the star?', [
        quiz('צבע אהוב / Favorite color', 'מה הצבע האהוב על החוגג/ת? (ערכו את התשובה)\n\nWhat is the birthday star’s favorite color? (edit this answer)', ['סגול', 'purple'], undefined, { difficulty: 3, pointValue: 120 }),
        numeric('בן/בת כמה? / How old?', 'בן/בת כמה החוגג/ת היום? (ערכו את המספר)\n\nHow old is the birthday star today? (edit this answer)', 10, { numericTolerance: 0, difficulty: 3, pointValue: 120 }),
      ], { requiredTaskCount: 2 }),
      stage('ריקוד ניצחון / Victory dance', [
        photo('ריקוד / Dance', 'כל הקבוצה רוקדת 10 שניות. צלמו!\n\nWhole team dances 10 seconds. Snap it!', { difficulty: 4, pointValue: 150 }),
      ], { isFinal: true }),
    ],
  },
  {
    key: 'school_race', emoji: '🏫',
    mode: 'team', scoringPreset: 'fixed_points_speed',
    build: () => [
      stage('פעמון פותח / Bell rings', [
        quiz('מדע / Science', 'כמה עצמות בגוף אדם מבוגר?\n\nHow many bones in an adult human body?', ['206'], ['201', '206', '215'], {
          difficulty: 3, pointValue: 110,
          hint: 'רמז: בין 200 ל 210. / Between 200 and 210.', hintPenalty: 15,
        }),
      ]),
      stage('מגרש / Schoolyard', [
        numeric('חשבון מהיר / Quick math', '7 × 8 = ?\n\n7 × 8 = ?', 56, { difficulty: 4, pointValue: 120 }),
        photo('צוות בתנועה / Team in motion', 'כל הצוות קופץ באותו רגע!\n\nWhole team jumps at once!', { difficulty: 4, pointValue: 120 }),
        quiz('גיאוגרפיה / Geography', 'מה בירת ישראל?\n\nCapital of Israel?', ['ירושלים', 'jerusalem'], undefined, { difficulty: 4, pointValue: 120 }),
      ], { requiredTaskCount: 2 }),
      stage('קו הסיום / Finish line', [
        sequence('אתגר צוות / Teamwork', 'שלושה צעדים לפי הסדר, כל הצוות ביחד.\n\nThree steps, in order, whole team together.', [
          { id: uuid(), prompt: 'צעד 1: הסתדרו בשורה לפי גובה. הקישו אישור. / Step 1: line up by height. Tap confirm.' },
          { id: uuid(), prompt: 'צעד 2: הקלידו את שם בית הספר. (ערכו את התשובה בעורך) / Step 2: type the school name. (edit this answer)', answer: 'בית הספר' },
          { id: uuid(), prompt: 'צעד 3: צעקת צוות אחת גדולה! הקישו לסיום. / Step 3: one big team cheer! Tap to finish.' },
        ], { difficulty: 5, pointValue: 150 }),
        photo('צילום סיום / Finish photo', 'כל הצוות בקו הסיום, פוזת ניצחון!\n\nWhole team at the finish, victory pose!', { difficulty: 4, pointValue: 150 }),
      ], { isFinal: true, requiredTaskCount: 2 }),
    ],
  },

  // ── Generic starters ────────────────────────────────────────────────────────
  {
    key: 'blank', emoji: '📄',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [stage('שלב 1', [task({ title: '' })])],
  },
  {
    key: 'riddle', emoji: '🗝️',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [
      stage('החדר הנעול / The locked room', [quiz(
        'חידה 1 / Riddle 1', 'יש לי שיניים אבל אני לא נושך. מה אני?\n\nI have teeth but I don’t bite. What am I?', ['מסרק', 'comb'], undefined, { difficulty: 3 },
      )], {
        narrative: {
          intro: {
            title: 'החדר הנעול',
            body: 'Three riddles stand between you and the exit. Think sharp.',
            bodyHe: 'שלוש חידות מפרידות ביניכם ליציאה. תחשבו חד.',
          },
        },
      }),
      stage('הרמז השני / The second clue', [quiz(
        'חידה 2 / Riddle 2', 'ככל שלוקחים ממני יותר, אני נעשה גדול יותר. מה אני?\n\nThe more you take from me, the bigger I get. What am I?', ['בור', 'hole'], undefined, {
          difficulty: 5,
          hint: 'חושבים על משהו באדמה. / Think of something in the ground.', hintPenalty: 15,
        },
      )]),
      stage('הרמז האחרון / The final clue', [quiz(
        'חידה 3 / Riddle 3', 'מה שלך, אבל אחרים משתמשים בו יותר ממך?\n\nIt’s yours, but others use it more than you. What is it?', ['השם שלי', 'שם', 'השם', 'my name', 'name'], undefined, { difficulty: 6 },
      )], { isFinal: true }),
    ],
  },
  {
    key: 'photo', emoji: '📸',
    mode: 'team', scoringPreset: 'fixed_points_speed',
    build: () => [
      stage('סלפי ליד ציון דרך', [photo('סלפי קבוצתי', 'צלמו סלפי קבוצתי מול ציון הדרך המרכזי.')]),
      stage('צבע מקומי', [photo('משהו צבעוני', 'צלמו את הדבר הכי צבעוני שתמצאו.')]),
      stage('צילום הסיום', [photo('פוזת ניצחון', 'תפסו פוזת ניצחון בנקודת הסיום!')], { isFinal: true }),
    ],
  },
  {
    key: 'trivia', emoji: '❓',
    mode: 'individual', scoringPreset: 'fixed_points_speed',
    build: () => [
      stage('חימום / Warm-up', [quiz(
        'שאלה 1 / Question 1', 'איזה כוכב לכת מכונה "הכוכב האדום"?\n\nWhich planet is called the Red Planet?', ['מאדים / Mars'], ['נוגה / Venus', 'מאדים / Mars', 'צדק / Jupiter'], { difficulty: 3 },
      )], {
        narrative: {
          intro: {
            title: 'שעשועון הטריוויה',
            body: 'Lights up, buzzers ready. Three questions, one champion.',
            bodyHe: 'האורות דולקים, האצבעות על הכפתור. שלוש שאלות, אלוף אחד.',
          },
        },
      }),
      stage('נהיה קשה / Getting harder', [quiz(
        'שאלה 2 / Question 2', 'כמה יבשות יש בעולם?\n\nHow many continents are there?', ['7'], ['5', '6', '7'], {
          difficulty: 5,
          hint: 'רמז: יותר מחמש. / More than five.', hintPenalty: 15,
        },
      )]),
      stage('השאלה האחרונה / The final question', [quiz(
        'שאלה 3 / Question 3', 'מהו האוקיינוס הגדול בעולם?\n\nWhat is the largest ocean?', ['השקט / Pacific'], ['האטלנטי / Atlantic', 'ההודי / Indian', 'השקט / Pacific'], { difficulty: 6 },
      )], { isFinal: true }),
    ],
  },
];
