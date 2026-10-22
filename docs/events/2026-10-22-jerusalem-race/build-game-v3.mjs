#!/usr/bin/env node
// The 22.10.2026 race, version 3: rival pairs on fixed routes, missions picked from the research bank
// (reports/משימות מרוץ לילי לנוער.md), and a minute-by-minute schedule computed from the real
// coordinates and the light rail times measured in the GTFS (ROUTE.md §2).
//
//   node docs/events/2026-10-22-jerusalem-race/build-game-v3.mjs            → game-v3.json + schedule-v3.md
//   node docs/events/2026-10-22-jerusalem-race/build-game-v3.mjs --print    → the schedule on stdout too
//
// HOW THE APP ENFORCES IT (only features that already exist):
//  * Stage 1 "ההתכנסות": one mission at the Central Bus Station, 19:00 to 19:30.
//  * Stage 2 "הלילה": everything else, in ONE stage, because unlockAfterTaskIds works inside a stage.
//    - Six route CARDS (A..F), one exclusive group, maxConcurrentTeams 2 each. Every team that finishes
//      stage 1 is routed to a card; a card holds its two slots until it is COMPLETED, and its code is
//      read out at the 19:35 briefing, so no slot is freed before every team holds one. Two teams on
//      the same card are rivals for the night. With fewer than 12 teams the organizer CLOSES the spare
//      cards (setRunTaskStatus) before 19:30: 8 teams → close E,F; 10 → close F.
//    - Each route is a chain of 7 missions, each unlocked by the previous one. Losing the card group
//      locks every other route for good, so a team only ever sees its own route.
//    - No releaseAt/expiresAt/timeLimit anywhere in a chain: an expired link would lock the rest of
//      the chain forever (satisfiesGate). Time windows are kept by the SCHEDULE, not by the app.
//  * Stage 3 "כיכר ציון": the press conference, everyone.
// Rivals on one route arrive at every station together; a station with one physical resource is
// visited by at most one route per time window (checked below, the build fails otherwise).

import { writeFileSync } from 'node:fs';

// ── Places (OpenStreetMap, 18.10.2026; ⚠ = to be pinned on the rehearsal walk) ───────────────────
const P = {
  cbs:       { lat: 31.78922, lng: 35.20322, name: 'רחבת התחנה המרכזית' },
  vendor:    { lat: 31.78560, lng: 35.21200, name: 'ספק ירקות, רחוב מחנה יהודה ⚠' },
  fruit:     { lat: 31.78480, lng: 35.21294, name: 'דוכן פירות יבשים, עץ חיים ⚠' },
  spice:     { lat: 31.78492, lng: 35.21260, name: 'חנות תבלינים, עץ חיים ⚠' },
  agripas:   { lat: 31.78424, lng: 35.21192, name: 'רחוב אגריפס מול השוק' },
  shukMid:   { lat: 31.78530, lng: 35.21230, name: 'השוק, בין הדוכנים' },
  shutters:  { lat: 31.78480, lng: 35.21250, name: 'תריסי סוזה, עץ חיים והאשכול' },
  nachlaot:  { lat: 31.78243, lng: 35.21312, name: 'אוהל משה, נחלאות ⚠ (החצר נבחרת בחזרה)' },
  busker:    { lat: 31.78148, lng: 35.21648, name: 'ראש מדרחוב בן יהודה' },
  benYehuda: { lat: 31.78160, lng: 35.21791, name: 'מדרחוב בן יהודה, אמצע' },
  falafel:   { lat: 31.78175, lng: 35.21900, name: 'פלאפליה ליד כיכר ציון ⚠' },
  zion:      { lat: 31.78197, lng: 35.21957, name: 'כיכר ציון' },
  russian:   { lat: 31.78155, lng: 35.22286, name: 'מגרש הרוסים' },
  safra:     { lat: 31.78032, lng: 35.22373, name: 'כיכר ספרא' },
  mamilla:   { lat: 31.77753, lng: 35.22435, name: 'מדרחוב ממילא' },
  jaffaGate: { lat: 31.77656, lng: 35.22727, name: 'שער יפו, מבחוץ' },
  teddy:     { lat: 31.77501, lng: 35.22641, name: 'פארק טדי' },
  windmill:  { lat: 31.77153, lng: 35.22423, name: 'טחנת הרוח, ימין משה' },
  mishkenot: { lat: 31.77189, lng: 35.22461, name: 'משכנות שאננים' },
  lions:     { lat: 31.76981, lng: 35.22446, name: 'מזרקת האריות, גן בלומפילד' },
};

