#!/usr/bin/env node
// The 22.10.2026 Jerusalem race, as a `rushpoint.game` file that importGameFile reads.
//   node docs/events/2026-10-22-jerusalem-race/build-game.mjs > docs/events/2026-10-22-jerusalem-race/game.json
//
// Source of truth for the content is ROUTE.md next to this file; this turns it into a game.
// Shape, built only from features that already exist:
//   stage 1  "זינוק"       the bridge, everyone
//   stage 2  "העיר"        every zone mission in ONE stage, requiredTaskCount 8. Zones are capped at
//                          3 by EXCLUSIVE PAIRS (a group yields at most one completion), which also
//                          keeps a team to at most one partner per zone. Nearest-first routing then
//                          moves a team to the next zone once its own is used up. A wave is started
//                          by routing each team's FIRST mission from the console (forceAssignTask).
//   stage 3  "כיכר ציון"   the 18 voices, everyone; the falafel duels are scored live (adjustTeamScore).
// Placeholders that must be settled on the rehearsal walk are marked "⚠ לעדכן" in adminNotes.

const at = (hhmm) => `2026-10-22T${hhmm}:00+03:00`; // Israel is still on summer time on 22.10
const iso = (hhmm) => new Date(at(hhmm)).toISOString();

function located(t) {
  const { lat, lng, r = 60, ...rest } = t;
  return {
    coordinates: { lat, lng }, triggerMode: 'radius', geofenceRadiusMeters: r,
    difficulty: 5, estimatedMinutes: 10, expectedDurationMinutes: 6, pointValue: 100, ...rest,
  };
}
const video = (min = 5, max = 45, extra = {}) => ({
  type: 'photo',
  smart: { enabled: true, verificationType: 'photo_upload', captureKind: 'video', videoMinSeconds: min, videoMaxSeconds: max, autoApprove: true, ...extra },
});
const code = (secretCode, adminNotes) => ({
  type: 'smart_station',
  smart: { enabled: true, verificationType: 'code_verification', secretCode, codeInputLabel: 'הקוד', ...(adminNotes ? { adminNotes } : {}) },
});

