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
import type { Stage, Task, ScoringPreset, GameMode, TemplateWizardStep } from '@rushpoint/shared';

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

/**
 * One הקמה מהירה / Quick Setup step, declared by POSITION
 * (change: quick-setup-wizard).
 *
 * The instruction a creator has to follow used to be written INTO the seeded
 * prose — "(ערכו את התשובה)" inside a description a player then read, and, worse,
 * as the literal answer key of two quizzes, which graded an honest answer wrong.
 * It lives here instead, as a pointer at the field it is about.
 *
 * Indexes, not ids, because `build()` mints fresh ids on every call; they are
 * resolved to ids by `templateWizardSteps` at the moment the game is created.
 */
export interface TemplateSetupStep {
  /** Index into `build()`'s stages. */
  stage: number;
  /** Index into that stage's tasks, or -1 for a step about the stage itself. */
  task: number;
  /** The field this step is about, e.g. `answers`, `coordinates`, `numericAnswer`. */
  field: string;
  /** Bilingual, like every other seeded string: "Hebrew

English". */
  prompt: string;
  /** Blocks the launch while the field is unconfigured. Default false. */
  required?: boolean;
}

export interface GameTemplate {
  key: string;
  emoji: string;
  mode: GameMode;
  scoringPreset: ScoringPreset;
  build: () => Stage[];
  /** The setup this template asks the creator for, if any. */
  setup?: TemplateSetupStep[];
}

/**
 * Resolve a template's positional setup declaration against the stages `build()`
 * just produced.
 *
 * A step whose position does not exist is DROPPED rather than emitted with a
 * dangling pointer: an inert step is invisible, a dangling one would sit in the
 * flow pointing at nothing (and `resolveWizardTarget` would have to drop it
 * anyway, one layer later).
 */
export function templateWizardSteps(stages: Stage[], setup?: TemplateSetupStep[]): TemplateWizardStep[] {
  if (!setup || setup.length === 0) return [];
  const out: TemplateWizardStep[] = [];
  setup.forEach((decl, i) => {
    const stage = stages[decl.stage];
    if (!stage) return;
    const task = decl.task >= 0 ? stage.tasks[decl.task] : undefined;
    if (decl.task >= 0 && !task) return;
    out.push({
      id: `qs-${i}-${decl.field}`,
      stageId: stage.id,
      taskId: task?.id ?? '',
      targetFieldPath: decl.field,
      instructionPrompt: decl.prompt,
      isRequired: decl.required === true,
    });
  });
  return out;
}