// Red Line stops (OSM) and the ride: 1.5 min per stop (GTFS: Central Station → City Hall = 9 min / 6 stops).
const RAIL = [
  { id: 'cbs', lat: 31.78848, lng: 35.20256 }, { id: 'turim', lat: 31.78795, lng: 35.20681 },
  { id: 'my', lat: 31.78603, lng: 35.21142 }, { id: 'davidka', lat: 31.78458, lng: 35.21521 },
  { id: 'jaffaC', lat: 31.78287, lng: 35.21837 }, { id: 'cityHall', lat: 31.77969, lng: 35.22387 },
];
const R_EARTH = 6371000;
function dist(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}
// A group of 4 to 12 walks slower than one person: 4.2 km/h on the map, +30% for real streets.
const walkMin = (a, b) => (dist(a, b) * 1.3) / 70;
const nearestStop = (p) => RAIL.reduce((best, s) => (dist(p, s) < dist(p, best) ? s : best));
// Rail: walk to the nearest stop, 4 min average wait (a train every ~5, Thursday crowds), the ride,
// 2 min to get 4-12 people on and off, walk from the stop.
function railMin(a, b) {
  const sa = nearestStop(a); const sb = nearestStop(b);
  const hops = Math.abs(RAIL.indexOf(sa) - RAIL.indexOf(sb));
  if (hops < 2) return Infinity;
  return walkMin(a, sa) + 4 + hops * 1.5 + 2 + walkMin(sb, b);
}
function leg(a, b) {
  const w = walkMin(a, b); const r = railMin(a, b);
  return r + 3 < w ? { min: Math.ceil(r), how: 'רכבת' } : { min: Math.ceil(w), how: 'ברגל' };
}