const stages = [
  {
    id: 'j-open', order: 0, title: 'זינוק: גשר המיתרים', isFinal: false,
    tasks: [
      located({
        id: 'p1-bridge', title: 'תהיו הגשר', lat: 31.78732, lng: 35.19937, r: 80, maxConcurrentTeams: 10,
        description: 'הגשר המואר מאחוריכם. אחד מכם הוא התורן, וכל השאר הם הכבלים שיורדים ממנו. צלמו סרטון קצר שבו הגשר האמיתי והגשר שלכם נראים ביחד, וצעקו את שם הקבוצה.',
        ...video(5, 20),
      }),
    ],
  },
  {
    id: 'j-city', order: 1, title: 'השוק, לב העיר והחומות', isFinal: false, requiredTaskCount: 8,
    tasks: [
      // ── 🟢 השוק ──
      located({
        id: 's1-100g', title: '100 גרם, לא גרם יותר', lat: 31.78480, lng: 35.21294, r: 80, maxConcurrentTeams: 1,
        type: 'numeric',
        // Non-overlapping ranges (the validator refuses overlap); a scale can show decimals.
        answerOutcomes: [
          { id: 'exact', label: '100 בדיוק', range: { min: 100, max: 100 }, points: 150, message: '100 בדיוק. הספק לא מאמין.' },
          { id: 'close-lo', label: '98 עד 99.9', range: { min: 98, max: 99.99 }, points: 100, message: 'כמעט מושלם.' },
          { id: 'close-hi', label: '100.1 עד 102', range: { min: 100.01, max: 102 }, points: 100, message: 'כמעט מושלם.' },
          { id: 'near-lo', label: '95 עד 97.9', range: { min: 95, max: 97.99 }, points: 50, message: 'קרוב. חצי ניקוד.' },
          { id: 'near-hi', label: '102.1 עד 105', range: { min: 102.01, max: 105 }, points: 50, message: 'קרוב. חצי ניקוד.' },
        ],
        unmatchedPoints: 0,
        description: 'על המשקל יש כיסוי, ואתם לא רואים את המספר. בנו בדיוק 100 גרם של פירות יבשים. כל אחד מכם מוסיף לפחות פרי אחד, בתורות, ויש לפחות 4 סוגים. יש ניסיון אחד. כשאתם מוכנים צועקים "שוקל!", הספק מוריד את הכיסוי, ואתם מקלידים את המספר שמופיע. 100 בדיוק שווה בונוס.',
      }),
      located({
        id: 's2-spice', title: 'סולם החריף', lat: 31.78492, lng: 35.21260, r: 80, maxConcurrentTeams: 1,
        description: 'רק אחד מכם עושה את זה, ובוחרים אותו עכשיו, לפני שממשיכים לקרוא. ...נבחר? הספק נותן לו לטעום שלוש דרגות של חריף, קצה כפית מכל אחת. אחרי כל דרגה הוא אומר למצלמה, ברור: "שרה שרה שיר שמח". מי שמגמגם חוזר על המשפט. אחרי השלישית הספק לוחש לו את הקוד.',
        ...code('פלפל', 'שת"פ תבלינים. ⚠ לעדכן מיקום החנות. הספק לוחש את הקוד רק אחרי הדרגה השלישית.'),
      }),
      located({
        id: 's3-vendor', title: 'ספק ליום אחד', lat: 31.78560, lng: 35.21200, r: 80, maxConcurrentTeams: 1,
        expiresAt: iso('20:45'),
        description: 'רק אחד מכם, ובוחרים לפני שממשיכים לקרוא. ...נבחר? הוא עומד מאחורי הדוכן, ותוך 5 דקות מוכר 3 פריטים לקונים אמיתיים, בצעקות של שוק. הספק מחליט אם זה נחשב, ונותן לכם את הקוד.',
        ...code('סחורה', 'שת"פ ספק ירקות. נסגר ב 20:45, ולכן רק לגל א\'. ⚠ לעדכן מיקום הדוכן.'),
      }),
      located({
        id: 's4-shutters', title: 'מצאו את הפנים', lat: 31.78480, lng: 35.21250, r: 100, maxConcurrentTeams: 3,
        releaseAt: iso('21:00'),
        description: 'כשהשוק נסגר, התריסים הופכים לגלריה: מאות דיוקנאות שצייר שלמה סוזה. מצאו שלושה מהם: (1) הפיזיקאי שהציעו לו להיות נשיא המדינה והוא סירב. (2) ראש הממשלה היחידה שהייתה למדינה. (3) הזמר שהיה לסמל של רגאיי. צלמו סרטון אחד שבו אתם עומדים ליד כל אחד מהם, באותה תנוחה כמוהו.',
        ...video(10, 60),
      }),
      located({
        id: 's5-davidka', title: 'תהיו הפגז', lat: 31.78450, lng: 35.21509, r: 60, maxConcurrentTeams: 2,
        description: 'ב 1948 הדוידקה עשתה הרבה יותר רעש מנזק. עכשיו תורכם: שלושה מכם מרימים את הרביעי ונושאים אותו מקצה הרחבה לקצה השני, בלי להוריד אותו, וכל הקבוצה צועקת "בום" בכל צעד. צלמו את כל המסלול.',
        ...video(5, 45),
      }),
      located({
        id: 's6-silent', title: 'משימה בשקט', lat: 31.78243, lng: 35.21312, r: 50, maxConcurrentTeams: 2,
        hideLocation: true,
        locationClueHe: 'שכונה שנבנתה בשביל להתפלל, ושם של אוהל. מאחורי השוק, ובשקט.',
        description: 'מכאן והלאה אף אחד לא מדבר, אפילו לא בלחישה. אנשים גרים כאן. מצאו את החצר לפי הרמז, ועל הקיר שלה כתוב מספר. המספר הוא הקוד. מי שמדבר, הקבוצה מחכה 2 דקות.',
        ...code('0000', '⚠ לעדכן: לבחור בחזרה את החצר ואת המספר, ולעדכן גם את הרמז.'),
      }),
      // ── 🔵 לב העיר ──
      located({
        id: 'c1-busker', title: 'תשירו לי את המילה', lat: 31.78148, lng: 35.21648, r: 60, maxConcurrentTeams: 1,
        description: 'בראש המדרחוב עומד הנגן הרשמי של המירוץ. תגידו לו: "אנחנו במירוץ, תנגן לנו את שיר המירוץ". הוא ינגן לכם שיר מוכר, בלי מילים ובקצב של מירוץ. הקוד הוא המילה האחרונה בפזמון. לא זוכרים את המילים? שכנעו אנשים במדרחוב לשיר לכם. בלי Shazam: מי שנתפס, הקבוצה מחכה 5 דקות.',
        ...code('כינור', 'שת"פ נגן רחוב, 20:00 עד 21:50. ⚠ לאשר את השיר ואת מילת הקוד מול הטקסט המקורי.'),
      }),
      located({
        id: 'c2-feingold', title: 'החצר שאף אחד לא מכיר', lat: 31.78068, lng: 35.22083, r: 40, maxConcurrentTeams: 2,
        hideLocation: true,
        locationClueHe: 'כל יום אלפי אנשים עוברים לידה ברחוב יפו, ורק מעטים נכנסים. בתים מסוף המאה ה 19, ושם של משפחה.',
        description: 'מצאו את החצר. על השער או על הבניין כתובה שנה, והשנה היא הקוד.',
        ...code('1895', '⚠ לאמת בחזרה את השנה שכתובה בפועל, ולעדכן.'),
      }),
      located({
        id: 'c3-languages', title: '5 שפות', lat: 31.78160, lng: 35.21791, r: 80, maxConcurrentTeams: 3,
        description: 'המשפט הוא "ירושלים לא ישנה בלילה". מצאו במדרחוב שלושה אנשים זרים שכל אחד מהם דובר שפה אחרת, ובקשו מכל אחד לומר את המשפט בשפת האם שלו, למצלמה. עברית ואנגלית לא נחשבות.',
        ...video(10, 60),
      }),
      located({
        id: 'c4-safra', title: 'ממסר על הגב', lat: 31.78032, lng: 35.22373, r: 80, maxConcurrentTeams: 4,
        description: 'כל אחד מכם סוחב חבר אחר על הגב מקצה הרחבה לקצה השני, עד שכולם סחבו וכולם נסחבו. סרטון אחד, נגד השעון. בונוס: בכניסה מרחוב יפו עומד פסנתר, ומי שמנגן עליו את חמשת התווים הראשונים של "ירושלים של זהב" נכנס לסרטון.',
        ...video(10, 60),
      }),
      located({
        id: 'c5-russian', title: 'הכיפות הירוקות', lat: 31.78155, lng: 35.22286, r: 60, maxConcurrentTeams: 3,
        description: 'מולכם כנסייה עם כיפות ירוקות, באמצע מגרש הרוסים. בנו את הכיפה בגוף, כל הקבוצה ביחד, כשהכנסייה מאחוריכם, והחזיקו 10 שניות.',
        ...video(10, 30),
      }),
      located({
        id: 'c6-mural', title: 'תיכנסו לציור', lat: 31.78023, lng: 35.22070, r: 60, maxConcurrentTeams: 3,
        description: 'על הקיר יש ציור ענק ובו דמויות היסטוריות של ירושלים. בחרו דמות אחת ושחזרו את התנוחה שלה, יחד עם עובר אורח אחד ששכנעתם להצטרף.',
        ...video(5, 30),
      }),
      // ── 🟣 החומות ──
      located({
        id: 'w1-flashmob', title: 'פלאש מוב בארבע דקות', lat: 31.77753, lng: 35.22435, r: 80, maxConcurrentTeams: 3,
        description: 'יש לכם ארבע דקות לגרום לעשרה אנשים זרים לרקוד איתכם את אותו ריקוד, באותו זמן, בפריים אחד.',
        ...video(10, 60),
      }),
      located({
        id: 'w2-breach', title: 'הפרצה', lat: 31.77656, lng: 35.22727, r: 60, maxConcurrentTeams: 4,
        type: 'numeric', numericAnswer: 1898, numericTolerance: 0,
        description: 'ליד שער יפו יש פרצה רחבה בחומה, ורכבים נכנסים דרכה. היא נפרצה כדי שקיסר יוכל להיכנס לעיר בכרכרה. באיזו שנה?',
        hint: 'קיסר גרמניה, וילהלם השני.', hintPenalty: 25,
      }),
      located({
        id: 'w3-teddy', title: 'מי מעז', lat: 31.77501, lng: 35.22641, r: 80, maxConcurrentTeams: 4,
        description: 'צלמו את כל הקבוצה כשהחומות המוארות מאחוריכם. ומי שמעז רץ דרך המזרקה: רטוב וקר, ואפשר לוותר.',
        ...video(5, 30),
      }),
      located({
        id: 'w4-madaba', title: 'המפה שבקיר', lat: 31.77503, lng: 35.23090, r: 60, maxConcurrentTeams: 3,
        description: 'אתם ברחוב רומי בן 1,500 שנה. על הקיר יש העתק של מפה עתיקה של ירושלים, והרחוב הזה מופיע בה. מצאו אותו במפה וצלמו את כל הקבוצה מצביעה עליו. מגיעים לכאן דרך שער יפו ורחוב הפטריארכיה הארמנית בלבד.',
        ...video(5, 30),
      }),
      located({
        id: 'w5-kotel', title: 'משפט אחד', lat: 31.77641, lng: 35.23316, r: 60, maxConcurrentTeams: 4,
        expiresAt: iso('21:15'), pointValue: 50,
        type: 'survey',
        description: 'בלי פעלולים ובלי לצלם אנשים מתפללים. תעצרו דקה ותסתכלו. כתבו משפט אחד מכל הקבוצה: בשביל מה באתם הערב.',
      }),
      located({
        id: 'w6-stairs', title: 'מדרגות', lat: 31.77153, lng: 35.22423, r: 60, maxConcurrentTeams: 2,
        description: 'ממסר במדרגות של ימין משה: כל אחד יורד מהטחנה עד הפנס, עולה בחזרה, ונוגע ביד של הבא בתור. סרטון אחד, נגד השעון.',
        ...video(15, 60),
      }),
      located({
        id: 'w7-lions', title: 'פסלים חיים', lat: 31.76981, lng: 35.22446, r: 60, maxConcurrentTeams: 3,
        description: 'כל אחד מכם בוחר אריה מהמזרקה ונעמד בדיוק כמוהו. 30 שניות בלי לזוז, בזמן שמישהו מנסה להצחיק אתכם.',
        ...video(30, 45),
      }),
    ],
    // A group yields at most ONE completion: three groups per zone cap it at 3, and pairing the
    // partners with each other keeps a team to one partner per zone.
    exclusiveGroups: [
      { id: 'g-shuk-partner', taskIds: ['s1-100g', 's2-spice'] },
      { id: 'g-shuk-b', taskIds: ['s3-vendor', 's5-davidka'] },
      { id: 'g-shuk-c', taskIds: ['s4-shutters', 's6-silent'] },
      { id: 'g-city-a', taskIds: ['c1-busker', 'c3-languages'] },
      { id: 'g-city-b', taskIds: ['c2-feingold', 'c6-mural'] },
      { id: 'g-city-c', taskIds: ['c4-safra', 'c5-russian'] },
      { id: 'g-walls-a', taskIds: ['w1-flashmob', 'w3-teddy'] },
      { id: 'g-walls-b', taskIds: ['w2-breach', 'w4-madaba', 'w5-kotel'] },
      { id: 'g-walls-c', taskIds: ['w6-stairs', 'w7-lions'] },
    ],
  },
  {
    id: 'j-final', order: 2, title: 'כיכר ציון', isFinal: true,
    tasks: [
      located({
        id: 'f1-voices', title: '18 קולות', lat: 31.78197, lng: 35.21957, r: 80, maxConcurrentTeams: 10,
        description: 'הגעתם לקו הסיום. המשימה האחרונה: 18 אנשים זרים צועקים את שם הקבוצה שלכם למצלמה, ביחד. אחר כך נשארים בכיכר: ב 22:00 ארבע הקבוצות המובילות עולות לקרב הפלאפל.',
        ...video(5, 30),
      }),
    ],
  },
];

