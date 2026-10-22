#!/usr/bin/env node
// The 22.10.2026 race, version 5. Skeleton unchanged since v3 (rival pairs on fixed routes: a card
// exclusive group + unlockAfterTaskIds). What changed is WHAT a mission is, after Ahiya's notes of
// 19.10 (ROUTE-v5.md lists the mistakes this fixes):
//  * the first mission is a FACE OFF with the rival, not a warm-up game;
//  * missions come from his own bank's DNA (taskBank.ts: the petition, trading up, the news flash,
//    the secret code from the shop): dares in front of people, competition, a reason to film it;
//  * every mission has a reason to happen AT THAT PLACE (the Kaiser's breach at Jaffa Gate, the
//    Finger of Og, a petition to the mayor at Safra, trading up in the market);
//  * physical where it fits, not everywhere; no camp games, no props the team does not carry;
//  * cards in his voice: short, blunt, no cute adjectives, no slang from the organizer.
// The build FAILS on: a repeated category in a route, two music / two skit / three stranger missions
// in a route, a banned word in a card (CRINGE list below), a dash, a schedule overrun, or a partner
// station given two pairs at once.
//
//   node docs/events/2026-10-22-jerusalem-race/build-game-v5.mjs [--print]
//   → game-v5.json, schedule-v5.md, PHOTOGRAPHER-SHEETS-v5.md

import { writeFileSync } from 'node:fs';

