#!/usr/bin/env node
// The 22.10.2026 race, version 4. Same skeleton as v3 (rival pairs on fixed routes, enforced by a card
// exclusive group + unlockAfterTaskIds), new content:
//  * physical missions where headcount helps, a REPRESENTATIVE chosen before the catch is known,
//    and a catch in every mission (reports/משימות פיזיות וקאץ לנוער.md, bank numbers in brackets);
//  * spoken teen Hebrew ("תקליטו", not "הקליטו"): action first, one number, one catch;
//  * a PHOTOGRAPHER walks with every team, judges, and types a gold/silver/bronze code into the team's
//    phone (answerOutcomes). Codes and the hidden "continuations" live in PHOTOGRAPHER-SHEETS.md;
//  * vendors run their station themselves;
//  * no route repeats a mechanic category, has at most one eyes-closed mission and at most two
//    missions that need both rivals at one spot, and has at least one precision mission. The build
//    FAILS if any of that breaks, or if the schedule does.
//
//   node docs/events/2026-10-22-jerusalem-race/build-game-v4.mjs [--print]
//   → game-v4.json, schedule-v4.md, PHOTOGRAPHER-SHEETS.md

import { writeFileSync } from 'node:fs';

// ── Places ────────────────────────────────────────────────────────────────────────────────────────
const P = {
  cbs:       { lat: 31.78922, lng: 35.20322, name: 'רחבת התחנה המרכזית (הצד הרחוק מהמסילה)' },
  goblin:    { lat: 31.78530, lng: 35.21230, name: 'דוכן בשוק (שת"פ) ⚠' },
  fruit:     { lat: 31.78480, lng: 35.21294, name: 'דוכן פירות יבשים, עץ חיים (שת"פ) ⚠' },
  agripas:   { lat: 31.78424, lng: 35.21192, name: 'אגריפס, הרחבה של המדרכה ⚠' },
  nachlaot:  { lat: 31.78243, lng: 35.21312, name: 'נחלאות, סמטה ליד אוהל משה ⚠' },
  busker:    { lat: 31.78148, lng: 35.21648, name: 'ראש מדרחוב בן יהודה (נגן)' },
  benYehuda: { lat: 31.78160, lng: 35.21791, name: 'מדרחוב בן יהודה, בצד' },
  falafel:   { lat: 31.78175, lng: 35.21900, name: 'פלאפליה ליד כיכר ציון (שת"פ) ⚠' },
  zion:      { lat: 31.78197, lng: 35.21957, name: 'כיכר ציון, הצד הפנימי' },
  russian:   { lat: 31.78155, lng: 35.22286, name: 'מגרש הרוסים' },
  safra:     { lat: 31.78032, lng: 35.22373, name: 'כיכר ספרא, רחוק מהכניסות' },
  mamilla:   { lat: 31.77753, lng: 35.22435, name: 'מדרחוב ממילא' },
  jaffaGate: { lat: 31.77690, lng: 35.22690, name: 'מחוץ לשער יפו, 20 מ\' לפני השער' },
  teddy:     { lat: 31.77501, lng: 35.22641, name: 'פארק טדי, 2 מ\' מהמים' },
};
const RAIL = [
  { id: 'cbs', lat: 31.78848, lng: 35.20256 }, { id: 'turim', lat: 31.78795, lng: 35.20681 },
  { id: 'my', lat: 31.78603, lng: 35.21142 }, { id: 'davidka', lat: 31.78458, lng: 35.21521 },
  { id: 'jaffaC', lat: 31.78287, lng: 35.21837 }, { id: 'cityHall', lat: 31.77969, lng: 35.22387 },
];
function dist(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
const walkMin = (a, b) => (dist(a, b) * 1.3) / 70;
const nearestStop = (p) => RAIL.reduce((best, s) => (dist(p, s) < dist(p, best) ? s : best));
function railMin(a, b) {
  const sa = nearestStop(a); const sb = nearestStop(b);
  const hops = Math.abs(RAIL.indexOf(sa) - RAIL.indexOf(sb));
  return hops < 2 ? Infinity : walkMin(a, sa) + 4 + hops * 1.5 + 2 + walkMin(sb, b);
}
function leg(a, b) {
  const w = walkMin(a, b); const r = railMin(a, b);
  return r + 3 < w ? { min: Math.ceil(r), how: 'רכבת' } : { min: Math.ceil(w), how: 'ברגל' };
}

// ── Missions ──────────────────────────────────────────────────────────────────────────────────────
// cat: mechanic category (no route repeats one). eyes: someone plays eyes-closed. duo: needs both rivals
// at the spot. score: 'tiers' (photographer/vendor code), 'num' (photographer types a number, app tiers
// it), or a special. band: thresholds for team sizes 4-6 / 7-9 / 10-12 (headcount missions).
const G = 200; const S = 120; const B = 60;
const M = {
  // [5] — the vendor runs it
  goblin: { place: 'goblin', min: 7, cat: 'דוכן', vendor: true, title: 'המוכר שלא מפסיד', bank: 5, score: 'tiers', by: 'המוכר',
    card: 'קודם תבחרו מי מכם הכי בר מזל. רק אז תמשיכו לקרוא.\n\nהמוכר לא הפסיד באבן נייר ומספריים מאז 1998. תנצחו אותו 3 פעמים ברצף. כל אחד משחק פעם אחת, ובר המזל ראשון.\nנגמרו לכם אנשים? נגמר.',
    secret: 'המוכר משחק תמיד אותו רצף: אבן, אבן, נייר, וחוזר חלילה. קבוצה שמסתכלת ולא רק משחקת שוברת את זה.',
    judge: { g: '3 ניצחונות ברצף', s: '2 ברצף', b: 'פחות' },
    shots: 'המוכר אומר את משפט ה 1998 בפרצוף רציני. תקריב על הידיים. הרגע שמישהו צועק "הוא תמיד אבן!".' },
  // the organizer's own: 100 grams
  grams: { place: 'fruit', min: 8, cat: 'משקל', vendor: true, title: '100 גרם. לא גרם יותר.', bank: 'שלך', score: 'grams', by: 'המוכר',
    card: 'המשקל מכוסה. אתם צריכים להגיע בדיוק ל 100 גרם פירות יבשים.\n\nכל אחד מוסיף לפחות פרי אחד, בתורות, ולפחות 4 סוגים. ניסיון אחד.\nתצעקו "שוקל!", המוכר מוריד את הכיסוי, ותקלידו את המספר. 100 בדיוק שווה כפול.',
    secret: 'אין. הכיסוי הוא כל הקטע.', judge: { g: '98 עד 102 (100 בדיוק: 300)', s: '95 עד 105', b: 'השאר' },
    shots: '12 ידיים מעל המשקל. הוויכוח על משמש אחד. הכיסוי שעולה, והפרצופים.' },
  // [10]
  hands: { place: 'agripas', min: 6, cat: 'אוסף', title: 'הידיים מלאות', bank: 10, score: 'tiers', band: true,
    card: 'קודם תבחרו מי מכם הכי מסודר.\n\nתמונה אחת: כל אחד מחזיק כמה שיותר דברים שונים, רק בידיים. דבר שמופיע אצל שניים? נמחק לשניהם.\nיש המשך. הצלם יגיד לכם.',
    secret: 'ההמשך: המסודר קורא בקול את כל החפצים ב 30 שניות. מה שהוא לא הספיק להגיד לא נספר. ניקוד = אנשים כפול סוגי חפצים שנאמרו.',
    judge: { g: '60 / 85 / 110', s: '35 / 50 / 65', b: 'פחות' },
    shots: 'כל התיקים מתרוקנים. הפריים הקפוא לאורך הקיר. המסודר יורה שמות.' },
  // [13]
  shadow: { place: 'nachlaot', min: 7, cat: 'צל', title: 'הצל', bank: 13, score: 'tiers', quiet: true,
    card: 'פה גרים אנשים, אז מכאן אין מילים. רק סימנים.\n\nתבחרו נציג. הוא מושך פתק מהכובע של הצלם וקורא לבד.\nתבנו מהמילה צל אחד על הקיר, עם כולכם. רק הנציג מכוון, בידיים.\nהצלם מנחש. ניחוש ראשון שווה זהב.',
    secret: 'מילים בכובע: גמל, מנורה, רכבת קלה, תמנון, מגדל דוד. על הקיר הצללים נוגעים, הגופים לא.',
    judge: { g: 'ניחוש ראשון', s: 'שני', b: 'שלישי' },
    shots: 'פתיחה על הקיר ולא על האנשים, ואז משיכה אחורה שחושפת שאף אחד לא נוגע באף אחד. ⚠ קיר מתחת לפנס, לא חלון של בית.' },
  // [12]
  redLight: { place: 'nachlaot', min: 6, cat: 'התגנבות', title: 'רמזור באוזניים', bank: 12, score: 'tiers', band: true, quiet: true,
    card: 'קודם תבחרו מי מכם הכי רועש.\n\nהצלם עומד בסוף הסמטה עם הגב. שומע משהו? מסתובב. מי שזז כשהוא מסתכל חוזר להתחלה.\nהרועש שלכם הולך ראשון. נתפס? כולם חוזרים. 2 דקות.',
    secret: 'הצלם מסתובב על כל רעש, לא לפי זמן. הרועש הוא החוליה החלשה, וזה כל הקטע.',
    judge: { g: '4 / 6 / 8 הגיעו', s: '2 / 4 / 5', b: 'פחות' },
    shots: 'מעל הכתף של הצלם כל הזמן. כל סיבוב הוא שוט: כולם קפואים באמצע צעד.' },
  // [14]
  silentLine: { place: 'nachlaot', min: 5, cat: 'סידור', eyes: true, title: 'השורה השקטה', bank: 14, score: 'tiers', band: true, quiet: true,
    card: 'קודם תבחרו נציג.\n\nתעמדו בשורה לפי יום הולדת, ינואר ראשון. אתם לא מדברים. רק הנציג מדבר, בלחישה ועם עיניים עצומות.\n60 שניות.',
    secret: 'מי שרואה שותק, ומי שמדבר לא רואה. בסוף כל אחד לוחש את התאריך שלו למצלמה.',
    judge: { g: '4 / 6 / 8 במקום הנכון', s: '3 / 4 / 6', b: 'פחות' },
    shots: 'הנציג לוחש בעיניים עצומות. הדשדוש. החשיפה, תאריך אחרי תאריך.' },
  // the organizer's own: the busker
  busker: { place: 'busker', min: 7, cat: 'שיר', partner: 'נגן', duo: true, title: 'תשירו לי את המילה', bank: 'שלך', score: 'code', code: 'כינור', by: 'הנגן',
    card: 'בראש המדרחוב מחכה לכם הנגן של המירוץ. תגידו לו: "באנו לשמוע את השיר".\n\nהוא מנגן לכם ולקבוצה היריבה ביחד, בלי מילים ומהר מדי. הקוד הוא המילה האחרונה בפזמון.\nלא זוכרים? תשכנעו את הרחוב לשיר לכם. Shazam שווה 5 דקות עונש.',
    secret: 'השיר: "ירושלים של זהב", בקצב של מירוץ. הקוד: כינור. הקבוצה שמקלידה ראשונה מקבלת מהנגן 50 נקודות בונוס (המארגן מוסיף).',
    judge: { g: 'קוד נכון', s: '-', b: '-' }, shots: 'שתי הקבוצות מול הנגן. זרים שרים. מי מקליד ראשון.' },
  // the organizer's own: the falafel duel
  falafel: { place: 'falafel', min: 12, cat: 'דו קרב', partner: 'פלאפליה', duo: true, pausesTimer: true, title: 'הדו קרב', bank: 'שלך', score: 'falafel', by: 'איש הצוות בשולחן',
    card: 'פה פוגשים את היריבים. השעון שלכם עוצר פה, אז אין סיבה למהר להגיע.\n\n20 כדורים, 2 דקות. 4 אוכלים מכל קבוצה, עד 5 לאחד. כדור אחד בפה, ופה פתוח לפני הבא. יש מים. בצפירה יש 30 שניות לסיים בנחת.\nהמנצחים בוחרים ליריבים קללה עד התחנה הבאה שלהם.',
    secret: 'קודים בכרטיס מודפס: ניצחון אלוף (250), הפסד כבוד (100), לבד מול השעון סולו (150). קללות לבחירה: הולכים בטור בלי לעקוף, כל אחד סוחב חפץ של מישהו אחר, או מדברים רק בשאלות. מי שמשתעל עוצר ולא נפסל.',
    judge: { g: 'אלוף', s: 'סולו', b: 'כבוד' }, shots: 'שני הצלמים מאותה זווית, בשביל מסך מפוצל. הצפירה. הכרזת הקללה.' },
  // [25]
  coin: { place: 'safra', min: 6, cat: 'דיוק', title: 'המטבע הכי קרוב', bank: 25, score: 'tiers',
    card: 'כל אחד מחליק מטבע על הריצוף לכיוון הכובע של הצלם.\nמטבע שנוגע בכובע? מוחק את כל הזריקות שלכם.\n\nתבחרו נציג שמחליט מאיפה זורקים: 3 מטר או 6. מ 6 הכל עולה דרגה.',
    secret: 'הקרוב ביותר נמדד באורך הנעל של הצלם.', judge: { g: 'פחות מנעל', s: 'נעל עד 3', b: 'השאר' },
    shots: 'שוט נמוך על המטבע שמחליק. "נגע!". המדידה בנעל.' },
  // [24]
  wallSit: { place: 'safra', min: 6, cat: 'סיבולת', title: 'ישיבת קיר', bank: 24, score: 'tiers', band: true,
    card: 'כולכם בישיבת קיר. השעון רץ.\nהוא נעצר רק כשהנציג שלכם צועק "ירושלים".\n\nניקוד: שניות כפול כמה מכם עוד יושבים באותו רגע. תבחרו נציג חמדן, אבל לא יותר מדי.',
    secret: 'אין המשך. מותר לקום מתי שרוצים.', judge: { g: '240 / 335 / 430', s: '140 / 200 / 250', b: 'פחות' },
    shots: 'שורה של רגליים רועדות. הנציג מתלבט. הצעקה.' },
  // [29]
  tower: { place: 'russian', min: 6, cat: 'מגדל', title: 'המגדל', bank: 29, score: 'tiers',
    card: 'קודם תבחרו למי מכם יש את הידיים הכי יציבות.\n\nתבנו מגדל מהדברים שלכם: תיקים, נעליים, מעילים. 2 דקות. הוא עומד לבד, אף אחד לא נוגע בו.\nיש המשך.',
    secret: 'ההמשך: בעל הידיים היציבות שולף חפץ אחד מהאמצע (ג\'נגה), ורק אז מודדים. הנציג הוא הסרגל.',
    judge: { g: 'מעל הכתף', s: 'מעל המותן', b: 'מעל הברך' }, shots: 'השליפה בהילוך איטי. הקריסה או ההישרדות.' },
  // [27]
  threeMin: { place: 'russian', min: 6, cat: 'שעון', eyes: true, title: '3 דקות בראש', bank: 27, score: 'num',
    card: 'קודם תבחרו נציג עם שעון בראש.\n\nכל אחד מחזיק מטבע ביד מושטת. הטלפונים בתיק. מפילים אחד אחד, והאחרון נופל בדיוק אחרי 3 דקות.\nרק הנציג סופר, בלב ועם עיניים עצומות, ומהנהן מתי להפיל.',
    secret: 'הצלם מודד בשעון עצר ומקליד את הסטייה בשניות.', numRanges: [[0, 2, G], [2.01, 5, S], [5.01, 15, B]],
    judge: { g: 'עד 2 שניות סטייה', s: 'עד 5', b: 'עד 15' }, shots: 'תקריב על מטבע שנופל ונוקש. השפתיים של הנציג. שעון העצר.' },
  // [31]
  mime: { place: 'mamilla', min: 6, cat: 'פנטומימה', title: 'פנטומימה עם הגב', bank: 31, score: 'num',
    card: 'מי שמתנדב בוחר מישהו אחר שיעשה את זה. סליחה.\n\nהוא מקבל מהצלם 10 דברים ומציג אותם בלי מילים, עם הגב אליכם. 60 שניות.\nכמה ניחשתם?',
    secret: 'רשימה: רכבת קלה, פלאפל, שוטר תנועה, סבתא בשוק, חתול רחוב, מוכר מיץ, אוטובוס מלא, מעלית שבת, נגן רחוב, תייר אבוד. הצלם עומד מול הנציג.',
    numRanges: [[7, 10, G], [4, 6, S], [1, 3, B]], judge: { g: '7+', s: '4 עד 6', b: '1 עד 3' },
    shots: 'הצלם מול הנציג: בפריים אחד הפנים שלו והקבוצה המבולבלת מאחור.' },
  // [30]
  changed: { place: 'mamilla', min: 6, cat: 'זיכרון', title: 'מה השתנה', bank: 30, score: 'tiers',
    card: 'קודם תבחרו מי מכם שם לב להכל.\n\nהוא מסתכל עליכם 20 שניות ומסתובב. כל אחד משנה בעצמו דבר אחד. יש לו דקה למצוא הכל.\nאחד מכם לא שינה כלום. מי שמגלה מי, בונוס.',
    secret: 'הקבוצה בוחרת בסוד מישהו שלא משנה כלום (פיתיון). שינויים רק על הגוף של כל אחד, בלי החלפת בגדים.',
    judge: { g: '4 / 5 / 7 נמצאו (ופיתיון מעלה דרגה)', s: '2 / 3 / 4', b: 'פחות' }, shots: 'לפני ואחרי בהבזק. הסריקה. חשיפת הפיתיון.' },
  // [32]
  phoneRelay: { place: 'mamilla', min: 6, cat: 'שליחים', title: 'הטלפון שמצלם את עצמו', bank: 32, score: 'num',
    card: 'קודם תבחרו מי מכם הכי מגושם.\n\nטלפון אחד מצלם את כל הדרך ועובר את כולכם, 20 מטר, על כף יד פתוחה. מעבירים רק דרך הרצפה: מניחים, והבא מרים.\nהמגושם שלכם לוקח את 5 המטרים האחרונים.',
    secret: 'זמן בשניות. נפילה מחזירה להתחלה. טלפון בכיסוי, נמוך.', numRanges: [[0, 60, G], [60.01, 100, S], [100.01, 300, B]],
    judge: { g: 'עד 60 שניות', s: 'עד 100', b: 'עד 300' }, shots: 'הסרטון של הטלפון עצמו הוא השוט. הצלם מצלם רק את המגושם בסוף.' },
  // [34]
  tunnel: { place: 'jaffaGate', min: 6, cat: 'מנהרה', title: 'מנהרת המעילים', bank: 34, score: 'num',
    card: 'זוגות, בן עם בן ובת עם בת, מחזיקים מעיל מעל הראש. ככה בונים מנהרה.\nהצלם עובר בה ומצלם. זוג שהוא עבר הולך להיות קשת חדשה בהתחלה, והמנהרה לא נגמרת.\n\nנציג אחד קובע את הסדר. כמה צעדים הצלם מתקדם ב 60 שניות?',
    secret: 'הצלם סופר צעדים ומקליד. רק על המדרכה, אף פעם לא בכביש של השער.', numRanges: [[22, 200, G], [15, 21, S], [1, 14, B]],
    judge: { g: '22+ צעדים', s: '15 עד 21', b: 'פחות' }, shots: 'נקודת המבט מתוך המנהרה. אחר כך רחב מהצד.' },
  // [35]
  twenty: { place: 'jaffaGate', min: 5, cat: 'דיוק', title: '20 שניות בדיוק', bank: 35, score: 'num',
    card: 'מהקו עד השלט: הראשון יוצא, והאחרון מגיע בדיוק אחרי 20 שניות.\nכל אחד יוצא כשהנציג מסמן, ורק הוא סופר.\n\nריצה? פסילה.',
    secret: 'הצלם מקליד את הסטייה בשניות. רק על המדרכה.', numRanges: [[0, 0.5, G], [0.51, 1.5, S], [1.51, 5, B]],
    judge: { g: 'עד חצי שנייה', s: 'עד 1.5', b: 'עד 5' }, shots: 'שעון העצר של הצלם שעוצר על 20.0. האחרון מאט בכוח.' },
  // [36]
  blind: { place: 'teddy', min: 6, cat: 'עיוור', eyes: true, title: 'הנווט העיוור', bank: 36, score: 'num',
    card: 'קודם תבחרו מי מכם הכי סומך על אנשים.\n\nהוא עוצם עיניים, וכובע מחכה לו 15 מטר משם. אתם מכוונים, כל אחד מילה אחת לפי התור.\nנעמד על הכובע? עוצרים שעון.',
    secret: 'שומר מאותו מין הולך לידו בעיניים פקוחות ואומר רק "עצור". משטח שטוח, 2 מ\' מהמים.', numRanges: [[0, 60, G], [60.01, 120, S], [120.01, 400, B]],
    judge: { g: 'עד 60 שניות', s: 'עד 120', b: 'השאר' }, shots: 'העיניים העצומות. שרשרת המילים. העמידה על הכובע.' },
  // [38]
  line: { place: 'teddy', min: 6, cat: 'שרשרת', title: 'הקו הכי ארוך', bank: 38, score: 'tiers', band: true,
    card: 'קודם תבחרו מי מכם הכי גבוה.\n\nתבנו קו אחד מכל מה שיש עליכם: תיקים, מעילים, שרוכים, כובעים. 90 שניות. כל תיק נשאר ליד הבעלים.\nיש המשך.',
    secret: 'ההמשך: הגבוה מודד את הקו בכפות הרגליים שלו, עקב בבוהן. רגליים גדולות נותנות פחות יחידות. אחר כך כולם לובשים הכל בחזרה.',
    judge: { g: '40 / 55 / 70 כפות רגליים', s: '25 / 35 / 45', b: 'פחות' }, shots: 'הערימה. הקו מלמעלה אם יש נקודה בטוחה. העקב בבוהן.' },
  // [39]
  tiles: { place: 'teddy', min: 6, cat: 'משבצות', title: 'המשבצות שנופלות', bank: 39, score: 'tiers', band: true,
    card: 'כל אחד על משבצת, ומשבצת ריקה בין שניים.\nהצלם מגריל שורה או טור, ומי שעליה מתיישב. אחרי כל הגרלה מותר צעד אחד.\n\n5 הגרלות. הנציג שלכם מנחש מראש כמה יישארו.',
    secret: 'הגרלה בקובייה. ניחוש מדויק של הנציג מעלה דרגה.', judge: { g: '3 / 4 / 5 שרדו', s: '2 / 3 / 4', b: 'פחות' },
    shots: 'מלמעלה אם אפשר, אחרת רחב מהצד. הפרצופים בכל הגרלה.' },
  // [40]
  count20: { place: 'teddy', min: 5, cat: 'ספירה', title: 'עד 20 בלי להתנגש', bank: 40, score: 'tiers',
    card: 'קודם תבחרו מי מכם הכי חסר סבלנות.\n\nכולכם כורעים במעגל, פנים החוצה, בלי מילה. קמים אחד אחד, מתי שבא לכם. שניים קמו ביחד? מאפס.\nהמטרה 20. רק לחסר הסבלנות מותר לקום פעמיים ברצף.',
    secret: 'הכוח היחיד שדורש סבלנות ניתן למי שאין לו. השיא בתוך 2 דקות.', judge: { g: '20', s: '12+', b: '6+' },
    shots: 'רחב מחוץ למעגל. ההתנגשויות והאנחה המשותפת.' },
  // [16]
  silhouette: { place: 'benYehuda', min: 6, cat: 'צורה', title: 'הקיר', bank: 16, score: 'tiers',
    card: 'רק נציג אחד מדבר. תבחרו אותו.\n\nהצלם מראה כרטיס עם צללית של קבוצה ל 3 שניות, ויש לכם 10 שניות לקפוא בדיוק ככה. 4 כרטיסים, ובכל אחד יותר אנשים.\nבהצלחה בכרטיס האחרון.',
    secret: 'בכרטיס האחרון יש 14 דמויות, יותר מכל קבוצה. לא כתוב שדמות חייבת להיות בן אדם: מעיל על תיק עם כובע נחשב.',
    judge: { g: '4 כרטיסים', s: '3', b: '1 עד 2' }, shots: 'הכרטיס מתהפך והבהלה. כל קפיאה ליד הכרטיס שלה. רגע הפרצה.' },
  // [18]
  thumbs: { place: 'benYehuda', min: 6, cat: 'קהל', title: 'אגודל למעלה', bank: 18, score: 'tiers',
    card: 'קריאת עידוד לירושלים, 15 שניות. כולכם, בקול. לא ריקוד.\nאחר כך רק נציג אחד שואל את מי שעובר: "אהבתם?". השאר 3 מטר אחורה.\n\nכל אגודל בפריים שווה נקודה. יש המשך.',
    secret: 'ההמשך: אגודל של מי שעובד ברחוב (מוכר, נגן, מלצר) שווה כפול. לא מבקשים פעמיים.', judge: { g: '6 / 8 / 10', s: '3 / 5 / 6', b: 'פחות' },
    shots: 'קיר של אגודלים. הקריאה ברחב. מטשטשים פנים של מי שלא אישר.' },
  // [19]
  vanish: { place: 'zion', min: 6, cat: 'מחבואים', title: 'להיעלם בכיכר', bank: 19, score: 'tiers', band: true,
    card: 'קודם תבחרו מי מכם הכי לא בולט.\n\nהצלם סופר עד 60 עם הגב, ואתם נעלמים בתוך הכיכר. מתחבאים רק כמו שאנשים פה מתנהגים: מחכים, מצלמים, קוראים שלט. מי שרץ, נתפס.\nאחר כך יש לו 15 שניות. כל מי שלא נמצא שווה נקודה, והלא בולט שלכם שווה 3.',
    secret: 'אסור להתחבא מאחורי משהו, רק בתוך אנשים. מי שלא נמצא חוזר מעצמו.', judge: { g: '3 / 5 / 6', s: '2 / 3 / 4', b: 'פחות' },
    shots: 'הספירה וההתפזרות בהליכה. נקודת המבט של הצלם שסורק. החזרה של מי שלא נמצא.' },
};

// ── Routes: 6 stations each, zones in a different order per pair ──────────────────────────────────
const ROUTES = {
  A: { name: 'מסלול הסוחרים', missions: ['goblin', 'hands', 'falafel', 'coin', 'mime', 'tunnel'] },
  B: { name: 'מסלול השקט', missions: ['grams', 'shadow', 'busker', 'threeMin', 'line', 'phoneRelay'] },
  C: { name: 'מסלול הדו קרב', missions: ['falafel', 'silhouette', 'tiles', 'twenty', 'hands', 'redLight'] },
  D: { name: 'מסלול הנגן', missions: ['busker', 'coin', 'count20', 'changed', 'hands', 'silentLine'] },
  E: { name: 'מסלול הקיסר', missions: ['blind', 'twenty', 'shadow', 'hands', 'thumbs', 'falafel'] },
  F: { name: 'מסלול המרגלים', missions: ['phoneRelay', 'twenty', 'redLight', 'silentLine', 'vanish', 'busker'] },
};

// ── Route rules ───────────────────────────────────────────────────────────────────────────────────
const problems = [];
const GATHER_CAT = 'סנכרון'; const FINAL_CAT = 'קול';
for (const [rid, r] of Object.entries(ROUTES)) {
  const cats = r.missions.map((k) => M[k].cat);
  const dup = cats.filter((c, i) => cats.indexOf(c) !== i);
  if (dup.length) problems.push(`route ${rid}: repeated category ${dup.join(', ')}`);
  if (cats.includes(GATHER_CAT) || cats.includes(FINAL_CAT)) problems.push(`route ${rid}: repeats the gathering/final category`);
  const eyes = r.missions.filter((k) => M[k].eyes).length; if (eyes > 1) problems.push(`route ${rid}: ${eyes} eyes-closed missions`);
  const duo = r.missions.filter((k) => M[k].duo).length; if (duo > 2) problems.push(`route ${rid}: ${duo} rival-together missions`);
  if (!r.missions.some((k) => ['דיוק', 'שעון', 'משקל'].includes(M[k].cat))) problems.push(`route ${rid}: no precision mission`);
}

// ── Schedule ──────────────────────────────────────────────────────────────────────────────────────
const START = 19 * 60 + 40; const FINISH_LIMIT = 21 * 60 + 50;
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const schedule = {};
for (const [rid, r] of Object.entries(ROUTES)) {
  let t = START; let at = P.cbs; const rows = [];
  for (const key of r.missions) {
    const m = M[key]; const to = P[m.place]; const l = leg(at, to);
    rows.push({ key, how: l.how, travel: l.min, arrive: t + l.min, leave: t + l.min + m.min });
    t += l.min + m.min; at = to;
  }
  const l = leg(at, P.zion);
  rows.push({ key: 'final', how: l.how, travel: l.min, arrive: t + l.min, leave: t + l.min + 6 });
  schedule[rid] = rows;
}
for (const place of ['goblin', 'fruit', 'busker', 'falafel']) {
  const v = [];
  for (const [rid, rows] of Object.entries(schedule)) for (const row of rows) if (row.key !== 'final' && M[row.key].place === place) v.push({ rid, ...row });
  v.sort((a, b) => a.arrive - b.arrive);
  for (let i = 1; i < v.length; i++) if (v[i].arrive < v[i - 1].leave + 3) problems.push(`${place}: ${v[i - 1].rid} ${hhmm(v[i - 1].arrive)}-${hhmm(v[i - 1].leave)} overlaps ${v[i].rid} ${hhmm(v[i].arrive)}`);
}
for (const [rid, rows] of Object.entries(schedule)) {
  const end = rows[rows.length - 1].arrive;
  if (end > FINISH_LIMIT) problems.push(`route ${rid} reaches Zion at ${hhmm(end)}`);
  for (const row of rows) if (row.key !== 'final' && M[row.key].vendor && row.leave > 20 * 60 + 30) problems.push(`route ${rid}: vendor mission ${row.key} ends ${hhmm(row.leave)}, after 20:30`);
}

// ── Codes: deterministic 4-digit, unique per task ─────────────────────────────────────────────────
function h(str) { let x = 2166136261; for (const c of str) { x ^= c.codePointAt(0); x = Math.imul(x, 16777619) >>> 0; } return x; }
function tierCodes(taskId) {
  const out = {}; const used = new Set();
  for (const tier of ['g', 's', 'b', 'x']) {
    let n = 1000 + (h(`${taskId}:${tier}`) % 9000);
    while (used.has(n)) n = 1000 + ((n + 7) % 9000);
    used.add(n); out[tier] = String(n);
  }
  return out;
}

// ── Game file ─────────────────────────────────────────────────────────────────────────────────────
const tid = (rid, key) => `${rid}-${key}`;
const TIER_MSG = { g: 'זהב.', s: 'כסף.', b: 'ארד.', x: 'לא נספר, ממשיכים.' };
function task(rid, key, idx, row) {
  const m = M[key]; const p = P[m.place]; const id = tid(rid, key);
  const notes = `${m.by ? `מפעיל: ${m.by}. ` : 'שופט: הצלם. '}קאץ': ${m.secret} שיפוט: זהב ${m.judge.g}, כסף ${m.judge.s}, ארד ${m.judge.b}. מתוכנן ${hhmm(row.arrive)} עד ${hhmm(row.leave)}. בנק #${m.bank}.`;
  const base = {
    id, title: m.title, description: m.card, coordinates: { lat: p.lat, lng: p.lng },
    difficulty: 5, estimatedMinutes: row.travel + m.min, expectedDurationMinutes: m.min, pointValue: G,
    maxConcurrentTeams: 2, triggerMode: m.vendor || m.partner ? 'instant' : 'radius',
    unlockAfterTaskIds: [idx === 0 ? `card-${rid}` : tid(rid, ROUTES[rid].missions[idx - 1])],
    tags: ['22.10', `route-${rid}`, m.cat],
  };
  if (base.triggerMode === 'radius') base.geofenceRadiusMeters = 75;
  if (m.pausesTimer) base.pausesTimer = true;
  const code = (extra) => ({ type: 'smart_station', wrongAnswerPenalty: 'off', smart: { enabled: true, verificationType: 'code_verification', codeInputLabel: m.by ? `הקוד מ${m.by}` : 'הצלם מקליד את הקוד', adminNotes: notes, ...extra } });
  switch (m.score) {
    case 'tiers': {
      const c = tierCodes(id);
      return { ...base, ...code(), answerOutcomes: [
        { id: 'gold', label: 'זהב', accepts: [c.g], points: G, message: TIER_MSG.g },
        { id: 'silver', label: 'כסף', accepts: [c.s], points: S, message: TIER_MSG.s },
        { id: 'bronze', label: 'ארד', accepts: [c.b], points: B, message: TIER_MSG.b },
        { id: 'none', label: 'לא בוצע', accepts: [c.x], points: 0, message: TIER_MSG.x },
      ] };
    }
    case 'num': return { ...base, type: 'numeric', answerOutcomes: m.numRanges.map(([lo, hi, pts], i) => ({ id: `r${i}`, label: `${lo} עד ${hi}`, range: { min: lo, max: hi }, points: pts, message: pts === G ? TIER_MSG.g : pts === S ? TIER_MSG.s : TIER_MSG.b })), unmatchedPoints: 0, smart: undefined, description: `${m.card}\n\nהצלם מקליד את התוצאה.` };
    case 'grams': return { ...base, type: 'numeric', unmatchedPoints: B, answerOutcomes: [
      { id: 'exact', label: '100', range: { min: 100, max: 100 }, points: 300, message: '100 בדיוק. המוכר בהלם.' },
      { id: 'lo2', label: '98 עד 99.9', range: { min: 98, max: 99.99 }, points: G, message: 'זהב.' },
      { id: 'hi2', label: '100.1 עד 102', range: { min: 100.01, max: 102 }, points: G, message: 'זהב.' },
      { id: 'lo5', label: '95 עד 97.9', range: { min: 95, max: 97.99 }, points: S, message: 'כסף.' },
      { id: 'hi5', label: '102.1 עד 105', range: { min: 102.01, max: 105 }, points: S, message: 'כסף.' },
    ] };
    case 'code': return { ...base, ...code({ secretCode: m.code }), pointValue: 150 };
    case 'falafel': return { ...base, ...code(), answerOutcomes: [
      { id: 'win', label: 'ניצחון', accepts: ['אלוף'], points: 250, message: 'ניצחתם. תבחרו להם קללה.' },
      { id: 'solo', label: 'לבד', accepts: ['סולו'], points: 150, message: 'אכלתם לבד מול השעון.' },
      { id: 'lose', label: 'הפסד', accepts: ['כבוד'], points: 100, message: 'הפסדתם בכבוד. הקללה בדרך.' },
    ] };
    default: throw new Error(key);
  }
}
const clean = (o) => JSON.parse(JSON.stringify(o));

const cardText = (rid) => `זה הקלף שלכם להערב: ${ROUTES[rid].name}.\n\nיש עוד קבוצה אחת עם אותו קלף, והיא היריבה שלכם עד הסוף. אותן תחנות, אותו סדר, ובחלק מהן ראש בראש.\nתמצאו אותה ותעמדו מולה 5 שניות של מבט לפני קרב. בלי לצחוק ובלי לגעת.\n\nאת הקוד שסוגר את זה מקריאים ב 19:35.`;
const gatherCodes = tierCodes('gather'); const finalRanges = [[88, 92, G], [85, 87.99, S], [92.01, 95, S], [80, 84.99, B], [95.01, 100, B]];

const stages = [
  { id: 'v4-gather', order: 0, title: 'ההתכנסות', isFinal: false,
    narrative: { intro: { title: 'ערב טוב', bodyHe: 'המרכזית, 19:00. עוד חצי שעה מתחילים. בינתיים משימה אחת, ותבינו מהר שאנחנו לא משחקים פה.' } },
    tasks: [clean({ id: 'gather', title: 'מחיאה אחת', type: 'smart_station', triggerMode: 'radius', geofenceRadiusMeters: 150,
      coordinates: { lat: P.cbs.lat, lng: P.cbs.lng }, difficulty: 3, estimatedMinutes: 8, expectedDurationMinutes: 5, pointValue: G, maxConcurrentTeams: 12, wrongAnswerPenalty: 'off',
      description: 'מחיאה אחת. של כולכם. שתישמע כמו אחת.\n\nכולם עם הגב למרכז, חוץ מנציג אחד. הוא רואה הכל ואומר מילה אחת.\n3 ניסיונות. הצלם מקליט ובודק בגרף.',
      smart: { enabled: true, verificationType: 'code_verification', codeInputLabel: 'הצלם מקליד את הקוד', adminNotes: 'בנק #2. הצלם מקליט בתזכיר קולי עם צורת גל. זהב: שיא אחד. כסף: שני שיאים. ארד: מריחה.' },
      answerOutcomes: [
        { id: 'gold', label: 'זהב', accepts: [gatherCodes.g], points: G, message: TIER_MSG.g },
        { id: 'silver', label: 'כסף', accepts: [gatherCodes.s], points: S, message: TIER_MSG.s },
        { id: 'bronze', label: 'ארד', accepts: [gatherCodes.b], points: B, message: TIER_MSG.b },
        { id: 'none', label: 'לא בוצע', accepts: [gatherCodes.x], points: 0, message: TIER_MSG.x },
      ] })] },
  { id: 'v4-night', order: 1, title: 'הלילה', isFinal: false, requiredTaskCount: 7,
    narrative: {
      intro: { title: 'הקלפים חולקו', bodyHe: 'שש קבוצות של שתיים. אתם והיריבה עוברים באותו מסלול, וזה נגמר בכיכר ציון. רואים רק את התחנה הבאה, ורוב התחנות נפתחות רק כשמגיעים. הצלם שלכם הוא השופט, ואין לו חברים הערב.' },
      outro: { title: 'כמעט', bodyHe: 'סגרתם את המסלול. כולם לכיכר ציון.' } },
    tasks: [
      ...Object.keys(ROUTES).map((rid) => clean({ id: `card-${rid}`, title: `קלף ${rid}: ${ROUTES[rid].name}`, description: cardText(rid),
        type: 'smart_station', triggerMode: 'instant', coordinates: { lat: P.cbs.lat, lng: P.cbs.lng },
        difficulty: 1, estimatedMinutes: 5, expectedDurationMinutes: 5, pointValue: 0, maxConcurrentTeams: 2,
        smart: { enabled: true, verificationType: 'code_verification', secretCode: 'יריבים', codeInputLabel: 'הקוד מהתדריך', adminNotes: 'הקוד מוקרא ב 19:35, רק אחרי שכל הקבוצות קיבלו קלף. קלפים עודפים נסגרים לפני 19:30.' } })),
      ...Object.entries(ROUTES).flatMap(([rid, r]) => r.missions.map((key, i) => clean(task(rid, key, i, schedule[rid][i])))),
    ],
    exclusiveGroups: [{ id: 'cards', taskIds: Object.keys(ROUTES).map((rid) => `card-${rid}`) }],
  },
  { id: 'v4-zion', order: 2, title: 'כיכר ציון', isFinal: true,
    narrative: { intro: { title: 'כיכר ציון', bodyHe: 'הגעתם. עוד צעקה אחת, ואז ההכרזה.' }, outro: { title: 'זהו', bodyHe: 'נשארים בכיכר. ב 22:00 מחיאה אחת של כולם, ואז הזוכים.' } },
    tasks: [clean({ id: 'final', title: '90 בדיוק', type: 'numeric', triggerMode: 'radius', geofenceRadiusMeters: 80,
      coordinates: { lat: P.zion.lat, lng: P.zion.lng }, difficulty: 3, estimatedMinutes: 6, expectedDurationMinutes: 4, pointValue: G, maxConcurrentTeams: 12, unmatchedPoints: 0,
      description: '3 צעקות של שם הקבוצה. הצלם מודד בדציבלים.\nלא הכי חזק מנצח. הכי קרוב ל 90.\n\nרק נציג אחד רואה את המסך ומנהל אתכם ביד. הצלם מקליד את המספר.',
      answerOutcomes: finalRanges.map(([lo, hi, pts], i) => ({ id: `r${i}`, label: `${lo} עד ${hi}`, range: { min: lo, max: hi }, points: pts, message: pts === G ? TIER_MSG.g : pts === S ? TIER_MSG.s : TIER_MSG.b })) })] },
];

const game = {
  title: 'המירוץ העירוני, ירושלים 22.10 (גרסה 4)',
  description: 'מירוץ לילי בירושלים לזוגות של קבוצות יריבות. התכנסות ב 19:00 בתחנה המרכזית, סיום בכיכר ציון בכ 22:00.',
  mode: 'team', scoringPreset: 'fixed_points_speed',
  instructions: { title: 'החוקים', bodyHe: [
    'התכנסות ב 19:00 במרכזית. יוצאים ב 19:40. מסיימים בכיכר ציון עד 22:00.',
    'ברגל או ברכבת הקלה. בלי מוניות, אופניים וקורקינטים. לכל אחד רב קו.',
    'כל הקבוצה ביחד, כל הזמן. לא יורדים מהרכבת אחרי "העירייה", ולא נכנסים לעיר העתיקה.',
    'אין מגע בין בנים לבנות. לא נוגעים בזרים, ולא מצלמים מי שלא הסכים.',
    'לא רצים. לא ליד הרכבת, לא במעברי חצייה, לא בכלל.',
    'הצלם שלכם הוא השופט. הוא מקליד את הקוד, ואין ויכוחים.',
    'בכל רגע אפשר לוותר על משימה. SOS מגיע לצוות מיד.',
  ].join('\n') },
  stages,
};
const here = new URL('.', import.meta.url);
writeFileSync(new URL('game-v4.json', here), JSON.stringify({ format: 'rushpoint.game', schemaVersion: 1, exportedAt: new Date().toISOString(), game }, null, 2));

// ── schedule-v4.md ────────────────────────────────────────────────────────────────────────────────
let md = '# לוח זמנים לדקה, גרסה 4 (נוצר על ידי build-game-v4.mjs)\n\nהליכה של 4.2 קמ"ש ועוד 30%, ורכבת לפי ה GTFS, ועוד 6 דקות לעלייה של קבוצה ולהמתנה.\n\n';
md += '| שעה | כולם |\n|---|---|\n| 19:00 | התכנסות במרכזית: מחיאה אחת |\n| 19:30 | תדריך, וכל קבוצה מקבלת קלף |\n| 19:35 | הקוד: `יריבים` |\n| 19:40 | יוצאים |\n\n';
for (const [rid, rows] of Object.entries(schedule)) {
  md += `## ${rid}: ${ROUTES[rid].name}\n\n| הגעה | יציאה | תחנה | משימה | סוג | איך מגיעים |\n|---|---|---|---|---|---|\n`;
  for (const row of rows) {
    const m = row.key === 'final' ? { title: '90 בדיוק', place: 'zion', cat: 'קול' } : M[row.key];
    md += `| ${hhmm(row.arrive)} | ${hhmm(row.leave)} | ${P[m.place].name} | ${m.title} | ${m.cat} | ${row.how}, ${row.travel} דק' |\n`;
  }
  md += '\n';
}
md += '## בדיקות\n\n' + (problems.length ? problems.map((p) => `- ❌ ${p}`).join('\n') : '- ✅ אין סוג משימה שחוזר במסלול, כולל ההתכנסות והגמר.\n- ✅ לכל היותר משימה אחת בעיניים עצומות ושתיים ראש בראש בכל מסלול, ובכל מסלול יש משימת דיוק.\n- ✅ אף שת"פ לא מקבל שני זוגות ביחד, ומשימות הספקים בשוק נגמרות עד 20:30.\n- ✅ כולם בכיכר ציון עד 21:50.') + '\n';
writeFileSync(new URL('schedule-v4.md', here), md);

// ── PHOTOGRAPHER-SHEETS.md: one sheet per route, codes included. NEVER give it to teams. ─────────
let ps = '# דפי צלמים, גרסה 4\n\n> לא להעביר לקבוצות. כל צלם מקבל רק את הדף של המסלול שלו. הצלם מקליד את הקוד בטלפון של הקבוצה בעצמו.\n> ספים בסדר: 4 עד 6 / 7 עד 9 / 10 עד 12 אנשים. ניקוד: זהב 200, כסף 120, ארד 60, "לא בוצע" 0.\n\n';
ps += `## התכנסות (כל הצלמים)\n\n**מחיאה אחת**. זהב: שיא אחד בגרף. כסף: שניים. ארד: מריחה.\nקודים: זהב \`${gatherCodes.g}\` · כסף \`${gatherCodes.s}\` · ארד \`${gatherCodes.b}\` · לא בוצע \`${gatherCodes.x}\`\n\n`;
for (const [rid, r] of Object.entries(ROUTES)) {
  ps += `## מסלול ${rid}: ${r.name}\n\n`;
  r.missions.forEach((key, i) => {
    const m = M[key]; const id = tid(rid, key); const row = schedule[rid][i];
    ps += `### ${i + 1}. ${m.title} (${hhmm(row.arrive)}, ${P[m.place].name})\n\n`;
    ps += `- **מי מפעיל:** ${m.by ?? 'הצלם'}\n- **הקאץ\' / ההמשך:** ${m.secret}\n- **שיפוט:** זהב ${m.judge.g} · כסף ${m.judge.s} · ארד ${m.judge.b}\n`;
    if (m.score === 'tiers') { const c = tierCodes(id); ps += `- **קודים:** זהב \`${c.g}\` · כסף \`${c.s}\` · ארד \`${c.b}\` · לא בוצע \`${c.x}\`\n`; }
    else if (m.score === 'num') ps += '- **מקלידים:** את המספר שמדדתם. האפליקציה ממירה לזהב, כסף או ארד.\n';
    else if (m.score === 'grams') ps += '- **מקלידים:** את המספר על המשקל.\n';
    else if (m.score === 'code') ps += `- **קוד:** \`${m.code}\` (הקבוצה מקלידה בעצמה)\n`;
    else if (m.score === 'falafel') ps += '- **קודים בכרטיס מודפס:** `אלוף` · `סולו` · `כבוד`\n';
    ps += `- **צילום:** ${m.shots}\n\n`;
  });
  ps += `### גמר: 90 בדיוק (כיכר ציון)\n\n- מודדים 3 מטר מהקבוצה, באותה אפליקציית דציבלים לכל הצלמים, ומקלידים את המספר.\n\n`;
}
writeFileSync(new URL('PHOTOGRAPHER-SHEETS.md', here), ps);

if (process.argv.includes('--print') || problems.length) console.log(md);
if (problems.length) { console.error(`${problems.length} problem(s)`); process.exit(1); }
console.log('game-v4.json + schedule-v4.md + PHOTOGRAPHER-SHEETS.md written');
