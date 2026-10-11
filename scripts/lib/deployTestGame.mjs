// The deploy test game (Ahiya, 2026-10-05): every production deploy puts a game in his creator
// account whose missions ARE the checks, each description saying what to do and what should
// happen, so he never builds a test game by hand. Title: `deploy <YYYY-MM-DD>`.
//
// Pure: returns a game FILE (the `rushpoint.game` format importGameFile reads), so
// scripts/test-deploy-test-game.ts runs it through the same parser and structure checks the
// server does, at the strict go-live level, before anything reaches his account.
//
// GROW IT WITH THE PRODUCT: a feature that needs checking by PLAYING gets a mission here in the
// same change. Checks that are not played (console screens, staff app, printing) belong in the
// checklist PDF (docs/deploy-checks), not here.
//
// The one located mission has no pin on purpose: Quick Setup asks him to place it near where he
// is, which is itself a check, and nobody's home address is written into the repo.

const NOWHERE = { lat: 0, lng: 0 };

/** Shared defaults for a mission played from anywhere. */
function anywhere(t) {
  return {
    triggerMode: 'locationless', locationless: true, coordinates: NOWHERE,
    difficulty: 3, estimatedMinutes: 3, pointValue: 100, maxConcurrentTeams: 50, ...t,
  };
}

/** "What to do" and "what should happen", one block each, the same shape on every mission. */
const say = (todo, expect) => `מה עושים: ${todo}\n\nמה אמור לקרות: ${expect}`;

export const LOCATED_TASK_ID = 'dt-walk';

/**
 * @param date   YYYY-MM-DD, the deploy day (the game's title is `deploy <date>`).
 * @param notes  Optional `{ taskId: text }`: a line appended to that mission as "ידוע: …", for
 *               behaviour that is fixed in the repo but not live yet, so it is not reported twice.
 */