// ── The missions (bank numbers from the research report in brackets) ─────────────────────────────
// Every text is the card the team reads: dry, official, plural ("אתם"), no slang from the organizer.
const M = {
  vendor: { place: 'vendor', min: 9, partner: 'ספק ירקות', type: 'code', code: 'סחורה', mode: 'instant',
    title: 'הסוחר החדש', bank: 9,
    text: 'בחרו שחקן אחד. עכשיו. לפני שאתם ממשיכים לקרוא.\n\nהשחקן שבחרתם עובד עכשיו בדוכן. יש לו 5 דקות למכור 3 פריטים לקונים אמיתיים, בקריאות שוק בלבד. הספק הוא השופט היחיד, והוא זה שנותן את הקוד. שאר הקבוצה לא עוזרת ולא מוכרת. מותר לה למחוא כפיים.' },
  fruit: { place: 'fruit', min: 9, partner: 'פירות יבשים', type: 'grams', mode: 'instant',
    title: '100 גרם. לא גרם יותר.', bank: 7,
    text: 'המשקל מכוסה. אתם צריכים להגיע בדיוק ל 100 גרם של פירות יבשים.\n\nכללים: כל אחד מכם מוסיף לפחות פרי אחד, בתורות. לפחות 4 סוגים שונים. ניסיון אחד. כשאתם מוכנים צועקים "שוקל!", הספק מוריד את הכיסוי, ואתם מקלידים את המספר. 100 בדיוק שווה כפול.' },
  spice: { place: 'spice', min: 8, partner: 'תבלינים', type: 'code', code: 'זעפרן', mode: 'instant',
    title: 'האף', bank: 8,
    text: 'בחרו שחקן אחד עם האף הכי טוב בקבוצה.\n\nהספק שם לפניו שלוש כוסות סגורות. מריחים בלבד, עם עיניים עצומות. מי שטועם, נפסל. על כל תבלין שהוא מזהה נכון, הספק נותן לכם אות אחת. שלוש אותיות, מילה אחת, זה הקוד. אם טעיתם, מבקשים מהספק אות בתמורה לשיר אחד שכל הקבוצה שרה לו.' },
  shukCall: { place: 'agripas', min: 6, type: 'video', mode: 'radius', title: 'קריאת שוק', bank: 11,
    text: 'בשוק צועקים על עגבניות. אתם תצעקו על משהו שאי אפשר לקנות: שקט, תור קצר בקופת חולים, סוללה של 3 אחוז, או משהו טוב יותר שתמציאו.\n\nכל הקבוצה ביחד, באותו קצב, 10 שניות, כאילו זה הדוכן שלכם כבר 40 שנה. מי שצוחק, מתחילים מההתחלה.' },
  word: { place: 'shukMid', min: 7, type: 'video', mode: 'radius', title: 'מילה אחת', bank: 12,
    text: 'מצאו מוכר שמדבר עוד שפה חוץ מעברית. בקשו ממנו ללמד אתכם מילה אחת שהוא אוהב. כל הקבוצה חוזרת עליה עד שהוא מאשר שזה נשמע נכון.\n\nהוא בפריים רק אם הסכים. אם לא, מצלמים רק אתכם.' },
  shutters: { place: 'shutters', min: 8, type: 'video', mode: 'radius', title: 'הפנים על התריסים', bank: 13,
    text: 'כשהשוק נסגר, התריסים הופכים לגלריה. מצאו שלושה מהם:\n1. הפיזיקאי שהציעו לו להיות נשיא המדינה, והוא סירב.\n2. ראש הממשלה שצויר הפוך.\n3. מישהו שאתם בטוחים שלא תמצאו פה, ומצאתם.\n\nסרטון אחד: בכל תריס כל הקבוצה עומדת בדיוק בתנוחה שלו. את התריס של ראש הממשלה מצלמים הפוך. הטלפון מתהפך, לא אתם.' },
  nachlaot: { place: 'nachlaot', min: 10, type: 'code', code: '0000', mode: 'hidden', r: 45,
    title: 'מבצע שקט', bank: 16,
    clue: 'מאחורי השוק יש שכונה שנבנתה בשביל להתפלל, ויש לה שם של אוהל. כאן גרים אנשים. מכאן אתם לא מדברים.',
    text: 'מהרגע הזה אף אחד לא מדבר, גם לא בלחישה. רק סימנים.\n\nבחצר הזאת כתוב על הקיר מספר. המספר הוא הקוד. מי שדיבר, הקבוצה מחכה 2 דקות לפני שמקלידה.',
    hint: 'החצר הכי קרובה לתחילת הסמטה, מימין.', note: '⚠ לבחור בחזרה את החצר, לעדכן את המספר, את הרמז ואת הנעץ.' },
  busker: { place: 'busker', min: 7, partner: 'נגן רחוב', type: 'code', code: 'כינור', mode: 'instant',
    title: 'תשירו לי את המילה', bank: 21,
    text: 'בראש המדרחוב עומד הנגן הרשמי של המירוץ. אמרו לו: "באנו לשמוע את השיר".\n\nהוא ינגן לשתי הקבוצות ביחד שיר מוכר, בלי מילים ומהר מדי. הקוד הוא המילה האחרונה בפזמון. לא זוכרים? שאלו את הרחוב, ומי שיודע ישיר לכם. אף אחד לא חייב לשיר סולו. בלי Shazam: מי שנתפס, הקבוצה מחכה 5 דקות.\n\nהקבוצה הראשונה שמקלידה נכון מקבלת יותר.' },
  falafel: { place: 'falafel', min: 12, partner: 'פלאפליה', type: 'falafel', mode: 'instant', pausesTimer: true,
    title: 'הדו קרב', bank: 48,
    text: 'כאן נפגשים עם הקבוצה היריבה. השעון שלכם עוצר כאן עד שתסיימו, אז אין שום סיבה למהר להגיע לפני הדו קרב.\n\nהכללים: 20 כדורים לכל קבוצה, 2 דקות. אוכלים בדיוק 4 מכל קבוצה, ולא יותר מ 5 כדורים לאחד. כדור אחד בפה בכל פעם, ופותחים פה לפני הבא. בצפירה יש 30 שניות לסיים את הכדור שבפה, בנחת, והוא נחשב. מי שמשתעל עוצר, והכדורים שלו לא נפסלים. יש מים על השולחן.\n\nבסוף איש הצוות נותן לכל קבוצה כרטיס עם קוד. מקלידים אותו.' },
  poll: { place: 'benYehuda', min: 8, type: 'video', mode: 'radius', title: 'משאל עם', bank: 26,
    text: 'השאלה: "פלאפל או שווארמה, לכל החיים?"\n\nקודם כתבו בצ\'אט של הקבוצה מה הרוב יגיד, ורק אחר כך שאלו 5 מבוגרים במדרחוב. מצלמים רק אתכם ואת הלוח. אם הניחוש שלכם נכון, הראו את זה למצלמה כאילו זכיתם בבחירות.' },
  slow: { place: 'benYehuda', min: 6, type: 'video', mode: 'radius', title: 'המירוץ האיטי בעולם', bank: 28,
    text: 'אתם באמצע מירוץ, אז עכשיו תעשו את ההפך. כל הקבוצה בשורה אחת, לאורך 20 מטר בצד המדרחוב, הכי לאט שאפשר, בלי לעצור לרגע.\n\nמי שעוצר, כל השורה חוזרת להתחלה. מצלמים מהצד, כמו גמר אולימפי.' },
  russian: { place: 'russian', min: 7, type: 'quiz', answers: ['עוג', 'האצבע של עוג'], mode: 'radius',
    title: 'האצבע', bank: 19,
    text: 'במגרש הרוסים, בתוך בור מגודר, שוכב עמוד ענק שמעולם לא הוקם. הוא שם כבר 2,000 שנה, ונסדק לפני שסיימו אותו.\n\nלעמוד יש שם: "האצבע של ___". מי הענק? אחר כך: אחד מכם מסביר למצלמה, בתור קבלן, למה העמוד יהיה מוכן אחרי החגים.',
    note: '⚠ לבדוק בחזרה שהבור מואר ושאפשר להתקרב אליו בלילה.' },
  safra: { place: 'safra', min: 7, type: 'video', mode: 'radius', title: 'בקשה לעירייה', bank: 33,
    text: 'בבניין הזה יושבת עיריית ירושלים. בחרו דובר, והוא מגיש לה עכשיו בקשה רשמית לשנות את השם של הרכבת הקלה. 15 שניות, בטון של ישיבת מועצה, והשאר מהנהנים ברצינות מאחוריו.\n\nמצלמים עם הגב לבניין, ושומרים מרחק מהמאבטחים.' },
  auction: { place: 'mamilla', min: 7, type: 'video', mode: 'radius', title: 'מכירה פומבית', bank: 35,
    text: 'מצאו בממילא חלון ראווה שאף אחד לא היה קונה ממנו כלום. ערכו לו מכירה פומבית: אחד הכרוז, וכל השאר מציעים מחירים מגוחכים ומתחרים זה בזה. 20 שניות, עד "נמכר!".\n\nלא מצלמים קונים ולא מצלמים את המוכרים בפנים.' },
  archaeo: { place: 'mamilla', min: 7, type: 'video', mode: 'radius', title: 'ממילא, 3026', bank: 36,
    text: 'השנה היא 3026, ואתם ארכיאולוגים שחפרו וגילו את ממילא. הדריכו 15 שניות של סיור על מה האנשים פה עשו, לדעתכם. בטון רציני, עם הסברים שגויים לגמרי.' },
  breach: { place: 'jaffaGate', min: 6, type: 'numeric', answer: 1898, mode: 'radius', title: 'הפרצה', bank: 37,
    text: 'ליד שער יפו יש פרצה רחבה בחומה, ורכבים נכנסים דרכה. מספרים שפרצו אותה כדי שקיסר גרמניה ייכנס לעיר בכרכרה.\n\nבאיזו שנה הוא הגיע?',
    hint: 'וילהלם השני. סוף המאה ה 19.', note: 'אחרי התשובה, בגמר: "פרצו בשבילו את החומה". אמת, חצי אמת או מיתוס? (בפועל בעיקר מילאו את החפיר)' },
  kaiser: { place: 'teddy', min: 7, type: 'video', mode: 'radius', title: 'הקיסר מגיע', bank: 38,
    text: 'אחד מכם הוא הקיסר וילהלם. כל השאר הם הפמליה: שומרים, משרתים, חצוצרן. כניסה טקסית של 10 מטר בפארק, כשהחומות מאחוריכם.\n\nבלי צחוק. מי שצוחק, הקיסר מוציא אותו להורג במבט.' },
  windmill: { place: 'windmill', min: 7, type: 'numeric', answer: 1857, mode: 'radius', title: 'הטחנה שלא טחנה', bank: 42,
    text: 'הטחנה הזאת נבנתה בשנה מסוימת. הקלידו אותה.\n\nואחר כך: יש ויכוח אמיתי בין המקורות אם היא אי פעם עבדה. הקבוצה מתחלקת לשני צדדים, ועורך דין אחד מכל צד מקבל 15 שניות למצלמה. רק על המדרכה, בלי ריצה במדרגות.' },
  mishkenot: { place: 'mishkenot', min: 6, type: 'video', mode: 'radius', title: 'דירה מחוץ לחומות', bank: 43,
    text: 'השנה 1860. משכנות שאננים היא השכונה הראשונה מחוץ לחומות, ואף אחד לא רוצה לגור פה. צלמו פרסומת נדל"ן של 15 שניות: "דירה מחוץ לחומות, קרוב לכלום, נוף לשום דבר". תתעלמו מזה שהדירות כאן היום עולות מיליונים.' },
  lions: { place: 'lions', min: 9, type: 'quiz', answers: ['יונה', 'יונת נח', 'יונה של נח'], mode: 'hidden', r: 40,
    title: 'האריות', bank: 44,
    clue: 'גן ליד ימין משה. מזרקה שגרמניה נתנה לעיר ב 1989. כמה מהדיירים שלה שואגים.',
    text: 'מצאתם אותם. בראש העץ שבמרכז המזרקה יושב מישהו שהאריות לא שמים לב אליו. מי?\n\nאחר כך: כל אחד בוחר אריה ונעמד בדיוק כמוהו, 30 שניות בלי לזוז.',
    hint: 'הוא הביא לנח עלה של זית.', note: '⚠ לבדוק בחזרה את התאורה בגן.' },
};