export const TEMPLATES: GameTemplate[] = [
  // ── Start from nothing (FIRST on purpose) ──────────────────────────────────
  // The picker renders this array with a bare `.map()` — no sort — so position 0
  // is literally the first card a brand-new creator sees. "Build my own" is the
  // platform's core promise, so it must not sit behind eight themed templates.
  // Pinned by scripts/test-template-picker-order.ts.
  {
    key: 'blank', emoji: '📄',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [stage('שלב 1', [task({ title: '' })])],
  },

  // ── Launch-wedge niche templates ───────────────────────────────────────────
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
        quiz('שנת לידה / Birth year', 'באיזו שנה נולד/ה חתן/כלת השמחה?\n\nWhat year was the guest of honour born?', ['2013'], undefined, { difficulty: 3, pointValue: 120 }),
        quiz('תחביב / Hobby', 'מה התחביב האהוב על חתן/כלת השמחה?\n\nWhat is the guest of honour’s favourite hobby?', ['כדורגל', 'football'], undefined, {
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
    setup: [
      { stage: 1, task: 0, field: 'answers', required: true,
        prompt: 'החליפו את שנת הלידה בשנה האמיתית של חתן/כלת השמחה.\n\nReplace the birth year with the guest of honour’s real one.' },
      { stage: 1, task: 1, field: 'answers', required: true,
        prompt: 'החליפו את התחביב בתחביב האמיתי של חתן/כלת השמחה.\n\nReplace the hobby with the guest of honour’s real one.' },
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
        numeric('כמה אנחנו? / Headcount guess', 'כמה עובדים בחברה? נחשו הכי קרוב.\n\nHow many people work here? Closest guess wins.', 50, { numericTolerance: 10, difficulty: 2, pointValue: 100 }),
        selfReport('שובר קרח / Two truths', 'כל אחד אומר שתי אמיתות ושקר.\n\nEach person: two truths and a lie.', { difficulty: 2, pointValue: 100 }),
      ], { requiredTaskCount: 1 }),
      stage('שוד המשרד / The office heist', [
        photo('שלל הצבע / Color loot', 'צלמו 5 חפצים בצבע אחד מהמשרד.\n\nPhoto: 5 office objects, all one color.', { difficulty: 4, pointValue: 130 }),
        photo('מגדל / Tower', 'בנו את המגדל הכי גבוה מציוד משרדי וצלמו.\n\nBuild the tallest tower from office supplies. Snap it.', { difficulty: 5, pointValue: 140 }),
        quiz('לוגו / Blind logo', 'מה צבע הלוגו של החברה?\n\nWhat is the company logo’s main color?', ['כחול', 'blue'], undefined, {
          difficulty: 4, pointValue: 130,
          hint: 'הציצו על כרטיס ביקור או על האתר. / Peek at a business card or the website.', hintPenalty: 15,
        }),
      ], { requiredTaskCount: 2 }),
      stage('מרוץ הערכים / Values relay', [
        sequence('שרשרת הערכים / Values chain', 'שלושה צעדים לפי הסדר, כצוות אחד.\n\nThree steps, in order, as one team.', [
          { id: uuid(), prompt: 'צעד 1: הסכימו על שם לצוות והקישו אישור. / Step 1: agree on a team name and tap confirm.' },
          { id: uuid(), prompt: 'צעד 2: הקלידו את ערך החברה הראשון. / Step 2: type company value #1.', answer: 'חדשנות' },
          { id: uuid(), prompt: 'צעד 3: צעקת צוות אחת גדולה! הקישו לסיום. / Step 3: one big team cheer! Tap to finish.' },
        ], { difficulty: 6, pointValue: 170 }),
      ], { isFinal: true }),
    ],
    setup: [
      { stage: 0, task: 0, field: 'numericAnswer', required: true,
        prompt: 'עדכנו את מספר העובדים בחברה שלכם.\n\nSet the real headcount of your company.' },
      { stage: 1, task: 2, field: 'answers', required: true,
        prompt: 'עדכנו את צבע הלוגו של החברה שלכם.\n\nSet your company logo’s main colour.' },
      { stage: 2, task: 0, field: 'steps', required: true,
        prompt: 'בצעד השני, החליפו את התשובה בערך הראשון של החברה שלכם.\n\nIn step two, replace the answer with your company’s first value.' },
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
        quiz('צבע אהוב / Favorite color', 'מה הצבע האהוב על החוגג/ת?\n\nWhat is the birthday star’s favorite color?', ['סגול', 'purple'], undefined, { difficulty: 3, pointValue: 120 }),
        numeric('בן/בת כמה? / How old?', 'בן/בת כמה החוגג/ת היום?\n\nHow old is the birthday star today?', 10, { numericTolerance: 0, difficulty: 3, pointValue: 120 }),
      ], { requiredTaskCount: 2 }),
      stage('ריקוד ניצחון / Victory dance', [
        photo('ריקוד / Dance', 'כל הקבוצה רוקדת 10 שניות. צלמו!\n\nWhole team dances 10 seconds. Snap it!', { difficulty: 4, pointValue: 150 }),
      ], { isFinal: true }),
    ],
    setup: [
      { stage: 1, task: 0, field: 'answers', required: true,
        prompt: 'עדכנו את הצבע האהוב על החוגג/ת.\n\nSet the birthday star’s real favourite colour.' },
      { stage: 1, task: 1, field: 'numericAnswer', required: true,
        prompt: 'עדכנו את הגיל של החוגג/ת.\n\nSet the birthday star’s real age.' },
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
          { id: uuid(), prompt: 'צעד 2: הקלידו את שם בית הספר. / Step 2: type the school name.', answer: 'בית הספר' },
          { id: uuid(), prompt: 'צעד 3: צעקת צוות אחת גדולה! הקישו לסיום. / Step 3: one big team cheer! Tap to finish.' },
        ], { difficulty: 5, pointValue: 150 }),
        photo('צילום סיום / Finish photo', 'כל הצוות בקו הסיום, פוזת ניצחון!\n\nWhole team at the finish, victory pose!', { difficulty: 4, pointValue: 150 }),
      ], { isFinal: true, requiredTaskCount: 2 }),
    ],
    setup: [
      { stage: 2, task: 0, field: 'steps', required: true,
        prompt: 'בצעד השני, החליפו את התשובה בשם בית הספר שלכם.\n\nIn step two, replace the answer with your school’s name.' },
    ],
  },
  {
    key: 'wedding', emoji: '💍',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [
      stage('מכירים את הזוג? / Know the couple?', [
        quiz('איפה הם נפגשו? / Where did they meet?', 'איפה הזוג נפגש בפעם הראשונה?\n\nWhere did the couple first meet?', ['בבית ספר', 'at school'], undefined, {
          difficulty: 3, pointValue: 120,
          hint: 'שאלו בשקט אחד ההורים או השושבינים. / Quietly ask a parent or the best man.', hintPenalty: 20,
        }),
        numeric('כמה שנים הם יחד? / How many years together?', 'כמה שנים הזוג יחד? נחשו הכי קרוב.\n\nHow many years has the couple been together? Closest guess wins.', 5, { numericTolerance: 1, difficulty: 3, pointValue: 120 }),
      ], {
        requiredTaskCount: 1,
        narrative: {
          intro: {
            title: 'מזל טוב!',
            body: 'A big day for a special couple. Gather your team and let the celebration begin.',
            bodyHe: 'יום גדול לזוג מיוחד. אספו את הקבוצה ובואו נתחיל לחגוג.',
          },
        },
      }),
      stage('רחבת הריקודים / Dance floor', [
        photo('סלפי עם הזוג / Selfie with the couple', 'תפסו את הזוג לרגע וצלמו סלפי משותף!\n\nCatch the couple for a moment and snap a selfie together!', { difficulty: 4, pointValue: 140 }),
        photo('הנעל האבודה / Something borrowed', 'צלמו משהו שאולים ליום המיוחד. משהו כחול עדיף!\n\nPhoto something borrowed for the big day. Bonus if it is blue!', { difficulty: 4, pointValue: 140 }),
        photo('כל השולחן רוקד / Whole table dancing', 'הרימו את כל השולחן שלכם לרחבה וצלמו את כולם רוקדים.\n\nGet your whole table onto the floor and film everyone dancing.', { difficulty: 5, pointValue: 150 }),
      ], { requiredTaskCount: 2 }),
      stage('ברכה / A toast', [
        photo('ברכה בת 15 שניות / A 15 second blessing', 'צלמו ברכה קצרה של 15 שניות מהקבוצה לזוג המאושר.\n\nFilm a short 15 second blessing from the team to the happy couple.', { difficulty: 4, pointValue: 160 }),
      ], {
        isFinal: true,
        narrative: {
          outro: {
            title: 'לחיים!',
            body: 'A toast to a wonderful couple. May the party never end!',
            bodyHe: 'לחיים לזוג הנפלא. שהמסיבה לא תיגמר לעולם!',
          },
        },
      }),
    ],
    setup: [
      { stage: 0, task: 0, field: 'answers', required: true,
        prompt: 'עדכנו איפה הזוג נפגש בפעם הראשונה.\n\nSet where the couple really first met.' },
      { stage: 0, task: 1, field: 'numericAnswer', required: true,
        prompt: 'עדכנו כמה שנים הזוג יחד.\n\nSet how many years the couple has really been together.' },
    ],
  },
  {
    key: 'conference', emoji: '🎤',
    mode: 'team', scoringPreset: 'fixed_points_speed',
    build: () => [
      stage('היכרות / Icebreaker', [
        selfReport('מצאו מישהו מ 3 קבוצות / Find someone from 3 teams', 'הכירו מישהו חדש משלוש קבוצות שונות והקישו סיום.\n\nMeet someone new from three different teams, then tap done.', { difficulty: 2, pointValue: 100 }),
      ], {
        requiredTaskCount: 1,
        narrative: {
          intro: {
            title: 'מתחברים',
            body: 'The best sessions happen between the sessions. Time to meet the room.',
            bodyHe: 'המפגשים הכי טובים קורים בין ההרצאות. הגיע הזמן להכיר את החדר.',
          },
        },
      }),
      stage('ציד קשרים / Networking hunt', [
        photo('כרטיס ביקור / A business card selfie', 'צלמו סלפי עם כרטיס ביקור של מישהו שהכרתם היום.\n\nSnap a selfie with the business card of someone you met today.', { difficulty: 3, pointValue: 120 }),
        quiz('מי הדובר הראשי? / Who is the keynote speaker?', 'מי הדובר הראשי של האירוע?\n\nWho is the event keynote speaker?', ['הדובר הראשי', 'the keynote speaker'], undefined, {
          difficulty: 3, pointValue: 120,
          hint: 'הציצו בלוח הזמנים של האירוע. / Peek at the event agenda.', hintPenalty: 15,
        }),
        photo('צוות ליד הלוגו / Team by the event banner', 'כל הקבוצה מצטלמת ליד באנר או לוגו האירוע.\n\nWhole team poses by the event banner or logo.', { difficulty: 3, pointValue: 120 }),
      ], { requiredTaskCount: 2 }),
      stage('טייק אווי / Takeaway', [
        survey('התובנה הכי טובה / Best insight of the day', 'אין תשובה נכונה: מה התובנה שתיקחו הביתה?\n\nNo wrong answer: what insight are you taking home?', [
          '💡 רעיון חדש לגמרי / A brand new idea',
          '🤝 קשר חדש מעולה / A great new contact',
          '☕ שיחת המסדרון הכי טובה / The best hallway chat',
          '🚀 השראה לפרויקט הבא / Inspiration for the next project',
        ], { difficulty: 1 }),
      ], {
        isFinal: true,
        narrative: {
          outro: {
            title: 'עד הפעם הבאה',
            body: 'New contacts, fresh ideas, and a team that just clicked. Well done!',
            bodyHe: 'קשרים חדשים, רעיונות טריים וקבוצה שהתחברה. כל הכבוד!',
          },
        },
      }),
    ],
    setup: [
      { stage: 0, task: 0, field: 'answers', required: true,
        prompt: 'עדכנו את שם הדובר הראשי של האירוע שלכם.\n\nSet your event’s real keynote speaker.' },
    ],
  },
  {
    key: 'city_tour', emoji: '🏛️',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [
      stage('יוצאים לדרך / Set off', [
        quiz('איזה מבנה הכי גבוה בעיר? / Which building is the tallest in town?', 'מהו המבנה הגבוה ביותר בעיר?\n\nWhich is the tallest building in town?', ['מגדל העיר', 'the town tower'], undefined, {
          difficulty: 3, pointValue: 110,
          hint: 'הרימו מבט למעלה, או שאלו מקומי. / Look up, or ask a local.', hintPenalty: 15,
        }),
      ], {
        requiredTaskCount: 1,
        narrative: {
          intro: {
            title: 'הסיור מתחיל',
            body: 'Every street has a story. Keep your eyes open and let the city surprise you.',
            bodyHe: 'לכל רחוב יש סיפור. פקחו עיניים ותנו לעיר להפתיע אתכם.',
          },
        },
      }),
      stage('ציד תרבות / Culture hunt', [
        photo('אמנות ברחוב / Street art', 'מצאו וצלמו יצירת אמנות רחוב שאהבתם.\n\nFind and photograph a piece of street art you love.', { difficulty: 3, pointValue: 120 }),
        photo('פרט אדריכלי / An architectural detail', 'צלמו פרט אדריכלי יפה: קשת, עמוד או חלון מיוחד.\n\nSnap a beautiful architectural detail: an arch, a column or a special window.', { difficulty: 4, pointValue: 130 }),
        quiz('באיזו שנה נבנה? / What year was it built?', 'באיזו שנה נבנה ציון הדרך המרכזי?\n\nWhat year was the main landmark built?', ['1948'], undefined, { difficulty: 4, pointValue: 130 }),
      ], { requiredTaskCount: 2 }),
      stage('התמונה הגדולה / The big picture', [
        photo('כל הקבוצה מול ציון הדרך / Whole team at the landmark', 'כל הקבוצה מצטלמת יחד מול ציון הדרך המרכזי.\n\nThe whole team poses together in front of the main landmark.', { difficulty: 4, pointValue: 150 }),
      ], {
        isFinal: true,
        narrative: {
          outro: {
            title: 'סוף הדרך',
            body: 'You saw the city like never before. One last photo to remember it by.',
            bodyHe: 'ראיתם את העיר כמו שלא ראיתם מעולם. תמונה אחרונה למזכרת.',
          },
        },
      }),
    ],
    setup: [
      { stage: 0, task: 0, field: 'answers', required: true,
        prompt: 'עדכנו מהו המבנה הגבוה בעיר שלכם.\n\nSet the tallest building in your town.' },
    ],
  },

  // ── Generic starters ────────────────────────────────────────────────────────
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
    setup: [
      { stage: 1, task: 0, field: 'answers', required: true,
        prompt: 'עדכנו את שנת הבנייה של ציון הדרך שבחרתם.\n\nSet the year your chosen landmark was built.' },
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