const game = {
  title: 'המירוץ העירוני, ירושלים 22.10',
  description: 'מירוץ לילי ברחבי ירושלים: מהתחנה המרכזית ב 19:30 ועד כיכר ציון ב 22:00, דרך השוק, לב העיר והחומות. מותר ללכת ברגל ולנסוע ברכבת הקלה ובאוטובוסים.',
  mode: 'team',
  scoringPreset: 'fixed_points_speed',
  instructions: {
    title: 'החוקים',
    bodyHe: [
      'מתחילים ב 19:30 בתחנה המרכזית, ומסיימים בכיכר ציון עד 22:00.',
      'מותר ללכת ברגל ולנסוע ברכבת הקלה ובאוטובוסים. מוניות, אופניים וקורקינטים אסורים. לכל אחד מכם צריך להיות רב קו טעון.',
      'כל הקבוצה נשארת ביחד כל הזמן.',
      'לא יורדים ברכבת אחרי תחנת "העירייה". לעיר העתיקה נכנסים רק דרך שער יפו.',
      'בלי אלכוהול, ובלי Shazam או אפליקציות זיהוי.',
      'במקרה חירום לוחצים SOS, והמטה רואה אתכם מיד.',
    ].join('\n'),
  },
  stages,
};

process.stdout.write(JSON.stringify({ format: 'rushpoint.game', schemaVersion: 1, exportedAt: new Date().toISOString(), game }, null, 2));