// ── The six routes ────────────────────────────────────────────────────────────────────────────────
// A,B: שוק → לב העיר → חומות. C,D: לב העיר → חומות → שוק. E,F: חומות → שוק → לב העיר. Two per zone.
// Falafel on A, C, E (6 teams); busker on B, D, F. Rivals = the two teams on one route.
const ROUTES = {
  A: { name: 'מסלול הסוחרים', missions: ['vendor', 'word', 'falafel', 'russian', 'auction', 'breach'] },
  B: { name: 'מסלול השקט', missions: ['nachlaot', 'fruit', 'busker', 'safra', 'kaiser', 'archaeo'] },
  C: { name: 'מסלול הדו קרב', missions: ['falafel', 'poll', 'breach', 'auction', 'spice', 'shutters'] },
  D: { name: 'מסלול הנגן', missions: ['busker', 'russian', 'breach', 'archaeo', 'fruit', 'word'] },
  E: { name: 'מסלול הקיסר', missions: ['kaiser', 'breach', 'spice', 'shukCall', 'poll', 'falafel'] },
  F: { name: 'מסלול המרגלים', missions: ['archaeo', 'breach', 'nachlaot', 'shukCall', 'busker', 'slow'] },
};

// ── Schedule ──────────────────────────────────────────────────────────────────────────────────────
const START = 19 * 60 + 40; // the card code is read out at 19:35, everyone leaves by 19:40
const FINISH_LIMIT = 21 * 60 + 50;
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const schedule = {};
for (const [rid, r] of Object.entries(ROUTES)) {
  let t = START; let at = P.cbs; const rows = [];
  for (const key of r.missions) {
    const m = M[key]; const to = P[m.place]; const l = leg(at, to);
    const arrive = t + l.min; const leave = arrive + m.min;
    rows.push({ key, how: l.how, travel: l.min, arrive, leave });
    t = leave; at = to;
  }
  const l = leg(at, P.zion);
  rows.push({ key: 'final', how: l.how, travel: l.min, arrive: t + l.min, leave: t + l.min + 8 });
  schedule[rid] = rows;
}