// ── Places ────────────────────────────────────────────────────────────────────────────────────────
const P = {
  cbs:       { lat: 31.78922, lng: 35.20322, name: 'רחבת התחנה המרכזית (הצד הרחוק מהמסילה)' },
  goblin:    { lat: 31.78530, lng: 35.21230, name: 'דוכן בשוק (שת"פ) ⚠' },
  fruit:     { lat: 31.78480, lng: 35.21294, name: 'דוכן פירות יבשים, עץ חיים (שת"פ) ⚠' },
  shuk:      { lat: 31.78530, lng: 35.21230, name: 'שוק מחנה יהודה' },
  agripas:   { lat: 31.78424, lng: 35.21192, name: 'אגריפס מול השוק' },
  shutters:  { lat: 31.78480, lng: 35.21250, name: 'תריסי סוזה, עץ חיים והאשכול' },
  nachlaot:  { lat: 31.78243, lng: 35.21312, name: 'נחלאות, סמטה ליד אוהל משה ⚠' },
  busker:    { lat: 31.78148, lng: 35.21648, name: 'ראש מדרחוב בן יהודה (נגן)' },
  falafel:   { lat: 31.78175, lng: 35.21900, name: 'פלאפליה ליד כיכר ציון (שת"פ) ⚠' },
  zion:      { lat: 31.78197, lng: 35.21957, name: 'כיכר ציון' },
  russian:   { lat: 31.78155, lng: 35.22286, name: 'מגרש הרוסים, ליד הבור של העמוד ⚠' },
  safra:     { lat: 31.78032, lng: 35.22373, name: 'כיכר ספרא, מול העירייה' },
  mamilla:   { lat: 31.77753, lng: 35.22435, name: 'מדרחוב ממילא' },
  waiters:   { lat: 31.77740, lng: 35.22420, name: 'מסעדה בממילא (שת"פ) ⚠' },
  jaffaGate: { lat: 31.77690, lng: 35.22690, name: 'מחוץ לשער יפו, מול הפרצה' },
  teddy:     { lat: 31.77501, lng: 35.22641, name: 'פארק טדי, החומות ברקע' },
};
const RAIL = [
  { lat: 31.78848, lng: 35.20256 }, { lat: 31.78795, lng: 35.20681 }, { lat: 31.78603, lng: 35.21142 },
  { lat: 31.78458, lng: 35.21521 }, { lat: 31.78287, lng: 35.21837 }, { lat: 31.77969, lng: 35.22387 },
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
// why: the reason it happens HERE (shown to nobody, enforced by review). group: music / skit / stranger
// (route limits). score: tiers (photographer or vendor code) | num (photographer types a number) |
// duel (win/lose/solo codes typed by the photographers) | grams | code | falafel.
const G = 200; const S = 120; const B = 60;
const M = {
  goblin: { place: 'goblin', min: 7, cat: 'דוכן', shukVendor: true, by: 'המוכר', title: 'המוכר שלא מפסיד', score: 'tiers',
    why: 'שוק: מתמקחים ומתחרים מול מוכר.',
    card: 'המוכר לא הפסיד באבן נייר ומספריים מאז 1998.\nאתם צריכים לנצח אותו 3 פעמים ברצף. כל אחד מכם משחק פעם אחת.\nנגמרו לכם אנשים? נגמרה המשימה.',
    secret: 'המוכר משחק תמיד אבן, אבן, נייר, וחוזר. מי שמסתכל ולא רק משחק שובר את זה.',
    judge: { g: '3 ברצף', s: '2 ברצף', b: 'פחות' }, shots: 'המוכר אומר "מאז 1998" בפרצוף רציני. הידיים. מי שצועק "הוא תמיד אבן".' },
  grams: { place: 'fruit', min: 8, cat: 'משקל', shukVendor: true, by: 'המוכר', title: '100 גרם', score: 'grams',
    why: 'שוק: שוקלים פה הכל.',
    card: 'המשקל מכוסה. אתם צריכים להגיע בדיוק ל 100 גרם פירות יבשים.\nכל אחד מוסיף לפחות פרי אחד, ולפחות 4 סוגים. ניסיון אחד.\nתצעקו "שוקל", המוכר מוריד את הכיסוי, ואתם מקלידים את המספר.',
    secret: 'בלי קאץ\'. הכיסוי הוא כל הקטע.', judge: { g: '98 עד 102 (100 בדיוק: 300)', s: '95 עד 105', b: 'השאר' },
    shots: 'הידיים מעל המשקל. הוויכוח על משמש אחד. הכיסוי עולה.' },
  trade: { place: 'shuk', min: 10, cat: 'סחר', group: 'stranger', title: 'מאטב למשהו', score: 'tiers',
    why: 'שוק: הכי ישראלי לסחור.',
    card: 'הצלם נותן לכם אטב אחד.\nיש לכם 10 דקות להחליף אותו עם אנשים ברחוב במשהו שווה יותר, ואז את זה במשהו שווה עוד יותר.\nבלי כסף. מה שיש לכם ביד בסוף, זה הניקוד.',
    secret: 'הצלם שופט לפי מה שביד בסוף. מספיק להגיד שזה משחק, לא לשקר.',
    judge: { g: 'משהו שמישהו היה משלם עליו 20 ש"ח ומעלה', s: 'אוכל או חפץ שימושי', b: 'עוד משהו קטן' }, shots: 'האטב בהתחלה, כל החלפה בתקריב, ומה שביד בסוף.' },
  shukCall: { place: 'agripas', min: 6, cat: 'קריאה', group: 'music', title: 'קריאת שוק', score: 'tiers',
    why: 'שוק: הקריאות של המוכרים.',
    card: 'בשוק צועקים על עגבניות. אתם צועקים על משהו שאי אפשר לקנות: שקט, תור קצר בקופת חולים, סוללה של 3 אחוז.\nכל הקבוצה, באותו קצב, 10 שניות.\nמוכר אמיתי שעונה לכם בקריאה משלו שווה זהב.',
    secret: 'זהב רק אם מוכר אמיתי נכנס למשחק.', judge: { g: 'מוכר ענה', s: 'קריאה נקייה ובקצב', b: 'עשיתם' },
    shots: 'הקבוצה בשורה מול הדוכן. הפרצוף של המוכר.' },
  shutters: { place: 'shutters', min: 8, cat: 'פרצופים', title: 'הפנים על התריסים', score: 'tiers', after21: true,
    why: 'שוק בלילה: התריסים של שלמה סוזה.',
    card: 'כשהשוק נסגר, על התריסים יש מאות פרצופים.\nתמצאו את הפיזיקאי שהציעו לו להיות נשיא וסירב, ואת ראש הממשלה שמצויר הפוך.\nבכל תריס כולכם בתנוחה שלו. את ראש הממשלה מצלמים הפוך.',
    secret: 'איינשטיין, ובן גוריון ההפוך.', judge: { g: 'שניהם', s: 'אחד', b: '-' }, shots: 'הקבוצה בתנוחה ליד התריס. הטלפון מתהפך.' },
  squid: { place: 'nachlaot', min: 6, cat: 'התגנבות', title: 'סקוויד גיים, נחלאות', score: 'tiers', band: true,
    why: 'נחלאות: גרים פה אנשים, אז השקט הוא החוק.',
    card: 'סקוויד גיים, גרסת נחלאות.\nהצלם בסוף הסמטה, עם הגב. שומע משהו, מסתובב. מי שזז כשהוא מסתכל, חוזר להתחלה.\n2 דקות. גרים פה אנשים, אז מי שמדבר, נפסל.',
    secret: 'הצלם מסתובב על כל רעש, לא לפי זמן.', judge: { g: '4 / 6 / 8 הגיעו', s: '2 / 4 / 5', b: 'פחות' },
    shots: 'מעל הכתף של הצלם. כל סיבוב: כולם קפואים באמצע צעד.' },
  busker: { place: 'busker', min: 7, cat: 'שיר', group: 'music', duo: true, by: 'הנגן', title: 'תשירו לי את המילה', score: 'code', code: 'כינור',
    why: 'בן יהודה: המדרחוב של הנגנים.',
    card: 'בראש המדרחוב מחכה לכם הנגן של המירוץ. תגידו לו "באנו לשמוע את השיר".\nהוא מנגן לכם וליריבים ביחד, בלי מילים ומהר מדי. הקוד הוא המילה האחרונה בפזמון.\nלא זוכרים? תשכנעו את הרחוב לשיר. Shazam שווה 5 דקות עונש.',
    secret: '"ירושלים של זהב" בקצב של מירוץ. הקוד: כינור. מי שמקליד ראשון מקבל 50 בונוס (המארגן מוסיף).',
    judge: { g: 'קוד נכון', s: '-', b: '-' }, shots: 'שתי הקבוצות מול הנגן. אנשים שרים. מי מקליד ראשון.' },
  rap: { place: 'zion', min: 7, cat: 'ראפ', group: 'music', duo: true, title: 'באטל בכיכר', score: 'duel',
    why: 'כיכר ציון בחמישי בלילה: יש קהל.',
    card: 'ראפ באטל מול היריבים, באמצע הכיכר.\nכל צד מבקש ממישהו בכיכר מילה אחת בשביל הצד השני, והיא חייבת להיכנס לחרוז. 30 שניות לכל צד.\nהקהל מחליט. הצלמים מקלידים מי לקח.',
    secret: 'מי שהקהל מריע לו יותר. בלי לרדת על אף אחד אישית.', judge: { g: 'ניצחון', s: 'לבד', b: 'הפסד' },
    shots: 'שני הראפרים פנים מול פנים, הקהל מאחור. מי שנותן את המילה.' },
  petition: { place: 'safra', min: 8, cat: 'עצומה', group: 'stranger', title: 'עצומה לראש העיר', score: 'num',
    why: 'ספרא: פה יושב ראש העיר.',
    card: 'בבניין הזה יושב ראש העיר. יש לו מכתב מכם.\nעל הדף שהצלם נותן: עצומה לביטול חובת הרישיון לרכיבה על חמורים.\nתגידו לאנשים שזה חלק ממשחק ותאספו חתימות. 8 דקות.',
    secret: 'הצלם סופר חתימות ומקליד.', numRanges: [[15, 500, G], [10, 14, S], [1, 9, B]], judge: { g: '15+', s: '10 עד 14', b: '1 עד 9' },
    shots: 'הדף מתמלא. מי שקורא את העצומה ומתחיל לצחוק.' },
  pushups: { place: 'safra', min: 5, cat: 'כוח', title: '60 שניות מול העירייה', score: 'tiers', band: true,
    why: 'ספרא: רחבה גדולה, שטוחה ומוארת.',
    card: '60 שניות. כמה שכיבות סמיכה עושה כל הקבוצה ביחד?\nכל אחד כמה שהוא יכול. מהברכיים נחשב חצי.\nהצלם סופר, והמספר שלכם הולך ליריבים.',
    secret: 'המספר נשלח ליריבים (המארגן מפרסם בצ\'אט). בנים ובנות בשתי שורות.', judge: { g: '80 / 120 / 160', s: '50 / 75 / 100', b: 'פחות' },
    shots: 'שורה רחבה מהצד. הספירה בקול. מי שממשיך אחרון.' },
  og: { place: 'russian', min: 7, cat: 'אגדה', group: 'skit', title: 'האצבע של עוג', score: 'tiers',
    why: 'מגרש הרוסים: העמוד שנסדק לפני 2,000 שנה.',
    card: 'בבור הזה שוכב עמוד בן 2,000 שנה. הוא נסדק לפני שגמרו אותו, ומאז הוא פה.\nקוראים לו "האצבע של עוג".\nאחד מכם הקבלן. 20 שניות למצלמה: למה העמוד יהיה מוכן אחרי החגים.',
    secret: 'זהב אם הקבלן לא צחק לרגע.', judge: { g: 'בלי לצחוק', s: 'צחק פעם', b: 'עשיתם' },
    shots: 'הבור, ואז הקבלן מול המצלמה, ברצינות.' },
  ad: { place: 'mamilla', min: 7, cat: 'פרסומת', group: 'skit', groups2: ['stranger'], title: 'מוצר שלא קיים', score: 'tiers',
    why: 'ממילא: הקניון הכי יקר בעיר.',
    card: 'אתם בקניון הכי יקר בירושלים. תמכרו למישהו מוצר שלא קיים, תמציאו אותו עכשיו.\n30 שניות של פיץ\'.\nאומר שהיה קונה? זהב.',
    secret: 'לא מצלמים את הקונה בלי שהסכים.', judge: { g: 'היה קונה', s: 'אולי', b: 'לא' }, shots: 'הפיץ\' מהצד, והפרצוף של מי ששומע.' },
  waiters: { place: 'waiters', min: 7, cat: 'מלצרים', vendor: true, by: 'המסעדה', title: 'מרוץ מלצרים', score: 'tiers', band: true,
    why: 'ממילא: שורה של מסעדות.',
    card: 'המסעדה נותנת לכם מגש עם 3 כוסות מים מלאות.\nכל אחד לוקח אותו 20 מטר ובחזרה, ומעביר לבא. בלי ריצה.\nנשפך? מתחילים מההתחלה. הצלם מודד זמן.',
    secret: 'מלצר אמיתי מהמסעדה הוא השופט של "נשפך".', judge: { g: 'עד 40 / 70 / 100 שניות', s: 'עד 70 / 110 / 150', b: 'סיימתם' },
    shots: 'מגש בתקריב, צעדים קטנים, המלצר שמסמן "נשפך".' },
  kaiser: { place: 'jaffaGate', min: 7, cat: 'כתבה', group: 'skit', title: 'הקיסר חוזר', score: 'tiers',
    why: 'שער יפו: ב 1898 פרצו פה את החומה בשביל קיסר גרמניה.',
    card: 'ב 1898 פרצו פה את החומה, כדי שקיסר גרמניה ייכנס בכרכרה.\nמבזק: הוא חזר, והפעם הוא רוצה עוד חור. אחד כתב, השאר עדים. 30 שניות, ברצינות.\nעובר אורח אמיתי שמסכים להגיד משפט למצלמה מעלה לזהב.',
    secret: 'זהב רק עם עובר אורח אמיתי.', judge: { g: 'עם עובר אורח', s: 'בלי לצחוק', b: 'עשיתם' },
    shots: 'הכתב מול הפרצה. העדים. עובר האורח.' },
  jump: { place: 'teddy', min: 6, cat: 'קפיצה', title: 'כולם באוויר', score: 'tiers', band: true,
    why: 'פארק טדי: החומות המוארות ברקע.',
    card: 'כולכם באוויר באותו פריים, והחומות מאחוריכם.\n3 ניסיונות. מספיק שאחד נוגע ברצפה, וזה לא נחשב.',
    secret: 'הצלם סופר כמה באוויר בפריים הכי טוב. רק על ריצוף שטוח.', judge: { g: '5 / 7 / 9 באוויר', s: '4 / 5 / 6', b: 'פחות' },
    shots: 'צילום ברצף. הפריים שבו כולם באוויר, החומות ברקע.' },
  vanish: { place: 'zion', min: 6, cat: 'מחבואים', title: 'המילוט הגדול', score: 'tiers', band: true,
    why: 'כיכר ציון: מלאה אנשים.',
    card: 'הצלם סופר עד 60 עם הגב, ואתם נבלעים בתוך הכיכר. הליכה בלבד.\nיש לו 15 שניות לתפוס אתכם.\nכל מי שלא נמצא, נקודה.',
    secret: 'אסור להתחבא מאחורי משהו, רק בתוך אנשים.', judge: { g: '3 / 5 / 6 לא נמצאו', s: '2 / 3 / 4', b: 'פחות' },
    shots: 'ההתפזרות בהליכה. נקודת המבט של הצלם. מי שחוזר.' },
  falafel: { place: 'falafel', min: 12, cat: 'אוכל', partner: true, duo: true, pausesTimer: true, by: 'איש הצוות בשולחן', title: 'הדו קרב', score: 'falafel',
    why: 'כיכר ציון: הפלאפל של המרכז.',
    card: 'פה פוגשים את היריבים. השעון שלכם עוצר פה, אז אין סיבה למהר.\n20 כדורים, 2 דקות. 4 אוכלים מכל קבוצה, עד 5 לאחד. כדור אחד בפה, יש מים. בצפירה יש 30 שניות לסיים בנחת.\nהמנצחים בוחרים ליריבים קללה עד התחנה הבאה.',
    secret: 'קודים בכרטיס: אלוף 250, סולו 150, כבוד 100. קללות: הולכים בטור, כל אחד סוחב תיק של מישהו אחר, או מדברים רק בשאלות. מי שמשתעל עוצר ולא נפסל.',
    judge: { g: 'אלוף', s: 'סולו', b: 'כבוד' }, shots: 'שני הצלמים מאותה זווית, למסך מפוצל. הצפירה. הקללה.' },
};

// ── Routes ────────────────────────────────────────────────────────────────────────────────────────
const ROUTES = {
  A: { name: 'מסלול הסוחרים', missions: ['goblin', 'squid', 'falafel', 'petition', 'ad', 'jump'] },
  B: { name: 'מסלול הנגן', missions: ['grams', 'trade', 'busker', 'og', 'jump', 'waiters'] },
  C: { name: 'מסלול הבאטל', missions: ['falafel', 'rap', 'jump', 'kaiser', 'shutters', 'squid'] },
  D: { name: 'מסלול העירייה', missions: ['busker', 'pushups', 'ad', 'waiters', 'squid', 'shutters'] },
  E: { name: 'מסלול הקיסר', missions: ['kaiser', 'jump', 'shukCall', 'trade', 'pushups', 'falafel'] },
  F: { name: 'מסלול המילוט', missions: ['waiters', 'ad', 'squid', 'trade', 'vanish', 'busker'] },
};

// ── Rules ─────────────────────────────────────────────────────────────────────────────────────────
// CRINGE: personality-adjective casting, counselor phrases, organizer slang. From Ahiya's notes
// (19.10: "בר מזל, מי מדבר ככה?"), the teen-register research, CringeBench (forced whimsy scores high,
// plain direct text scores ~0) and the Preply list of words Gen Z itself calls cringe.
const CRINGE = ['בר מזל', 'הכי מסודר', 'סומך על אנשים', 'מגושם', 'חסר סבלנות', 'שם לב להכל', 'ילדים', 'חברים יקרים',
  'כל הכבוד', 'נהדר', 'מדהים', 'מרגש', 'כיף', 'יאללה', 'סחתיין', 'חבל"ז', 'ריז', 'סיגמה', 'סקיבידי', '6 7', 'אורה',
  'וייב', 'פלקס', 'יש המשך', 'בהצלחה!', '!!'];
// CAMP: mechanics that read as a summer-camp warm-up. They fail the build if they come back.
const CAMP = ['מחיאה', 'יום הולדת', 'מראה', 'צל', 'סופרים עד 20', 'פסלים', 'ידיים מלאות'];
const DASH = /[-‐‑‒–—―־]/;
const problems = [];
for (const [k, m] of Object.entries(M)) {
  for (const w of CRINGE) if (m.card.includes(w)) problems.push(`${k}: cringe word "${w}"`);
  for (const w of CAMP) if (m.title.includes(w) || m.cat === w) problems.push(`${k}: camp mechanic "${w}"`);
  if (DASH.test(m.card) || DASH.test(m.title)) problems.push(`${k}: dash in the card`);
  if (m.card.split('\n').length > 4) problems.push(`${k}: card longer than 4 lines`);
  if (!m.why) problems.push(`${k}: no reason to be at this place`);
}
for (const [rid, r] of Object.entries(ROUTES)) {
  const ms = r.missions.map((k) => M[k]);
  const cats = ms.map((m) => m.cat); const dup = cats.filter((c, i) => cats.indexOf(c) !== i);
  if (dup.length) problems.push(`route ${rid}: repeated category ${dup.join(', ')}`);
  const groups = (g) => ms.filter((m) => m.group === g || (m.groups2 ?? []).includes(g)).length;
  if (groups('music') > 1) problems.push(`route ${rid}: ${groups('music')} music missions`);
  if (groups('skit') > 1) problems.push(`route ${rid}: ${groups('skit')} skit missions`);
  if (groups('stranger') > 2) problems.push(`route ${rid}: ${groups('stranger')} stranger missions`);
  if (ms.filter((m) => m.duo).length > 2) problems.push(`route ${rid}: more than two rival-together missions`);
}

// ── Schedule ──────────────────────────────────────────────────────────────────────────────────────
const START = 19 * 60 + 40; const FINISH_LIMIT = 21 * 60 + 50;
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const schedule = {};
for (const [rid, r] of Object.entries(ROUTES)) {
  let t = START; let at = P.cbs; const rows = [];
  for (const key of r.missions) {
    const m = M[key]; const l = leg(at, P[m.place]);
    rows.push({ key, how: l.how, travel: l.min, arrive: t + l.min, leave: t + l.min + m.min });
    t += l.min + m.min; at = P[m.place];
  }
  const l = leg(at, P.zion);
  rows.push({ key: 'final', how: l.how, travel: l.min, arrive: t + l.min, leave: t + l.min + 5 });
  schedule[rid] = rows;
}
for (const place of ['goblin', 'fruit', 'busker', 'falafel', 'waiters']) {
  const v = [];
  for (const [rid, rows] of Object.entries(schedule)) for (const row of rows) if (row.key !== 'final' && M[row.key].place === place) v.push({ rid, ...row });
  v.sort((a, b) => a.arrive - b.arrive);
  for (let i = 1; i < v.length; i++) if (v[i].arrive < v[i - 1].leave + 3) problems.push(`${place}: ${v[i - 1].rid} ${hhmm(v[i - 1].arrive)}-${hhmm(v[i - 1].leave)} overlaps ${v[i].rid} ${hhmm(v[i].arrive)}`);
}
for (const [rid, rows] of Object.entries(schedule)) {
  const end = rows[rows.length - 1].arrive;
  if (end > FINISH_LIMIT) problems.push(`route ${rid} reaches Zion at ${hhmm(end)}`);
  for (const row of rows) {
    if (row.key === 'final') continue;
    if (M[row.key].shukVendor && row.leave > 20 * 60 + 30) problems.push(`route ${rid}: ${row.key} ends ${hhmm(row.leave)}, after the shuk closes`);
    if (M[row.key].after21 && row.arrive < 21 * 60) problems.push(`route ${rid}: shutters at ${hhmm(row.arrive)}, before 21:00`);
  }
}

// ── Codes ─────────────────────────────────────────────────────────────────────────────────────────
function h(str) { let x = 2166136261; for (const c of str) { x ^= c.codePointAt(0); x = Math.imul(x, 16777619) >>> 0; } return x; }
function codes(taskId, tiers = ['g', 's', 'b', 'x']) {
  const out = {}; const used = new Set();
  for (const t of tiers) { let n = 1000 + (h(`${taskId}:${t}`) % 9000); while (used.has(n)) n = 1000 + ((n + 7) % 9000); used.add(n); out[t] = String(n); }
  return out;
}
const MSG = { g: 'זהב.', s: 'כסף.', b: 'ארד.', x: 'לא נספר. ממשיכים.' };
const tierOutcomes = (c) => [
  { id: 'gold', label: 'זהב', accepts: [c.g], points: G, message: MSG.g },
  { id: 'silver', label: 'כסף', accepts: [c.s], points: S, message: MSG.s },
  { id: 'bronze', label: 'ארד', accepts: [c.b], points: B, message: MSG.b },
  { id: 'none', label: 'לא בוצע', accepts: [c.x], points: 0, message: MSG.x },
];
const duelOutcomes = (c) => [
  { id: 'win', label: 'ניצחון', accepts: [c.g], points: G, message: 'לקחתם.' },
  { id: 'solo', label: 'לבד', accepts: [c.s], points: S + 30, message: 'בלי יריבים, עדיין נחשב.' },
  { id: 'lose', label: 'הפסד', accepts: [c.b], points: B + 40, message: 'הפעם הם לקחו.' },
];

// ── Game file ─────────────────────────────────────────────────────────────────────────────────────
const tid = (rid, key) => `${rid}-${key}`;
const clean = (o) => JSON.parse(JSON.stringify(o));
function task(rid, key, idx, row) {
  const m = M[key]; const p = P[m.place]; const id = tid(rid, key);
  const notes = `${m.by ? `מפעיל: ${m.by}. ` : 'שופט: הצלם. '}למה פה: ${m.why} קאץ': ${m.secret} זהב ${m.judge.g}, כסף ${m.judge.s}, ארד ${m.judge.b}. מתוכנן ${hhmm(row.arrive)} עד ${hhmm(row.leave)}.`;
  const base = {
    id, title: m.title, description: m.card, coordinates: { lat: p.lat, lng: p.lng },
    difficulty: 5, estimatedMinutes: row.travel + m.min, expectedDurationMinutes: m.min, pointValue: G,
    maxConcurrentTeams: 2, triggerMode: m.by ? 'instant' : 'radius',
    unlockAfterTaskIds: [idx === 0 ? `card-${rid}` : tid(rid, ROUTES[rid].missions[idx - 1])],
    tags: ['22.10', `route-${rid}`, m.cat],
  };
  if (base.triggerMode === 'radius') base.geofenceRadiusMeters = 75;
  if (m.pausesTimer) base.pausesTimer = true;
  const station = (extra) => ({ type: 'smart_station', wrongAnswerPenalty: 'off', smart: { enabled: true, verificationType: 'code_verification', codeInputLabel: m.by ? `הקוד מ${m.by}` : 'הצלם מקליד', adminNotes: notes, ...extra } });
  switch (m.score) {
    case 'tiers': return { ...base, ...station(), answerOutcomes: tierOutcomes(codes(id)) };
    case 'duel': return { ...base, ...station(), answerOutcomes: duelOutcomes(codes(id, ['g', 's', 'b'])) };
    case 'num': return { ...base, type: 'numeric', unmatchedPoints: 0, description: `${m.card}\nהצלם מקליד את התוצאה.`,
      answerOutcomes: m.numRanges.map(([lo, hi, pts], i) => ({ id: `r${i}`, label: `${lo} עד ${hi}`, range: { min: lo, max: hi }, points: pts, message: pts === G ? MSG.g : pts === S ? MSG.s : MSG.b })) };
    case 'grams': return { ...base, type: 'numeric', unmatchedPoints: B, answerOutcomes: [
      { id: 'exact', label: '100', range: { min: 100, max: 100 }, points: 300, message: '100 בדיוק.' },
      { id: 'lo2', label: '98 עד 99.9', range: { min: 98, max: 99.99 }, points: G, message: MSG.g },
      { id: 'hi2', label: '100.1 עד 102', range: { min: 100.01, max: 102 }, points: G, message: MSG.g },
      { id: 'lo5', label: '95 עד 97.9', range: { min: 95, max: 97.99 }, points: S, message: MSG.s },
      { id: 'hi5', label: '102.1 עד 105', range: { min: 102.01, max: 105 }, points: S, message: MSG.s },
    ] };
    case 'code': return { ...base, ...station({ secretCode: m.code }), pointValue: 150 };
    case 'falafel': return { ...base, ...station(), answerOutcomes: [
      { id: 'win', label: 'ניצחון', accepts: ['אלוף'], points: 250, message: 'לקחתם. תבחרו להם קללה.' },
      { id: 'solo', label: 'לבד', accepts: ['סולו'], points: 150, message: 'לבד מול השעון.' },
      { id: 'lose', label: 'הפסד', accepts: ['כבוד'], points: 100, message: 'הפעם הם לקחו. הקללה בדרך.' },
    ] };
    default: throw new Error(key);
  }
}

const faceOff = (rid) => `FACE OFF.\nהקלף שלכם: ${ROUTES[rid].name}. עוד קבוצה אחת קיבלה אותו, והיא היריבה שלכם עד כיכר ציון.\nתמצאו אותה. נציג מול נציג, פנים מול פנים, בלי לגעת. מי שצוחק או מוריד מבט ראשון, הפסיד.\nהצלמים מקלידים את התוצאה אחרי 19:35.`;
const finalRanges = [[88, 92, G], [85, 87.99, S], [92.01, 95, S], [80, 84.99, B], [95.01, 100, B]];

const stages = [
  { id: 'v5-gather', order: 0, title: 'ההתכנסות', isFinal: false,
    narrative: { intro: { title: '19:00, המרכזית', bodyHe: 'עוד חצי שעה יוצאים. כל קבוצה מקבלת פה צלם, והוא יהיה איתכם עד הסוף.' } },
    tasks: [clean({ id: 'poster', title: 'הפוסטר', type: 'photo', triggerMode: 'radius', geofenceRadiusMeters: 150,
      coordinates: { lat: P.cbs.lat, lng: P.cbs.lng }, difficulty: 2, estimatedMinutes: 6, expectedDurationMinutes: 4, pointValue: 100, maxConcurrentTeams: 12,
      description: 'פוסטר של סרט אקשן. אתם הקאסט, ושם הקבוצה הוא שם הסרט.\nהצלם מצלם, וזה הפוסטר שיעלה בסוף לאינסטגרם של המירוץ.',
      smart: { enabled: true, verificationType: 'photo_upload', autoApprove: true, adminNotes: 'תמונה אחת לכל קבוצה, מהצלם. משמשת לפתיח של הסרטון.' } })] },
  { id: 'v5-night', order: 1, title: 'הלילה', isFinal: false, requiredTaskCount: 7,
    narrative: {
      intro: { title: 'FACE OFF', bodyHe: 'שש קבוצות של שתיים. אתם והיריבים עוברים באותו מסלול, וזה נגמר בכיכר ציון. רואים רק את התחנה הבאה. הצלם שלכם הוא השופט.' },
      outro: { title: 'סגרתם', bodyHe: 'כולם לכיכר ציון.' } },
    tasks: [
      ...Object.keys(ROUTES).map((rid) => { const c = codes(`card-${rid}`, ['g', 's', 'b']); return clean({ id: `card-${rid}`, title: `FACE OFF: ${ROUTES[rid].name}`, description: faceOff(rid),
        type: 'smart_station', triggerMode: 'instant', coordinates: { lat: P.cbs.lat, lng: P.cbs.lng },
        difficulty: 1, estimatedMinutes: 5, expectedDurationMinutes: 5, pointValue: G, maxConcurrentTeams: 2, wrongAnswerPenalty: 'off',
        smart: { enabled: true, verificationType: 'code_verification', codeInputLabel: 'הצלם מקליד', adminNotes: 'מקלידים רק אחרי 19:35, אחרי שכל הקבוצות קיבלו קלף. קלפים עודפים נסגרים לפני 19:30.' },
        answerOutcomes: duelOutcomes(c) }); }),
      ...Object.entries(ROUTES).flatMap(([rid, r]) => r.missions.map((key, i) => clean(task(rid, key, i, schedule[rid][i])))),
    ],
    exclusiveGroups: [{ id: 'cards', taskIds: Object.keys(ROUTES).map((rid) => `card-${rid}`) }],
  },
  { id: 'v5-zion', order: 2, title: 'כיכר ציון', isFinal: true,
    narrative: { intro: { title: 'כיכר ציון', bodyHe: 'הגעתם. עוד צעקה אחת.' }, outro: { title: 'זהו', bodyHe: 'נשארים בכיכר. ב 22:00 ההכרזה.' } },
    tasks: [clean({ id: 'final', title: 'הצעקה האחרונה', type: 'numeric', triggerMode: 'radius', geofenceRadiusMeters: 80,
      coordinates: { lat: P.zion.lat, lng: P.zion.lng }, difficulty: 3, estimatedMinutes: 5, expectedDurationMinutes: 3, pointValue: G, maxConcurrentTeams: 12, unmatchedPoints: 0,
      description: 'שם הקבוצה, 3 צעקות, הצלם מודד בדציבלים.\nמי שהכי קרוב ל 90 לוקח. לא מי שהכי חזק.\nהצלם מקליד את המספר.',
      answerOutcomes: finalRanges.map(([lo, hi, pts], i) => ({ id: `r${i}`, label: `${lo} עד ${hi}`, range: { min: lo, max: hi }, points: pts, message: pts === G ? MSG.g : pts === S ? MSG.s : MSG.b })) })] },
];

const game = {
  title: 'המירוץ העירוני, ירושלים 22.10 (גרסה 5)',
  description: 'מירוץ לילי בירושלים, זוגות של קבוצות יריבות. התכנסות ב 19:00 בתחנה המרכזית, סיום בכיכר ציון בכ 22:00.',
  mode: 'team', scoringPreset: 'fixed_points_speed',
  instructions: { title: 'החוקים', bodyHe: [
    'התכנסות ב 19:00 במרכזית. יוצאים ב 19:40. סיום בכיכר ציון עד 22:00.',
    'ברגל או ברכבת הקלה. בלי מוניות, אופניים וקורקינטים. לכל אחד רב קו.',
    'כל הקבוצה ביחד. לא יורדים מהרכבת אחרי "העירייה", ולא נכנסים לעיר העתיקה.',
    'אין מגע בין בנים לבנות. לא נוגעים באנשים, ולא מצלמים מי שלא הסכים.',
    'לא רצים. אף משימה לא שווה את זה.',
    'הצלם שלכם שופט. הוא מקליד את הקוד, ואין ויכוחים.',
    'אפשר לוותר על כל משימה. SOS מגיע לצוות מיד.',
  ].join('\n') },
  stages,
};
const here = new URL('.', import.meta.url);
writeFileSync(new URL('game-v5.json', here), JSON.stringify({ format: 'rushpoint.game', schemaVersion: 1, exportedAt: new Date().toISOString(), game }, null, 2));

let md = '# לוח זמנים לדקה, גרסה 5 (נוצר על ידי build-game-v5.mjs)\n\n| שעה | כולם |\n|---|---|\n| 19:00 | התכנסות במרכזית, הפוסטר |\n| 19:30 | תדריך, כל קבוצה מקבלת קלף |\n| 19:35 | FACE OFF מול היריבים |\n| 19:40 | יוצאים |\n\n';
for (const [rid, rows] of Object.entries(schedule)) {
  md += `## ${rid}: ${ROUTES[rid].name}\n\n| הגעה | יציאה | תחנה | משימה | למה פה | איך מגיעים |\n|---|---|---|---|---|---|\n`;
  for (const row of rows) {
    const m = row.key === 'final' ? { title: 'הצעקה האחרונה', place: 'zion', why: 'הסיום.' } : M[row.key];
    md += `| ${hhmm(row.arrive)} | ${hhmm(row.leave)} | ${P[m.place].name} | ${m.title} | ${m.why} | ${row.how}, ${row.travel} דק' |\n`;
  }
  md += '\n';
}
md += '## בדיקות\n\n' + (problems.length ? problems.map((p) => `- ❌ ${p}`).join('\n') : '- ✅ אין מילים מרשימת הקרינג\' ואין משחקי מחנה.\n- ✅ בכל מסלול אין סוג שחוזר, יש לכל היותר משימת מוזיקה אחת, מערכון אחד ושתי משימות מול אנשים.\n- ✅ לכל משימה יש סיבה להיות במקום שלה.\n- ✅ השת"פים לא מקבלים שני זוגות ביחד, השוק לפני שנסגר והתריסים אחרי 21:00.\n- ✅ כולם בכיכר ציון עד 21:50.') + '\n';
writeFileSync(new URL('schedule-v5.md', here), md);

let ps = '# דפי צלמים, גרסה 5\n\n> לא להעביר לקבוצות. כל צלם מקבל רק את הדף שלו, ומקליד את הקוד בטלפון של הקבוצה בעצמו.\n> ספים לפי גודל: 4 עד 6 / 7 עד 9 / 10 עד 12. זהב 200, כסף 120, ארד 60, לא בוצע 0.\n> לסחוב: אטבים, דפים ועט (לעצומה), אפליקציית דציבלים (אותה אצל כולם).\n\n';
for (const [rid, r] of Object.entries(ROUTES)) {
  const fc = codes(`card-${rid}`, ['g', 's', 'b']);
  ps += `## מסלול ${rid}: ${r.name}\n\n### FACE OFF (19:35)\n\n- ניצחון \`${fc.g}\` · לבד \`${fc.s}\` · הפסד \`${fc.b}\`. **רק אחרי 19:35.**\n\n`;
  r.missions.forEach((key, i) => {
    const m = M[key]; const id = tid(rid, key); const row = schedule[rid][i];
    ps += `### ${i + 1}. ${m.title} (${hhmm(row.arrive)}, ${P[m.place].name})\n\n- **מי מפעיל:** ${m.by ?? 'הצלם'}\n- **הקאץ\':** ${m.secret}\n- **שיפוט:** זהב ${m.judge.g} · כסף ${m.judge.s} · ארד ${m.judge.b}\n`;
    if (m.score === 'tiers') { const c = codes(id); ps += `- **קודים:** זהב \`${c.g}\` · כסף \`${c.s}\` · ארד \`${c.b}\` · לא בוצע \`${c.x}\`\n`; }
    else if (m.score === 'duel') { const c = codes(id, ['g', 's', 'b']); ps += `- **קודים:** ניצחון \`${c.g}\` · לבד \`${c.s}\` · הפסד \`${c.b}\`\n`; }
    else if (m.score === 'num') ps += '- **מקלידים:** את המספר שספרתם.\n';
    else if (m.score === 'grams') ps += '- **מקלידים:** את המספר על המשקל.\n';
    else if (m.score === 'code') ps += `- **קוד:** \`${m.code}\` (הקבוצה מקלידה)\n`;
    else if (m.score === 'falafel') ps += '- **כרטיס מודפס:** `אלוף` · `סולו` · `כבוד`\n';
    ps += `- **צילום:** ${m.shots}\n\n`;
  });
  ps += '### הצעקה האחרונה (כיכר ציון)\n\n- 3 מטר מהקבוצה, ומקלידים את המספר.\n\n';
}
writeFileSync(new URL('PHOTOGRAPHER-SHEETS-v5.md', here), ps);

if (process.argv.includes('--print') || problems.length) console.log(md);
if (problems.length) { console.error(`${problems.length} problem(s)`); process.exit(1); }
console.log('game-v5.json + schedule-v5.md + PHOTOGRAPHER-SHEETS-v5.md written');
