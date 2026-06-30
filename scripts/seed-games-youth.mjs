// ─── RushPoint — seed 3 youth-oriented real-location games ────────────────────
// Games:
//   1. "מסתרי יער רמות" — רמות ב', ירושלים (Ramot Bet forest)
//   2. "מסע בגבול" — יישוב סנסנה, הר חברון (Sansana community)
//   3. "מסע בלב ירושלים" — עיר העתיקה (Jerusalem Old City)
//
// Run against local emulator:
//   node scripts/seed-games-youth.mjs
//
// Run against LIVE project (careful!):
//   FIRESTORE_EMULATOR_HOST="" FIREBASE_AUTH_EMULATOR_HOST="" \
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
//   node scripts/seed-games-youth.mjs

import admin from 'firebase-admin';

const PROJECT_ID = 'rushpoint-pwa-7daaa';

process.env.FIRESTORE_EMULATOR_HOST     ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const OWNER_UID = 'demo-creator';

// ── helpers ───────────────────────────────────────────────────────────────────

function task(overrides) {
  return {
    difficulty: 5,
    estimatedMinutes: 5,
    pointValue: 100,
    maxConcurrentTeams: 5,
    triggerMode: 'radius',
    geofenceRadiusMeters: 40,
    ...overrides,
  };
}

function photoTask(overrides) {
  return task({
    type: 'photo',
    smart: {
      enabled: true,
      verificationType: 'photo_upload',
      autoApprove: true,
      showIntroScreen: true,
      showSuccessScreen: true,
    },
    ...overrides,
  });
}

function quizTask(overrides) {
  return task({ type: 'quiz', ...overrides });
}

function fieldTask(overrides) {
  return task({ type: 'field', ...overrides });
}

function geofenceTask(overrides) {
  return task({ type: 'geofence', triggerMode: 'radius', ...overrides });
}

function sequenceTask(overrides) {
  return task({ type: 'sequence', ...overrides });
}