// Partner places host ONE pair at a time (the falafel table, the busker, the scale, the spice cups).
const problems = [];
const SINGLE = ['vendor', 'fruit', 'spice', 'busker', 'falafel'];
for (const place of SINGLE) {
  const visits = [];
  for (const [rid, rows] of Object.entries(schedule)) for (const row of rows) if (row.key !== 'final' && M[row.key].place === place) visits.push({ rid, ...row });
  visits.sort((a, b) => a.arrive - b.arrive);
  for (let i = 1; i < visits.length; i++) {
    if (visits[i].arrive < visits[i - 1].leave + 3) problems.push(`${place}: route ${visits[i - 1].rid} (${hhmm(visits[i - 1].arrive)}-${hhmm(visits[i - 1].leave)}) and route ${visits[i].rid} (${hhmm(visits[i].arrive)}) overlap`);
  }
}
for (const [rid, rows] of Object.entries(schedule)) {
  const end = rows[rows.length - 1].arrive;
  if (end > FINISH_LIMIT) problems.push(`route ${rid} reaches Zion Square at ${hhmm(end)}, after ${hhmm(FINISH_LIMIT)}`);
  for (const row of rows) if (row.key === 'shutters' && row.arrive < 21 * 60) problems.push(`route ${rid} reaches the shutters at ${hhmm(row.arrive)}, before 21:00`);
  for (const row of rows) if (row.key === 'vendor' && row.leave > 20 * 60 + 45) problems.push(`route ${rid} is at the vegetable stall until ${hhmm(row.leave)}, after it closes`);
}