export function buildDeployTestGame(date, notes = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date must be YYYY-MM-DD, got "${date}"`);
  const stages = [
    {
      // One station, room for one team: the second team waits, and its clock stops (2026-10-11).
      id: 'dt-s0', order: 0, title: 'תחנה לקבוצה אחת', isFinal: false,
      tasks: [
        anywhere({
          id: 'dt-station-wait', title: 'תחנה שיש בה מקום לקבוצה אחת', type: 'self_report', maxConcurrentTeams: 1,
          description: say('התחילו שתי קבוצות יחד. הקבוצה שקיבלה את המשימה מחכה חצי דקה ורק אז מסמנת שסיימה.',
            'הקבוצה השנייה רואה "כל התחנות תפוסות כרגע" והשעון שלה נעצר. בקונסולה קופצת הודעה עם שם הקבוצה, ועל השורה שלה כתוב "מחכים לתחנה פנויה, השעון שלהם עצור". כשהראשונה מסיימת, השנייה מקבלת את המשימה לבד תוך כמה שניות.'),
        }),
      ],
    },
    {
      id: 'dt-s1', order: 1, title: 'ניקוד ותשובות', isFinal: false,
      tasks: [
        anywhere({
          id: 'dt-quiz-outcomes', title: 'ניקוד לפי תשובה', type: 'quiz',
          description: say('הקלידו 50 ושלחו. בטלפון השני של הקבוצה, או בקבוצה אחרת, הקלידו 100.',
            'כל תשובה מקבלת את הניקוד שלה: 50 או 100. אחרי הריצה, בדוח ובייצוא ה Excel רואים מי ענה מה.'),
          answerOutcomes: [
            { id: 'o100', label: '100', accepts: ['100'], points: 100 },
            { id: 'o50', label: '50', accepts: ['50'], points: 50 },
          ],
          revealOutcomePoints: true,
        }),
        anywhere({
          id: 'dt-code-outcomes', title: 'קוד תחנה עם ניקוד לפי קוד', type: 'smart_station',
          description: say('הקלידו "זעתר". בקבוצה אחרת הקלידו "מרווה".',
            '"זעתר" נותן 50 ו"מרווה" נותן 100. קוד אחר נדחה, ואפשר לנסות שוב.'),
          answerOutcomes: [
            { id: 'c50', label: 'זעתר', accepts: ['זעתר'], points: 50 },
            { id: 'c100', label: 'מרווה', accepts: ['מרווה'], points: 100 },
          ],
        }),
        anywhere({
          id: 'dt-time-limit', title: 'הגבלת זמן של 2 דקות', type: 'self_report',
          description: say('אל תסיימו. חכו שתי דקות. באמצע, בקשו מהמארגן לעצור את הקבוצה לדקה ולשחרר.',
            'יש ספירה לאחור. בזמן העצירה מופיע "הצוות עצר אתכם לרגע", והספירה ממשיכה מאותו מקום אחרי השחרור. בסוף "הזמן נגמר" והמשחק ממשיך לבד.'),
          timeLimitMinutes: 2,
        }),
        // Issue 46 (2026-10-06): the clocks stop at the TAP, not when the next mission arrives.
        anywhere({
          id: 'dt-tap-stops', title: 'השעון עוצר בלחיצה', type: 'self_report',
          description: say('חכו כמה שניות ולחצו "סמן כהושלם".',
            'הספירה לאחור עוצרת ברגע הלחיצה, בלי לקפוץ למעלה, לא מופיעה בקשת מיקום, והמשימה הבאה מגיעה מיד.'),
          timeLimitMinutes: 3,
        }),
        anywhere({
          id: 'dt-everyone', title: 'משימה לכל הטלפונים', type: 'self_report',
          description: say('צרפו טלפון שני לקבוצה (תפריט ⋯, "הוספת טלפון"). בטלפון השני לחצו "עשיתי את החלק שלי", ואז סיימו מהטלפון ששולח.',
            'בטלפון ששולח אין כפתור נוסף, ומופיע "1 מתוך 2". אחרי הלחיצה בטלפון השני: "2 מתוך 2", ואפשר לסיים. בקבוצה עם טלפון אחד אין כפתור נוסף בכלל.'),
          requiredContributors: 2,
        }),
      ],
    },
    {
      id: 'dt-s2', order: 2, title: 'צילום ווידאו', isFinal: false,
      tasks: [
        anywhere({
          id: 'dt-photo-auto', title: 'צילום עם אישור אוטומטי', type: 'photo',
          description: say('צלמו משהו במצלמה שבתוך האפליקציה, נסו להחליף בין מצלמה קדמית לאחורית, ושלחו.',
            '"שליחה" מופיעה רק אחרי שיש תמונה. מיד אחרי השליחה עוברים למשימה הבאה, וההעלאה ממשיכה ברקע. התמונה מגיעה לקונסולה עם "אושר אוטומטית".'),
          smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true },
        }),
        anywhere({
          id: 'dt-video-range', title: 'וידאו של 10 עד 30 שניות', type: 'photo',
          description: say('צלמו 20 שניות ברשת סלולרית (WiFi כבוי). באמצע ההעלאה: מצב טיסה ל 10 שניות וחזרה. אחר כך שלחו גם קליפ של 5 שניות.',
            'יש פס התקדמות והערכת זמן. אחרי מצב הטיסה ההעלאה ממשיכה מאיפה שעצרה. בקונסולה יש תמונת פתיחה ואורך. הקליפ הקצר מגיע לבדיקה רגילה ולא מאושר אוטומטית.'),
          smart: { enabled: true, verificationType: 'photo_upload', captureKind: 'video', videoMinSeconds: 10, videoMaxSeconds: 30, autoApprove: true },
        }),
        anywhere({
          id: 'dt-photo-review', title: 'צילום שהמארגן דוחה', type: 'photo',
          description: say('צלמו ושלחו. בקונסולה דחו את התמונה עם סיבה. נסו לשלוח את אותה תמונה שוב, ודחו גם אותה.',
            'אחרי 20 שניות התמונה מסומנת באדום בקונסולה. אחרי הדחייה הטלפון מציג את הסיבה, והכפתור הכתום הוא "צלמו שוב". שליחה של אותה תמונה שואלת קודם "בטוחים?". אחרי דחייה שנייה אותה תמונה לא נשלחת יותר, ותמונה חדשה כן.'),
          smart: { enabled: true, verificationType: 'photo_upload', autoApprove: false },
        }),
      ],
    },
    {
      id: 'dt-s3', order: 3, title: 'שטח ובטיחות', isFinal: true,
      tasks: [
        {
          id: LOCATED_TASK_ID, title: 'הליכה לנקודה', type: 'field', triggerMode: 'radius',
          coordinates: NOWHERE, geofenceRadiusMeters: 40,
          difficulty: 3, estimatedMinutes: 10, pointValue: 100, maxConcurrentTeams: 50,
          description: say('בהקמה המהירה סמנו נקודה במרחק הליכה. קודם נסו מתוך הבית, ואז לכו אליה.',
            'בבית המשימה נעולה עם "לכו לנקודה שמסומנת במפה" ומרחק, ולא נפתחת. במפה רק דגל, בלי שם לידו. כשמגיעים היא נפתחת לבד. מהקונסולה "הכנסה" פותחת אותה גם בלי להגיע.'),
        },
        anywhere({
          id: 'dt-sos', title: 'SOS וצ׳אט עם המטה', type: 'self_report',
          description: say('לחצו SOS, כתבו מה קרה ושלחו התראה. בקונסולה לחצו בכרטיס ה SOS על "צ׳אט עם הקבוצה" וכתבו לה.',
            'ה SOS מציג את מספרי החירום ומגיע לקונסולה ולאפליקציית הצוות עם מה שכתבתם. "צ׳אט עם הקבוצה" פותח ישר את השיחה איתה, וההודעה מגיעה לטלפון.'),
        }),
        anywhere({
          id: 'dt-flash', title: 'משימת בזק מהקונסולה', type: 'self_report',
          description: say('בזמן שאתם כאן, בקשו מהמארגן לשלוח משימת בזק במצב "הראשונה בלבד" לשתי קבוצות.',
            'יש צליל ואנימציה. קבוצה אחת לוקחת, השנייה רואה שנלקחה. בפעם הראשונה המארגן לוחץ "לא לאשר, עוד ניסיון": בטלפון קופצת הודעה עם "לנסות שוב", והמשימה נשארת אצל הקבוצה. בפעם השנייה מאשרים: הקבוצה מקבלת נקודות וחוזרת לכאן.'),
        }),
      ],
    },
  ];

  const known = new Set(Object.keys(notes));
  for (const st of stages) for (const t of st.tasks) {
    if (notes[t.id]) { t.description += `\n\nידוע: ${notes[t.id]}`; known.delete(t.id); }
  }
  if (known.size > 0) throw new Error(`notes for unknown missions: ${[...known].join(', ')}`);

  const game = {
    title: `deploy ${date}`,
    description: `משחק בדיקות אוטומטי לדיפלויי של ${date}. כל משימה היא בדיקה: בתיאור כתוב מה עושים ומה אמור לקרות. נבנה על ידי npm run deploy:test-game.`,
    mode: 'team',
    scoringPreset: 'fixed_points_speed',
    // Issue 48 (2026-10-06): a YouTube video in the instructions, watched on the waiting screen.
    instructions: {
      title: 'איך משחקים',
      bodyHe: 'בדיקה: לפני ההזנקה רואים את הסרטון למעלה, ואותו סרטון נמצא גם בכפתור הספר במהלך המשחק.',
      videoUrl: 'https://youtu.be/jNQXAC9IVRw', // the first video ever on YouTube: public, short, stable
    },
    stages,
    // Quick Setup participates only when the game carries an authored step; this one asks for the
    // walking point, which is the check of Quick Setup on a phone as well.
    wizardSteps: [{
      id: 'dt-qs-walk', stageId: 'dt-s3', taskId: LOCATED_TASK_ID, targetFieldPath: 'coordinates',
      instructionPrompt: 'סמנו נקודה במרחק הליכה של כמה דקות ממקום הבדיקה.', isRequired: true,
    }],
  };
  return { format: 'rushpoint.game', schemaVersion: 1, exportedAt: new Date(`${date}T00:00:00Z`).toISOString(), game };
}
