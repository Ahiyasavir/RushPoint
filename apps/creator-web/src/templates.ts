// Quick-start game templates — pre-fill the Builder with a working structure the
// creator can then edit. Each `build()` returns fresh stages (new ids each time).
// The niche templates (bar/bat mitzvah, youth trip, team gibush) target
// RushPoint's launch wedges so a creator goes from idea to a runnable game in
// seconds.
//
// The picker's NAME + DESCRIPTION are NOT here: they live in both translation
// maps and resolve through lib/templateLabels.ts, because these literals used to
// make an English creator's very first screen Hebrew. The seeded stage/task
// CONTENT below stays as authored Hebrew demo data.
import type { Stage, Task, ScoringPreset, GameMode } from '@rushpoint/shared';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

function task(over: Partial<Task>): Task {
  return {
    id: uuid(), title: '', type: 'field', coordinates: { lat: 0, lng: 0 },
    difficulty: 5, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 5, ...over,
  };
}
function stage(title: string, tasks: Task[], over: Partial<Stage> = {}): Stage {
  // requiredTaskCount defaults to 1 (change: adaptive-difficulty-routing) — same
  // authoring default as the Builder's blankStage: a multi-task level means "do the
  // best-suited ONE" unless the template says otherwise via `over`.
  return { id: uuid(), order: 0, title, requiredTaskCount: 1, tasks, ...over };
}

// Shorthands for common task kinds (keeps the templates readable).
const photo = (title: string, description: string): Task =>
  task({ title, description, type: 'photo', smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true } });
const quiz = (title: string, description: string, answers: string[], choices?: string[]): Task =>
  task({ title, description, type: 'quiz', locationless: true, answers, choices });
const checkin = (title: string, description: string): Task =>
  task({ title, description, type: 'field' });

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
    key: 'bar_mitzvah', emoji: '🎉',
    mode: 'team', scoringPreset: 'fixed_points_speed',
    build: () => [
      stage('יוצאים לדרך', [photo('צילום קבוצתי', 'צלמו את כל הקבוצה קופצת באוויר ביחד!')]),
      stage('כמה אתם מכירים את החוגג/ת?', [
        quiz('שאלה על החוגג/ת', 'באיזו שנה נולד/ה חתן/כלת השמחה? (ערכו את התשובה הנכונה)', ['2012']),
      ]),
      stage('משימת יצירתיות', [photo('חיקוי מצחיק', 'צלמו תמונה של חיקוי מצחיק של אחד מבני המשפחה.')]),
      stage('ריקוד הניצחון', [photo('ריקוד ניצחון', 'כל הקבוצה רוקדת ריקוד ניצחון, צלמו!')], { isFinal: true }),
    ],
  },
  {
    key: 'youth_trip', emoji: '🏕️',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [
      stage('נקודת ריכוז', [checkin('הגעה לנקודת המפגש', 'כל הקבוצה הגיעה לנקודת הריכוז? סמנו צ׳ק-אין.')]),
      stage('חידת השביל', [
        quiz('חידה', 'ככל שלוקחים ממני יותר, אני נעשה גדול יותר. מה אני?', ['בור']),
      ]),
      stage('צילום שכבה', [photo('תמונת שכבה', 'צלמו את כל הקבוצה עם הנוף ברקע.')]),
      stage('האתגר האחרון', [checkin('סיום המסלול', 'הגעתם לנקודת הסיום! סמנו השלמה.')], { isFinal: true }),
    ],
  },
  {
    key: 'team_gibush', emoji: '🤝',
    mode: 'team', scoringPreset: 'smart_weighted',
    build: () => [
      stage('משימת פתיחה', [task({
        title: 'שרשרת הצוות', type: 'sequence', locationless: true,
        description: 'השלימו את השלבים לפי הסדר כצוות.',
        steps: [
          { id: uuid(), prompt: 'מצאו שם משותף לצוות והקלידו אותו' },
          { id: uuid(), prompt: 'כל חברי הצוות עומדים על רגל אחת, הקישו לאישור' },
          { id: uuid(), prompt: 'מה המילה הסודית? (ערכו אותה בעורך)', answer: 'גיבוש' },
        ],
      })]),
      stage('צילום יצירתי', [photo('צילום צוות יצירתי', 'צרו פירמידה אנושית וצלמו!')]),
      stage('שאלת הסיום', [
        quiz('שאלת צוות', 'כמה חברים יש בצוות שלכם?', ['5']),
      ], { isFinal: true }),
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
      stage('הרמז הראשון', [quiz(
        'חידה 1', 'יש לי שיניים אבל אני לא נושך. מה אני?', ['מסרק'],
      )]),
      stage('הרמז השני', [quiz(
        'חידה 2', 'ככל שלוקחים ממני יותר, אני נעשה גדול יותר. מה אני?', ['בור'],
      )]),
      stage('הרמז האחרון', [quiz(
        'חידה 3', 'מה שלך, אבל אחרים משתמשים בו יותר ממך?', ['השם שלי', 'שם', 'השם'],
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
      stage('חימום', [quiz(
        'שאלה 1', 'איזה כוכב לכת מכונה "הכוכב האדום"?', ['מאדים'], ['נוגה', 'מאדים', 'צדק'],
      )]),
      stage('נהיה קשה', [quiz(
        'שאלה 2', 'כמה יבשות יש בעולם?', ['7'], ['5', '6', '7'],
      )]),
      stage('השאלה האחרונה', [quiz(
        'שאלה 3', 'מהו האוקיינוס הגדול בעולם?', ['השקט'], ['האטלנטי', 'ההודי', 'השקט'],
      )], { isFinal: true }),
    ],
  },
];