// ── Game file ─────────────────────────────────────────────────────────────────────────────────────
const tid = (rid, key) => `${rid}-${key}`;
function task(rid, key, idx, row) {
  const m = M[key]; const p = P[m.place];
  const base = {
    id: tid(rid, key), title: m.title, description: m.text,
    coordinates: { lat: p.lat, lng: p.lng },
    difficulty: 5, estimatedMinutes: row.travel + m.min, expectedDurationMinutes: m.min,
    pointValue: 100, maxConcurrentTeams: 2,
    unlockAfterTaskIds: [idx === 0 ? `card-${rid}` : tid(rid, ROUTES[rid].missions[idx - 1])],
    tags: ['22.10', `route-${rid}`, m.partner ? 'partner' : 'street'],
  };
  if (m.mode === 'instant') Object.assign(base, { triggerMode: 'instant' });
  else if (m.mode === 'radius') Object.assign(base, { triggerMode: 'radius', geofenceRadiusMeters: 75 });
  else if (m.mode === 'hidden') Object.assign(base, { triggerMode: 'radius', geofenceRadiusMeters: m.r, hideLocation: true, locationClueHe: m.clue });
  if (m.pausesTimer) base.pausesTimer = true;
  if (m.hint) Object.assign(base, { hint: m.hint, hintPenalty: 40, hintAutoRevealMinutes: 8 });
  const notes = [m.partner ? `שת"פ: ${m.partner}.` : '', m.note ?? '', `בנק המחקר #${m.bank}. מתוכנן: הגעה ${hhmm(row.arrive)}, יציאה ${hhmm(row.leave)}.`].filter(Boolean).join(' ');
  const video = (min, max) => ({ type: 'photo', smart: { enabled: true, verificationType: 'photo_upload', captureKind: 'video', videoMinSeconds: min, videoMaxSeconds: max, autoApprove: true, adminNotes: notes } });
  switch (m.type) {
    case 'video': return { ...base, ...video(8, 45) };
    case 'code': return { ...base, type: 'smart_station', smart: { enabled: true, verificationType: 'code_verification', secretCode: m.code, codeInputLabel: 'הקוד', adminNotes: notes }, wrongAnswerPenalty: 'gentle' };
    case 'quiz': return { ...base, type: 'quiz', answers: m.answers };
    case 'numeric': return { ...base, type: 'numeric', numericAnswer: m.answer, numericTolerance: 0 };
    case 'grams': return { ...base, type: 'numeric', unmatchedPoints: 0, revealOutcomePoints: false, answerOutcomes: [
      { id: 'exact', label: '100 בדיוק', range: { min: 100, max: 100 }, points: 200, message: '100 בדיוק. הספק לא מאמין.' },
      { id: 'close-lo', label: '98 עד 99.9', range: { min: 98, max: 99.99 }, points: 120, message: 'כמעט.' },
      { id: 'close-hi', label: '100.1 עד 102', range: { min: 100.01, max: 102 }, points: 120, message: 'כמעט.' },
      { id: 'near-lo', label: '95 עד 97.9', range: { min: 95, max: 97.99 }, points: 60, message: 'קרוב.' },
      { id: 'near-hi', label: '102.1 עד 105', range: { min: 102.01, max: 105 }, points: 60, message: 'קרוב.' },
    ] };
    case 'falafel': return { ...base, type: 'smart_station', wrongAnswerPenalty: 'off', smart: { enabled: true, verificationType: 'code_verification', codeInputLabel: 'הקוד מהכרטיס', adminNotes: `${notes} קודים: ניצחון=אלוף, הפסד=כבוד, לבד מול השעון=סולו. איש צוות ליד השולחן, יודע היימליך, לא מצלם.` },
      answerOutcomes: [
        { id: 'win', label: 'ניצחון', accepts: ['אלוף'], points: 250, message: 'ניצחתם את היריבים.' },
        { id: 'lose', label: 'הפסד', accepts: ['כבוד'], points: 100, message: 'הפסדתם בכבוד.' },
        { id: 'solo', label: 'לבד', accepts: ['סולו'], points: 150, message: 'אכלתם לבד מול השעון.' },
      ] };
    default: throw new Error(key);
  }
}