function numericTask(overrides) {
  return task({ type: 'numeric', ...overrides });
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAME 1 — מסתרי יער רמות | רמות ב', ירושלים
// ═══════════════════════════════════════════════════════════════════════════════

const GAME_RAMOT = {
  id: 'game-ramot-bet',
  ownerUid: OWNER_UID,
  title: 'מסתרי יער רמות',
  description:
    'יוצאים לחקור את יער רמות ב׳ — בין חומות מצודה שמונאית, גתות בנות 2,500 שנה, יעלים פראיים ומצפה עם נוף מדהים לירושלים. משחק שדה לקבוצות נוער שאוהבות הרפתקה ולגלות את הנסתר.',
  mode: 'team',
  scoringPreset: 'smart_weighted',
  registrationFields: [
    { id: 'teamName', label: 'שם הקבוצה', type: 'text', required: true, level: 'team' },
    { id: 'memberCount', label: 'מספר חברי הקבוצה', type: 'number', required: true, level: 'team' },
  ],
  visibility: 'public',
  tags: ['ירושלים', 'טבע', 'ארכיאולוגיה', 'נוער', 'יער', 'רמות'],
  approxLocation: { lat: 31.8133, lng: 35.1825, label: 'גן הקיפוד, רמות ב׳, ירושלים' },
  playCount: 0,
  stages: [
    // ── שלב 1: נקודת מוצא ──────────────────────────────────────────────────
    {
      id: 'ramot-s1',
      order: 0,
      title: 'נקודת מוצא: גן הקיפוד',
      tasks: [
        photoTask({
          id: 'ramot-t1a',
          title: 'צילום קבוצתי — כניסה ליער',
          description:
            'ברוכים הבאים ליער רמות! צלמו תמונת קבוצה מול שלט גן הקיפוד (דרך החורש 90). כולם צריכים להיות בפריים — זו תמונת הפתיחה שלכם!',
          coordinates: { lat: 31.8133, lng: 35.1825 },
          difficulty: 2,
          estimatedMinutes: 3,
          pointValue: 80,
          hint: 'הכניסה הראשית ליער נמצאת בדרך החורש 90, ממול לסניף רמי לוי',
          hintPenalty: 15,
        }),
        quizTask({
          id: 'ramot-t1b',
          title: 'מי גר פה?',
          description:
            'ביער רמות גרות חיות מדהימות. איזה יונק גדול (עד 100 ק"ג!) שוכן ביער ויש ממנו כ-70 פרטים?',
          coordinates: { lat: 31.8133, lng: 35.1825 },
          difficulty: 4,
          estimatedMinutes: 3,
          pointValue: 100,
          choices: ['דוב חום', 'יעל הר', 'חזיר בר', 'אריה'],
          answers: ['יעל הר', 'יעל'],
          hint: 'ניתן לראות אותם עומדים על סלעים תלולים. יש להם קרניים מעוקלות.',
          hintPenalty: 20,
          tags: ['טבע', 'חיות'],
        }),
      ],
      requiredTaskCount: 2,
    },

    // ── שלב 2: לב היער ──────────────────────────────────────────────────────
    {
      id: 'ramot-s2',
      order: 1,
      title: 'לב היער — נחל צופים',
      tasks: [
        geofenceTask({
          id: 'ramot-t2a',
          title: 'הגעתם ללב היער!',
          description:
            'כשתגיעו לתוך יער רמות לאורך נחל צופים, המשחק יזהה אתכם אוטומטית. הקשיבו לצלילים מסביבכם — כמה מינים שונים של ציפורים שמעתם? רשמו את המספר.',
          coordinates: { lat: 31.8142, lng: 35.1920 },
          difficulty: 3,
          estimatedMinutes: 8,
          pointValue: 90,
          geofenceRadiusMeters: 80,
          triggerMode: 'radius',
        }),
        quizTask({
          id: 'ramot-t2b',
          title: 'שריפת לג בעומר — מה קרה?',
          description:
            'בלג בעומר 2016 פרצה שריפה גדולה ביער רמות. מה גרם לה?',
          coordinates: { lat: 31.8142, lng: 35.1920 },
          difficulty: 5,
          estimatedMinutes: 3,
          pointValue: 100,
          choices: [
            'ברק פגע בעץ',
            'מישהו לא כיבה מדורה',
            'פצמ"ר ירדן',
            'הצתה מכוונת',
          ],
          answers: ['מישהו לא כיבה מדורה', 'מדורה שלא כובתה'],
          tags: ['היסטוריה', 'יער'],
        }),
        photoTask({
          id: 'ramot-t2c',
          title: 'מצאו ישיקה על עץ',
          description:
            'לאחר שריפה יכולה לצמוח ישיקה — צמח טפילי עם ענפים ירוקים עגולים הגדל על עץ אחר. מצאו ישיקה ביער וצלמו. רמז: תחפשו עץ "מת" עם ענפי ירוק עגלגל עליו.',
          coordinates: { lat: 31.8145, lng: 35.1925 },
          difficulty: 7,
          estimatedMinutes: 10,
          pointValue: 150,
          hint: 'ישיקה נראית כמו כדור ירוק על ענף יבש — לרוב על עצי אורן שנפגעו בשריפה',
          hintPenalty: 30,
          tags: ['טבע', 'צמחים'],
        }),
      ],
      requiredTaskCount: 2,
    },

    // ── שלב 3: מצפה נפתוח ──────────────────────────────────────────────────
    {
      id: 'ramot-s3',
      order: 2,
      title: 'מצפה נפתוח — הנקודה הגבוהה',
      tasks: [
        sequenceTask({
          id: 'ramot-t3a',
          title: 'אתגר מצפה נפתוח',
          description:
            'הגעתם למצפה נפתוח בגובה ~707 מטר! עכשיו בצעו את שלושת השלבים לפי הסדר:',
          coordinates: { lat: 31.8142, lng: 35.2128 },
          difficulty: 6,
          estimatedMinutes: 12,
          pointValue: 200,
          steps: [
            {
              id: 'step-1',
              prompt:
                'מה השם התנ"כי של הכפר לפתא שנראה מהמצפה? (רמז: "מי ___" כתוב בספר יהושע)',
              answer: 'ניפטוח',
            },
            {
              id: 'step-2',
              prompt:
                'מה השם של ההר הגבוה שאתם רואים לצפון-מערב, שם נמצא קבר שמואל הנביא? כתבו את שמו הערבי.',
              answer: 'נבי סמואל',
            },
            {
              id: 'step-3',
              prompt:
                'צלמו סלפי של כל הקבוצה עם נוף ירושלים ברקע והקישו "אישור".',
            },
          ],
          hint: 'הכפר לפתא נראה ממש מתחת למצפה — ויש לו שם ששמעתם בשיעור תנ"ך',
          hintPenalty: 25,
        }),
        quizTask({
          id: 'ramot-t3b',
          title: 'שכונת רמות — מתי הוקמה?',
          description:
            'שכונת רמות הוקמה בשנת ___. השלימו את השנה.',
          coordinates: { lat: 31.8142, lng: 35.2128 },
          difficulty: 5,
          estimatedMinutes: 3,
          pointValue: 100,
          choices: ['1948', '1967', '1974', '1982'],
          answers: ['1974'],
          tags: ['היסטוריה'],
        }),
      ],
      requiredTaskCount: 2,
    },

    // ── שלב 4: גתות בית ראשון ───────────────────────────────────────────────
    {
      id: 'ramot-s4',
      order: 3,
      title: 'גתות בית ראשון — 2,500 שנה תחת רגליכם',
      tasks: [
        photoTask({
          id: 'ramot-t4a',
          title: 'צלמו גת עתיקה',
          description:
            'ביער רמות הוסתרו 6 גתות (wine presses) מתקופת בית ראשון — בנות כ-2,500 שנה! גת היא שקע בסלע שדרכו בוצרו ענבים לייצור יין. מצאו גת ותצלמו אותה מקרוב.',
          coordinates: { lat: 31.8138, lng: 35.1950 },
          difficulty: 8,
          estimatedMinutes: 15,
          pointValue: 200,
          hint: 'חפשו שקע בסלע עם ערוץ ניקוז בצדו — לרוב ליד עצים גדולים',
          hintPenalty: 40,
          tags: ['ארכיאולוגיה', 'בית ראשון'],
        }),
        quizTask({
          id: 'ramot-t4b',
          title: 'איך התגלו הגתות?',
          description:
            'כיצד התגלו הגתות הסתומות של בית ראשון ביער רמות?',
          coordinates: { lat: 31.8138, lng: 35.1950 },
          difficulty: 6,
          estimatedMinutes: 3,
          pointValue: 120,
          choices: [
            'ארכיאולוגים חפרו בתכנון',
            'תושב נפל לתוך בור עם כלבו',
            'סלילת כביש חשפה אותן',
            'ילד מצא מטבע ישן',
          ],
          answers: ['תושב נפל לתוך בור עם כלבו', 'תושב שיצא עם כלבו נפל לבור'],
          tags: ['ארכיאולוגיה', 'גילוי'],
        }),
        quizTask({
          id: 'ramot-t4c',
          title: 'ממצא מפתיע בגת',
          description:
            'בתוך אחת הגתות ביער רמות, בזמן הניקוי, נמצא פריט מעניין. מה היה זה?',
          coordinates: { lat: 31.8138, lng: 35.1950 },
          difficulty: 7,
          estimatedMinutes: 3,
          pointValue: 130,
          choices: ['חרב עתיקה', 'מטבע חשמונאי', 'ספר תורה', 'כלי חרס שלם'],
          answers: ['מטבע חשמונאי'],
          tags: ['ארכיאולוגיה'],
        }),
      ],
      requiredTaskCount: 2,
    },

    // ── שלב 5: אנדרטת ה-11 בספטמבר ─────────────────────────────────────────
    {
      id: 'ramot-s5',
      order: 4,
      title: 'אנדרטת ה-11 בספטמבר — עמק האראזים',
      tasks: [
        photoTask({
          id: 'ramot-t5a',
          title: 'האנדרטה הייחודית בעולם',
          description:
            'בעמק האראזים שוכנת האנדרטה היחידה מחוץ לאמריקה שמפרטת את שמות כל 2,974 קורבנות פיגועי ה-11 בספטמבר 2001. צלמו את הפסל (גובה 9 מטר) עם לפחות 10 שמות גלויים ברשימה.',
          coordinates: { lat: 31.8066, lng: 35.1790 },
          difficulty: 5,
          estimatedMinutes: 10,
          pointValue: 150,
          tags: ['היסטוריה', 'אמריקה', '11 בספטמבר'],
        }),
        quizTask({
          id: 'ramot-t5b',
          title: 'מה מוטמע בבסיס האנדרטה?',
          description:
            'בבסיס אנדרטת ה-11 בספטמבר בירושלים הוטמע חומר מיוחד מאמריקה. מה?',
          coordinates: { lat: 31.8066, lng: 35.1790 },
          difficulty: 7,
          estimatedMinutes: 3,
          pointValue: 130,
          choices: [
            'עפר מניו יורק',
            'שבב מתכת מומסת ממגדלי התאומים',
            'אבן גרניט מוושינגטון',
            'מים מהאוקיינוס האטלנטי',
          ],
          answers: ['שבב מתכת מומסת ממגדלי התאומים', 'שבב מתכת ממגדלי התאומים'],
          tags: ['אנדרטה', 'היסטוריה'],
        }),
        numericTask({
          id: 'ramot-t5c',
          title: 'כמה קורבנות?',
          description:
            'כמה שמות של קורבנות רשומים על אנדרטת ה-11 בספטמבר בירושלים? (הסתכלו על הכיתוב)',
          coordinates: { lat: 31.8066, lng: 35.1790 },
          difficulty: 5,
          estimatedMinutes: 3,
          pointValue: 100,
          numericAnswer: 2974,
          numericTolerance: 5,
          tags: ['חישוב', 'אנדרטה'],
        }),
      ],
      requiredTaskCount: 2,
    },

    // ── שלב 6 (גמר): נבי סמואל ──────────────────────────────────────────────
    {
      id: 'ramot-s6',
      order: 5,
      title: 'נבי סמואל — קבר שמואל הנביא',
      isFinal: true,
      tasks: [
        fieldTask({
          id: 'ramot-t6a',
          title: 'הגעתם לפסגה!',
          description:
            'ברכות! הגעתם לנבי סמואל — בגובה 884 מטר, הנקודה הגבוהה בסביבת ירושלים. כאן שוכנת מצודה צלבנית מרשימה עם קבר שמואל הנביא. סמנו נוכחות!',
          coordinates: { lat: 31.8328, lng: 35.1800 },
          difficulty: 6,
          estimatedMinutes: 15,
          pointValue: 150,
          triggerMode: 'radius',
          geofenceRadiusMeters: 60,
        }),
        quizTask({
          id: 'ramot-t6b',
          title: 'הצלבנים על ההר',
          description:
            'הצלבנים שנסעו לכבוש את ירושלים קראו להר נבי סמואל בשם לטיני המתורגם "הר השמחה". מדוע דווקא "שמחה"?',
          coordinates: { lat: 31.8328, lng: 35.1800 },
          difficulty: 7,
          estimatedMinutes: 4,
          pointValue: 150,
          choices: [
            'כי שמחו על הניצחון על הצלאחי',
            'כי זו הייתה הנקודה הראשונה שממנה ראו עולי הרגל את ירושלים',
            'כי שמואל הנביא שמח כאן',
            'כי מצאו כאן אוצר',
          ],
          answers: [
            'כי זו הייתה הנקודה הראשונה שממנה ראו עולי הרגל את ירושלים',
            'ראו ירושלים לראשונה',
          ],
          hint: 'חשבו: עולי רגל שהגיעו ממרחוק — מה היו שמחים לראות?',
          hintPenalty: 20,
          tags: ['צלבנים', 'היסטוריה'],
        }),
        photoTask({
          id: 'ramot-t6c',
          title: 'סלפי ניצחון על הפסגה',
          description:
            'סיימתם את המסע! צלמו תמונת קבוצה על הגג של נבי סמואל עם נוף ירושלים ברקע. מזל טוב!',
          coordinates: { lat: 31.8328, lng: 35.1800 },
          difficulty: 2,
          estimatedMinutes: 5,
          pointValue: 100,
          tags: ['סיום'],
        }),
      ],
      requiredTaskCount: 3,
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// GAME 2 — מסע בגבול | יישוב סנסנה, הר חברון
// ═══════════════════════════════════════════════════════════════════════════════

const GAME_SANSANA = {
  id: 'game-sansana',
  ownerUid: OWNER_UID,
  title: 'מסע בגבול — סנסנה',
  description:
    'מסע קהילתי ביישוב סנסנה בהר חברון — בין שמות תנ"כיים, בורות מים עתיקים, שביל ישראל ונוף לנגב. משחק שדה לנוער שרוצה לגלות את הסיפור מאחורי שם שכבר שמעו בשיעורי תנ"ך.',
  mode: 'team',
  scoringPreset: 'fixed_points_speed',
  registrationFields: [
    { id: 'teamName', label: 'שם הקבוצה', type: 'text', required: true, level: 'team' },
    { id: 'memberCount', label: 'מספר חברים', type: 'number', required: true, level: 'team' },
  ],
  visibility: 'public',
  tags: ['הר חברון', 'תנ"ך', 'טבע', 'נוער', 'שביל ישראל', 'סנסנה'],
  approxLocation: { lat: 31.3628, lng: 34.9030, label: 'יישוב סנסנה, הר חברון' },
  playCount: 0,
  stages: [
    // ── שלב 1: שער היישוב — מה בשם? ────────────────────────────────────────
    {
      id: 'sansana-s1',
      order: 0,
      title: 'שלב א׳: "סנסנה" — שם מהתנ"ך',
      tasks: [
        photoTask({
          id: 'sansana-t1a',
          title: 'צילום קבוצתי בשער הכניסה',
          description:
            'ברוכים הבאים לסנסנה! צלמו תמונת קבוצה מול שלט הכניסה ליישוב. שימו לב לשם — תיכף תגלו מאיפה הוא בא.',
          coordinates: { lat: 31.3628, lng: 34.9030 },
          difficulty: 2,
          estimatedMinutes: 3,
          pointValue: 60,
        }),
        quizTask({
          id: 'sansana-t1b',
          title: 'בספר יהושע',
          description:
            'שם "סנסנה" מופיע בתנ"ך בספר יהושע. עם אילו שתי ערים נוספות היא מוזכרת יחד באותו פסוק?',
          coordinates: { lat: 31.3628, lng: 34.9030 },
          difficulty: 7,
          estimatedMinutes: 5,
          pointValue: 150,
          choices: [
            'חברון ובאר שבע',
            'צקלג ומדמנה',
            'לכיש ומרשה',
            'גת ועזקה',
          ],
          answers: ['צקלג ומדמנה'],
          hint: 'פסוק יהושע ט"ו:ל"א — "וְצִקְלַג וּמַדְמַנָּה וְסַנְסַנָּה"',
          hintPenalty: 30,
          tags: ['תנ"ך', 'יהושע'],
        }),
        quizTask({
          id: 'sansana-t1c',
          title: 'סנסנים בשיר השירים',
          description:
            'בשיר השירים (פרק ז) כתוב: "אֶעֱלֶה בְתָמָר אֹחֲזָה בְּסַנְסִנָּיו". מה הם "סנסנים"?',
          coordinates: { lat: 31.3628, lng: 34.9030 },
          difficulty: 6,
          estimatedMinutes: 3,
          pointValue: 120,
          choices: [
            'שורשי עץ',
            'ענפי הדקל העליונים',
            'עלי דשא',
            'פירות יבשים',
          ],
          answers: ['ענפי הדקל העליונים', 'ענפים עליונים של הדקל'],
          tags: ['תנ"ך', 'שיר השירים'],
        }),
      ],
      requiredTaskCount: 2,
    },

    // ── שלב 2: טיילת האחים ──────────────────────────────────────────────────
    {
      id: 'sansana-s2',
      order: 1,
      title: 'שלב ב׳: טיילת האחים — מבט לנגב',
      tasks: [
        fieldTask({
          id: 'sansana-t2a',
          title: 'הגעתם לטיילת האחים!',
          description:
            'טיילת האחים הוקמה ב-2007 כסמל לאחווה ולגישור בין שכבות שונות בחברה הישראלית. עמדו על הטיילת, הביטו לכיוון דרום לנגב, ורשמו: כמה ישובים שונים ניתן לזהות בנוף?',
          coordinates: { lat: 31.3625, lng: 34.9025 },
          difficulty: 3,
          estimatedMinutes: 5,
          pointValue: 80,
          triggerMode: 'radius',
          geofenceRadiusMeters: 50,
        }),
        quizTask({
          id: 'sansana-t2b',
          title: 'מה מיוחד בבית הספר בסנסנה?',
          description:
            'בית הספר היסודי ביישוב סנסנה משתמש בשיטת חינוך ייחודית מאוד שאינה רגילה בישובים אחרים. מהי?',
          coordinates: { lat: 31.3625, lng: 34.9025 },
          difficulty: 7,
          estimatedMinutes: 3,
          pointValue: 130,
          choices: [
            'חינוך מונטסורי',
            'חינוך אנתרופוסופי (שיטת שטיינר)',
            'חינוך ביתי',
            'חינוך צבאי',
          ],
          answers: ['חינוך אנתרופוסופי (שיטת שטיינר)', 'אנתרופוסופי', 'שטיינר'],
          tags: ['קהילה', 'חינוך'],
        }),
        photoTask({
          id: 'sansana-t2c',
          title: 'פנורמה לנגב',
          description:
            'צלמו פנורמה רחבה מטיילת האחים לכיוון דרום. ציינו בתיאור: מה רואים בצד שמאל? מה בצד ימין? מה נראה הכי רחוק?',
          coordinates: { lat: 31.3625, lng: 34.9025 },
          difficulty: 4,
          estimatedMinutes: 5,
          pointValue: 100,
          tags: ['נוף', 'נגב'],
        }),
      ],
      requiredTaskCount: 2,
    },

    // ── שלב 3: בור סנסנה — מים בשדה ────────────────────────────────────────
    {
      id: 'sansana-s3',
      order: 2,
      title: 'שלב ג׳: בור הסנסנה — מים עתיקים',
      tasks: [
        fieldTask({
          id: 'sansana-t3a',
          title: 'הגעתם לבור המים העתיק!',
          description:
            'בור סנסנה הוא בור מים עתיק שנחצב בידי אדם לפני מאות שנים בסלע הגיר. בעולם העתיק — לפני קידוחי מים — בורות כאלה היו חיוניים לחיים. הגיעו לבור וסמנו נוכחות.',
          coordinates: { lat: 31.3606, lng: 34.9058 },
          difficulty: 4,
          estimatedMinutes: 8,
          pointValue: 100,
          geofenceRadiusMeters: 60,
        }),
        quizTask({
          id: 'sansana-t3b',
          title: 'גיאולוגיה של הבור',
          description:
            'הסלע שבו נחצב הבור הוא סוג סלע נפוץ בהר חברון. מהו?',
          coordinates: { lat: 31.3606, lng: 34.9058 },
          difficulty: 5,
          estimatedMinutes: 3,
          pointValue: 100,
          choices: ['גרניט', 'בזלת', 'גיר (אבן גיר)', 'חול'],
          answers: ['גיר (אבן גיר)', 'גיר', 'אבן גיר', 'limestone'],
          tags: ['גיאולוגיה'],
        }),
        sequenceTask({
          id: 'sansana-t3c',
          title: 'אתגר הבור',
          description: 'ענו על השאלות לפי הסדר — כל שלב פותח את הבא:',
          coordinates: { lat: 31.3606, lng: 34.9058 },
          difficulty: 6,
          estimatedMinutes: 8,
          pointValue: 140,
          steps: [
            {
              id: 'sansana-step-1',
              prompt:
                'לאיזה נחל ראשי מתנקז נחל סנסנה? (שמו הוא גם שם עיר גדולה בנגב)',
              answer: 'נחל באר שבע',
            },
            {
              id: 'sansana-step-2',
              prompt: 'בגובה כמה מטרים שוכן יישוב סנסנה?',
              answer: '522',
            },
            {
              id: 'sansana-step-3',
              prompt:
                'צלמו את פתח הבור מלמעלה ולחצו אישור.',
            },
          ],
          hint: 'נחל סנסנה זורם לנחל חברון, שזורם אל...',
          hintPenalty: 20,
        }),
      ],
      requiredTaskCount: 3,
    },

    // ── שלב 4: שביל ישראל — עולם הטבע ──────────────────────────────────────
    {
      id: 'sansana-s4',
      order: 3,
      title: 'שלב ד׳: שביל ישראל — צמחים ובעלי חיים',
      tasks: [
        geofenceTask({
          id: 'sansana-t4a',
          title: 'על שביל ישראל!',
          description:
            'שביל ישראל (הסמן: פסים כחול-לבן-כחול) עובר דרך שער היישוב סנסנה! הגיעו לנקודה שבה שביל ישראל חוצה את כניסת הישוב וסמנו נוכחות.',
          coordinates: { lat: 31.3635, lng: 34.9022 },
          difficulty: 4,
          estimatedMinutes: 6,
          pointValue: 90,
          geofenceRadiusMeters: 70,
        }),
        photoTask({
          id: 'sansana-t4b',
          title: 'מצאו קורנית (זעתר)!',
          description:
            'קורנית (הנקראת גם "זעתר") היא צמח תבלין ים-תיכוני נפוץ באזור. מצאו אותה, הריחו (ריחה חזק ומיוחד!) וצלמו. אפשר לזהות לפי עלים קטנים עגלגלים וניחוח חזק של תבלין.',
          coordinates: { lat: 31.3635, lng: 34.9022 },
          difficulty: 7,
          estimatedMinutes: 12,
          pointValue: 160,
          hint: 'חפשו שיח קטן עם עלים קטנים ומחוספסים בגוון ירוק-אפרפר — ריחו לאיתור מדויק',
          hintPenalty: 35,
          tags: ['טבע', 'צמחים', 'זעתר'],
        }),
        quizTask({
          id: 'sansana-t4c',
          title: 'עיט מצרי — כמה נותרו?',
          description:
            'העיט המצרי מקנן בצוקות הר חברון ונמצא בסכנת הכחדה. בישראל כולה יש כ-_____ זוגות בלבד.',
          coordinates: { lat: 31.3635, lng: 34.9022 },
          difficulty: 7,
          estimatedMinutes: 3,
          pointValue: 120,
          choices: ['3-5', '30-40', '200-300', 'אלפיים'],
          answers: ['30-40', '30', '40'],
          tags: ['טבע', 'ציפורים'],
        }),
        photoTask({
          id: 'sansana-t4d',
          title: 'עקבות בשטח',
          description:
            'חפשו סימני חיים של בעלי חיים בשטח: עקבות בעפר, תל נמלים, שריטות על עץ, גלל, קן. צלמו את הממצא הכי מעניין שמצאתם וכתבו בתיאור מה לדעתכם השאיר אותו.',
          coordinates: { lat: 31.3635, lng: 34.9022 },
          difficulty: 6,
          estimatedMinutes: 10,
          pointValue: 130,
          tags: ['טבע', 'חיות'],
        }),
      ],
      requiredTaskCount: 3,
    },

    // ── שלב 5 (גמר): חרבת שמשניות — הסנסנה המקראית ─────────────────────────
    {
      id: 'sansana-s5',
      order: 4,
      title: 'שלב ה׳: חרבת שמשניות — הסנסנה המקראית',
      isFinal: true,
      tasks: [
        fieldTask({
          id: 'sansana-t5a',
          title: 'הגעתם לסנסנה המקראית!',
          description:
            'חרבת א-שמסאניאת הוא האתר הארכיאולוגי שמזוהה עם "סנסנה" התנ"כית — נמצא כ-2 קילומטר דרומית לישוב הנוכחי. כאן עמדה העיר שמוזכרת בספר יהושע לפני 3,000 שנה! הגיעו לאתר.',
          coordinates: { lat: 31.3444, lng: 34.9013 },
          difficulty: 7,
          estimatedMinutes: 15,
          pointValue: 180,
          geofenceRadiusMeters: 100,
        }),
        quizTask({
          id: 'sansana-t5b',
          title: 'מה שבט ירש את העיר?',
          description:
            'סנסנה המקראית הייתה בנחלת שבט _____ בדרומה של הארץ.',
          coordinates: { lat: 31.3444, lng: 34.9013 },
          difficulty: 6,
          estimatedMinutes: 3,
          pointValue: 130,
          choices: ['שבט ראובן', 'שבט יהודה', 'שבט שמעון', 'שבט דן'],
          answers: ['שבט יהודה'],
          tags: ['תנ"ך', 'שבטים'],
        }),
        sequenceTask({
          id: 'sansana-t5c',
          title: 'המשימה האחרונה — סיכום המסע',
          description: 'לפני שמסמנים סיום — ענו על שלושה שאלות סיכום:',
          coordinates: { lat: 31.3444, lng: 34.9013 },
          difficulty: 7,
          estimatedMinutes: 8,
          pointValue: 200,
          steps: [
            {
              id: 'san-fin-1',
              prompt:
                'מה שם הכביש הראשי שעובר ליד סנסנה שנבנה ב-2001? (מספר)',
              answer: '3253',
            },
            {
              id: 'san-fin-2',
              prompt:
                'ב-1999 הגיעה קבוצת הקבע הראשונה לסנסנה. לאיזו תנועה השתייכה?',
              answer: 'אור',
            },
            {
              id: 'san-fin-3',
              prompt:
                'צלמו תמונת קבוצה עם שרידי חרבת השמשניות ברקע. מזל טוב — סיימתם את מסע הגבול!',
            },
          ],
        }),
      ],
      requiredTaskCount: 3,
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// GAME 3 — מסע בלב ירושלים | עיר העתיקה
// ═══════════════════════════════════════════════════════════════════════════════

const GAME_OLD_CITY = {
  id: 'game-old-city-youth',
  ownerUid: OWNER_UID,
  title: 'מסע בלב ירושלים — העיר העתיקה',
  description:
    'מסע עם 3,000 שנות היסטוריה בתוך חומות העיר העתיקה של ירושלים — ארבעה רובעים, שמונה שערים, מצודה צלבנית, כנסייה עם מפתח ברזל ישן, כותל של 28 שכבות אבן וסמטאות שמסתירות סודות. משחק שדה לנוער שרוצה לגלות את הנסתר ברחובות הכי עתיקים בעולם.',
  mode: 'team',
  scoringPreset: 'smart_weighted',
  registrationFields: [
    { id: 'teamName', label: 'שם הקבוצה', type: 'text', required: true, level: 'team' },
    { id: 'memberCount', label: 'מספר חברים', type: 'number', required: true, level: 'team' },
  ],
  visibility: 'public',
  tags: ['ירושלים', 'עיר עתיקה', 'היסטוריה', 'נוער', 'עם ישראל', 'ארכיאולוגיה'],
  approxLocation: { lat: 31.7762, lng: 35.2289, label: 'שער יפו, עיר העתיקה, ירושלים' },
  playCount: 0,
  stages: [
    // ── שלב 1: שער יפו ─────────────────────────────────────────────────────
    {
      id: 'oc-s1',
      order: 0,
      title: 'שלב א׳: שער יפו — כניסה לעיר',
      tasks: [
        photoTask({
          id: 'oc-t1a',
          title: 'צילום קבוצתי בשער יפו',
          description:
            'ברוכים הבאים לעיר העתיקה! צלמו תמונת קבוצה מול שער יפו — הכניסה הראשית לעיר. שימו לב לפרצה הגדולה לצד ימין של השער (שלא בנויה כמו שאר החומה).',
          coordinates: { lat: 31.7762, lng: 35.2289 },
          difficulty: 2,
          estimatedMinutes: 3,
          pointValue: 70,
        }),
        quizTask({
          id: 'oc-t1b',
          title: 'מדוע יש פרצה לצד שער יפו?',
          description:
            'ב-1898 נפרצה פרצה גדולה בחומה בצד שער יפו. מדוע?',
          coordinates: { lat: 31.7762, lng: 35.2289 },
          difficulty: 6,
          estimatedMinutes: 3,
          pointValue: 120,
          choices: [
            'כדי לאפשר לקיסר גרמניה וילהלם השני להיכנס בכרכרה',
            'הבריטים פרצו אותה במלחמת 1948',
            'הצלבנים פרצו אותה ב-1099',
            'קרתה רעידת אדמה',
          ],
          answers: ['כדי לאפשר לקיסר גרמניה וילהלם השני להיכנס בכרכרה', 'כרכרה של קיסר גרמניה'],
          hint: 'לפי אגדה — מי שנכנס דרך שער ירושלים על סוסב לבן יכבוש אותה',
          hintPenalty: 20,
          tags: ['שערים', 'עות\'מאני'],
        }),
        photoTask({
          id: 'oc-t1c',
          title: 'הקברים מאחורי הסבכה',
          description:
            'ממש בכניסה לשער יפו, מצד ימין, יש שני קברים מאחורי סבכת ברזל. לפי האגדה — מי קבור שם? חפשו, קראו את הסבר אם יש, וצלמו.',
          coordinates: { lat: 31.7763, lng: 35.2290 },
          difficulty: 6,
          estimatedMinutes: 5,
          pointValue: 120,
          hint: 'האגדה אומרת שסולימאן הנהרס הוציא להורג שני אדריכלים — כי הם שכחו לכלול את...',
          hintPenalty: 25,
          tags: ['שערים', 'אגדה'],
        }),
      ],
      requiredTaskCount: 2,
    },

    // ── שלב 2: מגדל דוד ─────────────────────────────────────────────────────
    {
      id: 'oc-s2',
      order: 1,
      title: 'שלב ב׳: מגדל דוד — לא של דוד',
      tasks: [
        numericTask({
          id: 'oc-t2a',
          title: 'ספרו שכבות אבן!',
          description:
            'במגדל דוד נמצאות 16 שכבות אבן הרודיאניות מקוריות מלפני 2,000 שנה. עמדו לידן וספרו — כמה שכבות אתם רואים?',
          coordinates: { lat: 31.7762, lng: 35.2295 },
          difficulty: 5,
          estimatedMinutes: 5,
          pointValue: 120,
          numericAnswer: 16,
          numericTolerance: 2,
          tags: ['מגדל דוד', 'ארכיאולוגיה'],
        }),
        quizTask({
          id: 'oc-t2b',
          title: 'מגדל דוד — האם דוד בנה אותו?',
          description:
            'מגדל דוד נקרא "מגדל דוד" — אבל האם המלך דוד בנה אותו?',
          coordinates: { lat: 31.7762, lng: 35.2295 },
          difficulty: 5,
          estimatedMinutes: 3,
          pointValue: 100,
          choices: [
            'כן, דוד המלך בנה אותו כחלק מהארמון שלו',
            'לא — הביזנטים טעו לחשוב שכן, אבל בנייתו מתקופת החשמונאים והורדוס',
            'כן, אבל רק חלק ממנו — הצלבנים השלימו',
            'לא ידוע בוודאות',
          ],
          answers: ['לא — הביזנטים טעו לחשוב שכן, אבל בנייתו מתקופת החשמונאים והורדוס'],
          tags: ['מגדל דוד', 'היסטוריה'],
        }),
      ],
      requiredTaskCount: 2,
    },

    // ── שלב 3: הרובע הארמני ─────────────────────────────────────────────────
    {
      id: 'oc-s3',
      order: 2,
      title: 'שלב ג׳: הרובע הארמני — המדינה הנוצרית הראשונה',
      tasks: [
        photoTask({
          id: 'oc-t3a',
          title: 'שלט ארמני',
          description:
            'שלטי הרחובות של העיר העתיקה עשויים אריחים בסגנון ייחודי שהביאו הארמנים לירושלים. מצאו שלט כזה ברובע הארמני וצלמו אותו. שימו לב לכיתוב בשלוש שפות — איזה?',
          coordinates: { lat: 31.7740, lng: 35.2280 },
          difficulty: 4,
          estimatedMinutes: 6,
          pointValue: 100,
          hint: 'חפשו שלטי רחוב מרובועים צבעוניים עם כיתוב בשלוש שפות',
          hintPenalty: 15,
          tags: ['ארמנים', 'אריחים'],
        }),
        quizTask({
          id: 'oc-t3b',
          title: 'ארמניה — הנוצרית הראשונה',
          description:
            'ארמניה הייתה המדינה הראשונה בעולם שאימצה את הנצרות כדת מדינה. באיזו שנה?',
          coordinates: { lat: 31.7740, lng: 35.2280 },
          difficulty: 7,
          estimatedMinutes: 3,
          pointValue: 140,
          choices: ['33 לספירה', '301 לספירה', '451 לספירה', '622 לספירה'],
          answers: ['301 לספירה', '301'],
          tags: ['ארמנים', 'נצרות', 'היסטוריה'],
        }),
        quizTask({
          id: 'oc-t3c',
          title: 'ההישג הארמני הראשון בירושלים',
          description:
            'הארמנים בירושלים הקימו מוסד אחד ב-1833 שהיה "ראשון" של סוגו בכל העיר. מה היה?',
          coordinates: { lat: 31.7740, lng: 35.2280 },
          difficulty: 8,
          estimatedMinutes: 3,
          pointValue: 150,
          choices: [
            'בית חולים',
            'בית דפוס (דפוס)',
            'בית ספר לנשים',
            'בנק',
          ],
          answers: ['בית דפוס (דפוס)', 'בית דפוס', 'דפוס'],
          tags: ['ארמנים', 'היסטוריה'],
        }),
      ],
      requiredTaskCount: 2,
    },

    // ── שלב 4: הרובע היהודי ─────────────────────────────────────────────────
    {
      id: 'oc-s4',
      order: 3,
      title: 'שלב ד׳: הרובע היהודי — שורשים ושיקום',
      tasks: [
        photoTask({
          id: 'oc-t4a',
          title: 'החומה הרחבה — מחזקיהו המלך',
          description:
            'החומה הרחבה הוקמה לפני 2,700 שנה על ידי חזקיהו מלך יהודה, לפני שפלש סנחריב מלך אשור. חפשו אותה ברובע היהודי (רוחבה 7 מטר!) וצלמו. שימו לב — גלויה מתחת לפני הרחוב הנוכחי!',
          coordinates: { lat: 31.7758, lng: 35.2305 },
          difficulty: 5,
          estimatedMinutes: 8,
          pointValue: 130,
          hint: 'החומה הרחבה גלויה ברחוב "פלוגות הכותל" ברובע היהודי — תחפשו שרידי חומה ישנה עם שלט הסבר',
          hintPenalty: 25,
          tags: ['חומה', 'חזקיהו', 'ארכיאולוגיה'],
        }),
        quizTask({
          id: 'oc-t4b',
          title: 'כמה פעמים נהרסה החורבה?',
          description:
            'בית הכנסת "החורבה" ברובע היהודי (ניתן לראות את כיפתו מרחוק) נהרס ושוקם מספר פעמים. כמה פעמים נהרסה?',
          coordinates: { lat: 31.7750, lng: 35.2330 },
          difficulty: 6,
          estimatedMinutes: 3,
          pointValue: 120,
          choices: ['פעם אחת', 'פעמיים', 'שלוש פעמים', 'ארבע פעמים'],
          answers: ['פעמיים', '2'],
          hint: 'חורבן ראשון: שרפו אותה נושים ב-1720. חורבן שני: הלגיון הירדני ב-1948.',
          hintPenalty: 20,
          tags: ['חורבה', 'בית כנסת'],
        }),
        sequenceTask({
          id: 'oc-t4c',
          title: 'הקרדו הרומי — רחוב בן 2,000 שנה',
          description: 'מצאו את הקרדו הרומי ברובע היהודי ובצעו את שלושת השלבים:',
          coordinates: { lat: 31.7758, lng: 35.2322 },
          difficulty: 6,
          estimatedMinutes: 10,
          pointValue: 160,
          steps: [
            {
              id: 'oc-cardo-1',
              prompt: 'הקרדו היה הרחוב הראשי של ירושלים הרומית. מה היה רוחבו המקורי במטרים?',
              answer: '22.5',
            },
            {
              id: 'oc-cardo-2',
              prompt: 'מצאו שתי עמודות רומיות שלמות בקרדו. בין כמה מטרים המרחק בין עמוד לעמוד?',
              answer: '5.77',
            },
            {
              id: 'oc-cardo-3',
              prompt: 'צלמו את העמודות הרומיות עם רחוב ירושלים המודרני ברקע — ניגוד של 2,000 שנה!',
            },
          ],
          tags: ['קרדו', 'רומאים'],
        }),
      ],
      requiredTaskCount: 3,
    },

    // ── שלב 5: הכותל המערבי ─────────────────────────────────────────────────
    {
      id: 'oc-s5',
      order: 4,
      title: 'שלב ה׳: הכותל המערבי — 28 שכבות מעל הקרקע',
      tasks: [
        numericTask({
          id: 'oc-t5a',
          title: 'ספרו שכבות הכותל!',
          description:
            'לכותל המערבי 45 שכבות אבן בסך הכל — 17 מתחת לאדמה, והשאר מעל. כמה שכבות יש מעל פני הקרקע? (ספרו מלמטה ועד למעלה!)',
          coordinates: { lat: 31.7767, lng: 35.2345 },
          difficulty: 5,
          estimatedMinutes: 8,
          pointValue: 120,
          numericAnswer: 28,
          numericTolerance: 1,
          tags: ['כותל', 'ארכיאולוגיה'],
        }),
        quizTask({
          id: 'oc-t5b',
          title: 'האבן הגדולה ביותר',
          description:
            'האבן הגדולה ביותר בכותל המערבי מוצאת מצפון לקשת ווילסון. מה המשקל המשוערב שלה?',
          coordinates: { lat: 31.7767, lng: 35.2345 },
          difficulty: 7,
          estimatedMinutes: 3,
          pointValue: 140,
          choices: ['5 טון', '50 טון', '250-300 טון', 'אלף טון'],
          answers: ['250-300 טון', '300 טון', '250 טון'],
          tags: ['כותל', 'הרודוס'],
        }),
        photoTask({
          id: 'oc-t5c',
          title: 'רגע שקט ליד הכותל',
          description:
            'צלמו (בכבוד ובשקט) את הכותל עם המתפללים. חשבו: כמה שנים אנשים עומדים כאן ומתפללים? כתבו בתיאור התמונה מה הרגשתם.',
          coordinates: { lat: 31.7767, lng: 35.2345 },
          difficulty: 3,
          estimatedMinutes: 5,
          pointValue: 100,
          tags: ['כותל', 'רגש'],
        }),
      ],
      requiredTaskCount: 3,
    },

    // ── שלב 6: שער האריות ───────────────────────────────────────────────────
    {
      id: 'oc-s6',
      order: 5,
      title: 'שלב ו׳: כנסיית הקבר — המפתח הישן',
      tasks: [
        quizTask({
          id: 'oc-t6a',
          title: 'מי מחזיק במפתח?',
          description:
            'בכנסיית הקבר הקדוש יש מפתח ברזל ישן (אורך ~30 ס"מ). מי מחזיק בו ומאז מתי?',
          coordinates: { lat: 31.7784, lng: 35.2296 },
          difficulty: 7,
          estimatedMinutes: 4,
          pointValue: 140,
          choices: [
            'הוותיקן — מאז 1948',
            'משפחת ג\'ואדה המוסלמית — מאז שצלאח א-דין נתן להם אותו ב-1187',
            'הממשלה הישראלית — מאז 1967',
            'הכנסייה הקתולית — מאז הצלבנים',
          ],
          answers: ['משפחת ג\'ואדה המוסלמית — מאז שצלאח א-דין נתן להם אותו ב-1187', 'משפחת ג\'ואדה', 'ג\'ואדה'],
          tags: ['כנסייה', 'מפתח', 'מוסלמים'],
        }),
        photoTask({
          id: 'oc-t6b',
          title: 'הדלת הגדולה של כנסיית הקבר',
          description:
            'צלמו את הכניסה לכנסיית הקבר הקדוש עם הדלת הגדולה הכפולה. שימו לב: רק דלת אחת פתוחה — מדוע? (שאלו מדריך או חפשו שלט)',
          coordinates: { lat: 31.7784, lng: 35.2296 },
          difficulty: 4,
          estimatedMinutes: 5,
          pointValue: 110,
          tags: ['כנסייה', 'דלת'],
        }),
        quizTask({
          id: 'oc-t6c',
          title: 'כמה תחנות בתוך הכנסייה?',
          description:
            'הוויה דולורוזה (Via Dolorosa) כוללת 14 תחנות. כמה מהן נמצאות בתוך כנסיית הקבר הקדוש?',
          coordinates: { lat: 31.7784, lng: 35.2296 },
          difficulty: 6,
          estimatedMinutes: 3,
          pointValue: 120,
          choices: ['1', '3', '5', '9'],
          answers: ['5'],
          tags: ['ויה דולורוזה', 'כנסייה'],
        }),
      ],
      requiredTaskCount: 3,
    },

    // ── שלב 7 (גמר): שער האריות ─────────────────────────────────────────────
    {
      id: 'oc-s7',
      order: 6,
      title: 'שלב ז׳: שער האריות — היציאה המנצחת',
      isFinal: true,
      tasks: [
        photoTask({
          id: 'oc-t7a',
          title: 'ספרו את החיות על שער האריות!',
          description:
            'על שער האריות חצובים בעלי חיים — שניים מצד ימין ושניים מצד שמאל. כמה בסך הכל? צלמו את החיות בקלוז-אפ.',
          coordinates: { lat: 31.7803, lng: 35.2380 },
          difficulty: 4,
          estimatedMinutes: 5,
          pointValue: 100,
          tags: ['שערים', 'שער האריות'],
        }),
        quizTask({
          id: 'oc-t7b',
          title: 'אריות — או לא?',
          description:
            'החיות הגדולות על שער האריות אינן אריות אמיתיים! מה הן באמת, ולמי הן היו סמל?',
          coordinates: { lat: 31.7803, lng: 35.2380 },
          difficulty: 8,
          estimatedMinutes: 4,
          pointValue: 170,
          choices: [
            'נמרים — סמל הסולטן ביברס הממלוכי',
            'אריות — סמל ממלכת יהודה',
            'כלבים — סמל הצלבנים',
            'פרסים — סמל האימפריה הפרסית',
          ],
          answers: ['נמרים — סמל הסולטן ביברס הממלוכי', 'נמרים', 'לאופרדים'],
          hint: 'הסולטן ביברס (שלט לפני ~750 שנה) חצב אותם — החיה הייתה סמלו האישי',
          hintPenalty: 30,
          tags: ['שערים', 'ממלוכים'],
        }),
        quizTask({
          id: 'oc-t7c',
          title: '1967 — דרך איזה שער?',
          description:
            'ב-7 ביוני 1967 נכנסו צנחני צה"ל לעיר העתיקה וכבשו את הכותל המערבי. דרך איזה שער נכנסו?',
          coordinates: { lat: 31.7803, lng: 35.2380 },
          difficulty: 6,
          estimatedMinutes: 3,
          pointValue: 130,
          choices: ['שער יפו', 'שער שכם', 'שער האריות', 'שער ציון'],
          answers: ['שער האריות'],
          tags: ['שערים', '1967', 'ישראל'],
        }),
        photoTask({
          id: 'oc-t7d',
          title: 'סלפי ניצחון — יצאנו מהעיר העתיקה!',
          description:
            'עשיתם זאת — יצאתם מהעיר העתיקה דרך שער האריות! צלמו תמונת קבוצה מול השער עם כל חברי הקבוצה. מזל טוב על מסע בלב ירושלים!',
          coordinates: { lat: 31.7803, lng: 35.2380 },
          difficulty: 2,
          estimatedMinutes: 3,
          pointValue: 80,
          tags: ['סיום'],
        }),
      ],
      requiredTaskCount: 4,
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEED — write all 3 games to Firestore
// ═══════════════════════════════════════════════════════════════════════════════

async function seedGame(game) {
  const now = new Date().toISOString();
  const doc = { ...game, createdAt: now, updatedAt: now };

  await db.doc(`users/${OWNER_UID}/games/${game.id}`).set(doc);

  // Public gallery index
  const allTasks = game.stages.flatMap((s) => s.tasks);
  const estimatedTotalMinutes = allTasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 5), 0);
  await db.doc(`publicGames/${game.id}`).set({
    id: game.id,
    ownerUid: OWNER_UID,
    ownerDisplayName: 'Demo Creator',
    title: game.title,
    description: game.description,
    mode: game.mode,
    scoringPreset: game.scoringPreset,
    tags: game.tags,
    approxLocation: game.approxLocation,
    playCount: 0,
    stageCount: game.stages.length,
    taskCount: allTasks.length,
    estimatedTotalMinutes,
    requirement: 'gps',
    createdAt: now,
    updatedAt: now,
  });

  // Public task library
  const batch = db.batch();
  for (const t of allTasks) {
    batch.set(db.doc(`publicTasks/${game.id}_${t.id}`), {
      id: `${game.id}_${t.id}`,
      sourceGameId: game.id,
      sourceGameTitle: game.title,
      ownerUid: OWNER_UID,
      ownerDisplayName: 'Demo Creator',
      title: t.title,
      description: t.description ?? '',
      type: t.type,
      coordinates: t.coordinates,
      difficulty: t.difficulty,
      estimatedMinutes: t.estimatedMinutes,
      pointValue: t.pointValue,
      tags: t.tags ?? [],
      copyCount: 0,
      createdAt: now,
    });
  }
  await batch.commit();

  const totalPoints = allTasks.reduce((s, t) => s + (t.pointValue ?? 100), 0);
  console.log(
    `[seed] ✓ "${game.title}" — ${game.stages.length} שלבים, ${allTasks.length} משימות, ${totalPoints} נק' מקס, ~${estimatedTotalMinutes} דק'`
  );
}

async function main() {
  console.log('[seed] מוסיף 3 משחקים מותאמי נוער...');
  await seedGame(GAME_RAMOT);
  await seedGame(GAME_SANSANA);
  await seedGame(GAME_OLD_CITY);
  console.log('\n[seed] ✅ הושלם! שלושת המשחקים נוספו לגלריה הציבורית.');
  console.log('[seed]   1. מסתרי יער רמות (game-ramot-bet)');
  console.log('[seed]   2. מסע בגבול — סנסנה (game-sansana)');
  console.log('[seed]   3. מסע בלב ירושלים (game-old-city-youth)');
}

main().catch((err) => {
  console.error('[seed] שגיאה:', err);
  process.exit(1);
});