const cardText = (rid) => `זה הקלף שלכם להערב: ${ROUTES[rid].name}.\n\nעל אותו קלף יש עוד קבוצה אחת בלבד, והיא היריבה שלכם עד הסוף. אתם עוברים באותן תחנות, באותו סדר, ובחלק מהן נלחמים ראש בראש. מצאו אותה ברחבה, ועמדו מולה 5 שניות של מבט לפני קרב, בלי לצחוק ובלי לגעת.\n\nאת הקוד שמסיים את המשימה הזאת יקריאו בתדריך, ב 19:35.`;

const stages = [
  { id: 'v3-gather', order: 0, title: 'ההתכנסות', isFinal: false,
    narrative: { intro: { title: 'ערב טוב', bodyHe: 'התחנה המרכזית, 19:00. עוד חצי שעה מתחיל המירוץ. עד אז, משימה אחת, ואתם כבר יודעים שאנחנו רציניים.' } },
    tasks: [{ id: 'gather', title: 'כריזה', type: 'photo', triggerMode: 'radius', geofenceRadiusMeters: 150,
      coordinates: { lat: P.cbs.lat, lng: P.cbs.lng }, difficulty: 3, estimatedMinutes: 10, expectedDurationMinutes: 5, pointValue: 100, maxConcurrentTeams: 12,
      description: 'הקליטו הודעת כריזה רשמית על האיחור של הקבוצה שלכם, כמו בתחנה המרכזית: "קבוצת ___ מעדכנת כי..." 15 שניות, בטון של מוקד שירות. אסור לחייך. מי שמחייך, מתחילים מהתחלה.',
      smart: { enabled: true, verificationType: 'photo_upload', captureKind: 'video', videoMinSeconds: 8, videoMaxSeconds: 30, autoApprove: true, adminNotes: 'בנק המחקר #1. מחוץ לבניין, לא בכניסה של הבידוק.' } }] },
  { id: 'v3-night', order: 1, title: 'הלילה', isFinal: false, requiredTaskCount: 7,
    narrative: {
      intro: { title: 'הקלפים חולקו', bodyHe: 'שש קבוצות של שתיים. כל זוג הולך באותו מסלול, ורק אחת יוצאת ממנו עם יותר נקודות. המסלול שלכם נפתח תחנה אחרי תחנה, ואת התחנה הבאה רואים רק כשמסיימים את הנוכחית. רוב התחנות נפתחות רק כשמגיעים אליהן.' },
      outro: { title: 'כמעט', bodyHe: 'סיימתם את המסלול. כולם נפגשים בכיכר ציון.' } },
    tasks: [
      ...Object.keys(ROUTES).map((rid) => ({ id: `card-${rid}`, title: `קלף ${rid}: ${ROUTES[rid].name}`, description: cardText(rid),
        type: 'smart_station', triggerMode: 'instant', coordinates: { lat: P.cbs.lat, lng: P.cbs.lng },
        difficulty: 1, estimatedMinutes: 5, expectedDurationMinutes: 5, pointValue: 0, maxConcurrentTeams: 2,
        smart: { enabled: true, verificationType: 'code_verification', secretCode: 'יריבים', codeInputLabel: 'הקוד מהתדריך', adminNotes: 'הקוד מוקרא בתדריך ב 19:35, רק אחרי שכל הקבוצות קיבלו קלף. קלף שלא צריך (פחות מ 12 קבוצות) נסגר לפני 19:30.' } })),
      ...Object.entries(ROUTES).flatMap(([rid, r]) => r.missions.map((key, i) => task(rid, key, i, schedule[rid][i]))),
    ],
    exclusiveGroups: [{ id: 'cards', taskIds: Object.keys(ROUTES).map((rid) => `card-${rid}`) }],
  },
  { id: 'v3-zion', order: 2, title: 'כיכר ציון', isFinal: true,
    narrative: { intro: { title: 'כיכר ציון', bodyHe: 'הגעתם. עוד משימה אחת, ואז ההכרזה.' }, outro: { title: 'זהו', bodyHe: 'נשארים בכיכר. בעוד כמה דקות מכריזים על הזוכים.' } },
    tasks: [{ id: 'final', title: 'מסיבת עיתונאים', type: 'photo', triggerMode: 'radius', geofenceRadiusMeters: 80,
      coordinates: { lat: P.zion.lat, lng: P.zion.lng }, difficulty: 3, estimatedMinutes: 8, expectedDurationMinutes: 6, pointValue: 100, maxConcurrentTeams: 12,
      description: 'מסיבת עיתונאים אחרי המירוץ. דובר אחד מסביר למה הקבוצה הפסידה, גם אם היא ניצחה. כל השאר כתבים, ושואלים אותו שאלות קשות. 20 שניות. מי שצוחק, מתחילים מההתחלה.',
      smart: { enabled: true, verificationType: 'photo_upload', captureKind: 'video', videoMinSeconds: 10, videoMaxSeconds: 40, autoApprove: true, adminNotes: 'בנק המחקר #23 (בלי היונה: בלילה הן ישנות).' } }] },
];

const game = {
  title: 'המירוץ העירוני, ירושלים 22.10 (גרסה 3)',
  description: 'מירוץ לילי בירושלים לזוגות של קבוצות יריבות: התכנסות ב 19:00 בתחנה המרכזית, וסיום בכיכר ציון בכ 22:00. מותר ללכת ברגל ולנסוע ברכבת הקלה.',
  mode: 'team', scoringPreset: 'fixed_points_speed',
  instructions: { title: 'החוקים', bodyHe: [
    'התכנסות ב 19:00 בתחנה המרכזית. זינוק ב 19:40, אחרי התדריך. מסיימים בכיכר ציון עד 22:00.',
    'מתניידים ברגל או ברכבת הקלה בלבד. בלי מוניות, בלי אופניים, בלי קורקינטים. לכל אחד רב קו.',
    'כל הקבוצה ביחד, כל הזמן. לא יורדים מהרכבת אחרי תחנת "העירייה". לעיר העתיקה לא נכנסים.',
    'לא נוגעים בזרים, לא מצלמים מי שלא הסכים, ולא מצלמים שוטרים או מאבטחים. בנים ובנות לא נוגעים זה בזה במשימות.',
    'לא רצים ליד הרכבת ובמעברי חצייה. אף משימה לא שווה את זה.',
    'בלי אלכוהול, בלי Shazam, בלי מסכות ובלי חפצים שנראים כמו נשק.',
    'בכל רגע אפשר לוותר על משימה. ב SOS הצוות רואה אתכם מיד.',
  ].join('\n') },
  stages,
};

const here = new URL('.', import.meta.url);
writeFileSync(new URL('game-v3.json', here), JSON.stringify({ format: 'rushpoint.game', schemaVersion: 1, exportedAt: new Date().toISOString(), game }, null, 2));

// ── schedule-v3.md ────────────────────────────────────────────────────────────────────────────────
let md = '# לוח זמנים לדקה, גרסה 3 (נוצר על ידי build-game-v3.mjs)\n\n';
md += 'הזמנים מחושבים מהקואורדינטות: הליכה של 4.2 קמ"ש ועוד 30% לרחובות אמיתיים, ורכבת לפי ה GTFS (כל 5 דקות, 1.5 דקות לתחנה), ועוד 4 דקות המתנה ו 2 דקות עלייה של קבוצה.\n\n';
md += '| שעה | כולם |\n|---|---|\n| 19:00 | התכנסות במרכזית, צ\'ק אין, משימת "כריזה" |\n| 19:30 | תדריך, וכל קבוצה מקבלת קלף באפליקציה |\n| 19:35 | הקראת קוד הקלפים |\n| 19:40 | יציאה |\n\n';
for (const [rid, rows] of Object.entries(schedule)) {
  md += `## ${rid}: ${ROUTES[rid].name}\n\n| הגעה | יציאה | תחנה | משימה | איך מגיעים | נסיעה |\n|---|---|---|---|---|---|\n`;
  for (const row of rows) {
    const m = row.key === 'final' ? { title: 'מסיבת עיתונאים', place: 'zion' } : M[row.key];
    md += `| ${hhmm(row.arrive)} | ${hhmm(row.leave)} | ${P[m.place].name} | ${m.title}${m.partner ? ' (שת"פ)' : ''} | ${row.how} | ${row.travel} דק' |\n`;
  }
  md += '\n';
}
md += '## בדיקות\n\n' + (problems.length ? problems.map((p) => `- ❌ ${p}`).join('\n') : '- ✅ אף תחנה עם משאב אחד לא מקבלת שני זוגות באותו זמן (מרווח של 3 דקות לפחות).\n- ✅ כל המסלולים מגיעים לכיכר ציון עד 21:50.\n- ✅ התריסים אחרי 21:00, ספק הירקות לפני 20:45.') + '\n';
writeFileSync(new URL('schedule-v3.md', here), md);
if (process.argv.includes('--print') || problems.length) console.log(md);
if (problems.length) { console.error(`${problems.length} schedule problem(s)`); process.exit(1); }
console.log('game-v3.json + schedule-v3.md written');
