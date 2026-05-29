import { create } from 'zustand';

// ── Supported languages ───────────────────────────────────────────────────────
export type Lang = 'en' | 'he';
const STORAGE_KEY = 'rushpoint.mobile.lang';

type Dict = Record<string, string>;

// ── Translation dictionaries ───────────────────────────────────────────────────
const en: Dict = {
  // Branding / access-code
  'brand.tagline': 'הַמִּרוּץ לְצִיּוֹן',
  'access.intro': 'Enter your event access code to begin the race.',
  'access.codeLabel': 'Access Code',
  'access.codePlaceholder': 'e.g. LION01',
  'access.enter': 'Enter Event →',
  'access.codeRequired': 'Please enter your access code.',
  'access.connError': 'Connection error — try again',
  'access.invalidCode': 'Invalid access code',

  // Register
  'register.codeLabel': 'Code: {code}',
  'register.title': 'Register Your Team',
  'register.subtitle': 'Fill in the details below to begin the race.',
  'register.teamName': 'Team Name',
  'register.teamNamePlaceholder': 'e.g. The Lions',
  'register.captainPhone': "Captain's Phone Number",
  'register.participants': 'Participants',
  'register.namePlaceholder': 'Name {n}',
  'register.age': 'Age',
  'register.teamSizeHint': 'Teams must have {min}–{max} members.',
  'register.addParticipant': '+ Add Participant',
  'register.waiverTitle': 'Liability & Health Waiver',
  'register.waiverBody':
    'I confirm all participants are in good health and fit to participate in this physical outdoor activity. I release the organizers from any liability for personal injuries or accidents during the event.',
  'register.waiverAccept': 'I accept all terms and conditions',
  'register.start': 'Start the Race →',
  'register.errTeamName': 'Team name is required.',
  'register.errPhone': "Captain's phone number is required.",
  'register.errParticipants': 'Add at least one participant name.',
  'register.errMinParticipants': 'A team needs at least {min} participants.',
  'register.errMaxParticipants': 'A team can have at most {max} participants.',
  'register.errWaiver': 'You must accept the waiver to continue.',
  'register.errSubmit': 'Registration failed — check your connection and try again.',

  // Dashboard
  'dash.team': 'Team',
  'dash.score': 'Score',
  'dash.pts': 'pts',
  'dash.penalty': 'penalty',
  'dash.slotsCompleted': '{n} of 6 stages completed',
  'dash.currentMission': 'Current Mission',
  'dash.loadError': 'Could not load game state. Check your connection.',
  'dash.noMission': 'No active mission — check with your game master.',
  'dash.raceProgress': 'Race Progress',
  'dash.activeMission': 'Active Mission',
  'dash.taskLabel': 'Task: {id}',
  'dash.assigning': 'Your task is being assigned. Stand by.',
  'dash.timeFrozen': 'Time frozen',
  'dash.elapsed': 'Elapsed',
  'dash.beingJudged': 'Being judged',
  'slot.green': 'Open Field Mission',
  'slot.greenN': 'Field Mission {n}',
  'slot.gate': 'Matchmaking Duel',
  'slot.orange': 'Find the Tene',
  'slot.gold': 'Craft & Judge',

  // Stage tracker status chips
  'stage.done': 'Done',
  'stage.current': 'Now',
  'stage.locked': 'Locked',
  'stage.skipped': 'Skipped',

  // Judge check-in (team requests grading)
  'checkin.arrived': "I've arrived at the judge",
  'checkin.requested': 'The judge has been notified.',
  'checkin.waiting': 'Waiting for the judge…',
  'checkin.error': 'Could not notify the judge. Try again.',
  'checkin.basketTitle': 'Tene Basket — Final Judging',

  // Evacuation (force-majeure station closure)
  'evac.moved': 'Management moved you off "{station}". Await your next assignment.',

  // Connectivity
  'offline.lost': "You're offline — progress is saved and will sync when you reconnect.",
  'offline.restored': 'Back online — syncing your progress.',

  // Map
  'map.open': 'Mission Map',
  'map.title': 'Mission Map',
  'map.subtitle': 'Station locations across the Jerusalem course.',
  'map.noToken': 'Add EXPO_PUBLIC_MAPBOX_TOKEN to apps/mobile/.env to show the live map.',
  'map.back': '← Back',

  // Gate sprint (orange slot)
  'gate.title': 'Race to Bible Park!',
  'gate.subtitle': 'Target: {target} min transit. Clock is running.',
  'gate.elapsed': 'Transit time',
  'gate.warning': '⚠️ Late — penalty will apply',
  'gate.arrived': 'Check in at gate →',
  'gate.penalty': 'Transit penalty: {pts} pts',

  // Matchmaking
  'match.title': 'Gate Match',
  'match.waiting': 'Waiting for opponent…',
  'match.matched': 'Matched vs {opponent}!',
  'match.won': '🏆 You won! +{bonus} pts',
  'match.lost': '😤 You lost — {delay}s delay',
  'match.lostTitle': '😤 You lost this duel',
  'match.rematchWaiting': 'Waiting for a new opponent — only the winner advances.',
  'match.bypassed': 'No match — proceed to basket.',
  'match.mustDuel': 'You must win a duel to advance. Enter the queue when ready.',
  'match.joinQueue': 'Enter Match Queue',

  // Basket zone
  'basket.title': 'Find Your Basket',
  'basket.riddleLabel': 'Your riddle:',
  'basket.zone': 'Zone: {name}',
  'basket.scanPrompt': 'Scan the basket QR when you arrive.',
  'basket.startTimer': 'Start 20-min Timer',
  'basket.delay': 'Match penalty — wait {sec}s',

  // Crafting countdown
  'craft.title': 'Decorate Your Basket!',
  'craft.timeLeft': 'Time left',
  'craft.expired': 'Time\'s up — sprint to the judge!',
  'craft.sprintWindow': 'Sprint window',
  'craft.sprintLeft': '{sec}s to reach the judge',
  'craft.sprintExpired': 'Late — exponential penalty accumulating!',
  'craft.menuTitle': 'Fill your Tene',
  'craft.menuHint': 'Tap each product you prepare — the judge sees your picks.',
  'craft.minShort': 'min',
  'craft.estTime': 'Est. time: {min} min',
  'craft.potentialPts': 'Potential: +{pts} pts',
  'craft.goToJudge': 'Go to the judge',
  'craft.goToJudgeEarly': 'Leave now and you keep your remaining time + 90s to reach the judging queue.',
  'craft.goToJudgeLate': 'Sprint! Only {sec}s left to reach the judging queue.',

  // Flash mission
  'flash.label': 'FLASH MISSION',
  'flash.bonus': '+{bonus} pts',
  'flash.expiresIn': 'Ends in {sec}s',
  'flash.dismiss': 'Got it',

  // Call staff (emergency / technical)
  'staff.open': 'Call staff',
  'staff.title': 'Call Staff',
  'staff.subtitle': 'Choose the type of help you need. Staff get your location, team roster and captain phone.',
  'staff.emergency': 'Emergency',
  'staff.emergencyDesc': 'Injury or danger — raises a loud alert for staff.',
  'staff.technical': 'Technical issue',
  'staff.technicalDesc': 'Equipment or logistics — staff will come help.',
  'staff.sending': 'Calling staff…',
  'staff.sent': 'Staff notified.',
  'staff.sentEmergency': 'Emergency alert sent — help is on the way.',
  'staff.sentTechnical': 'Request sent — staff will assist shortly.',
  'staff.staySafe': 'Stay where you are. Staff have been notified.',
  'staff.error': 'Could not reach staff. Try again.',

  // SOS (legacy keys, retained)
  'sos.open': 'SOS',
  'sos.title': 'Emergency',
  'sos.subtitle': 'Send an alert to the event staff. Only use this in a real emergency.',
  'sos.tapToArm': 'Tap to\nrequest help',
  'sos.confirmPrompt': 'Are you sure? This alerts the staff immediately.',
  'sos.sendNow': 'SEND SOS',
  'sos.cancel': 'Cancel',
  'sos.sending': 'Sending alert…',
  'sos.sent': 'Alert sent — help is on the way.',
  'sos.confirmed': 'Help requested',
  'sos.staySafe': 'Stay where you are. Staff have been notified.',
  'sos.error': 'Could not send alert. Try again.',

  // Clue hint
  'hint.ask': 'Need a hint?',
  'hint.cost': '−50 pts',
  'hint.confirm': 'Use hint (−50)',
  'hint.cancel': 'Cancel',
  'hint.applied': 'Hint unlocked — 50 pts deducted.',
  'hint.error': 'Could not request a hint.',

  // Final run
  'final.label': 'FINISHED',
  'final.title': 'Race Complete!',
  'final.finalScore': 'Your final score',
  'final.awaitReveal': 'Results are revealed live at the finish line — last place to first. Good luck!',
  'final.backToDash': 'Back to dashboard',
};

const he: Dict = {
  // Branding / access-code
  'brand.tagline': 'הַמִּרוּץ לְצִיּוֹן',
  'access.intro': 'הזינו את קוד הגישה לאירוע כדי להתחיל את המירוץ.',
  'access.codeLabel': 'קוד גישה',
  'access.codePlaceholder': 'לדוגמה: LION01',
  'access.enter': 'כניסה לאירוע →',
  'access.codeRequired': 'אנא הזינו את קוד הגישה שלכם.',
  'access.connError': 'שגיאת חיבור — נסו שוב',
  'access.invalidCode': 'קוד גישה שגוי',

  // Register
  'register.codeLabel': 'קוד: {code}',
  'register.title': 'רישום הקבוצה',
  'register.subtitle': 'מלאו את הפרטים למטה כדי להתחיל את המירוץ.',
  'register.teamName': 'שם הקבוצה',
  'register.teamNamePlaceholder': 'לדוגמה: האריות',
  'register.captainPhone': 'מספר הטלפון של הקפטן',
  'register.participants': 'משתתפים',
  'register.namePlaceholder': 'שם {n}',
  'register.age': 'גיל',
  'register.teamSizeHint': 'בקבוצה חייבים להיות {min}–{max} חברים.',
  'register.addParticipant': '+ הוספת משתתף',
  'register.waiverTitle': 'הצהרת בריאות ואחריות',
  'register.waiverBody':
    'אני מאשר/ת שכל המשתתפים בריאים וכשירים להשתתף בפעילות גופנית חיצונית זו. אני משחרר/ת את המארגנים מכל אחריות לפציעות אישיות או תאונות במהלך האירוע.',
  'register.waiverAccept': 'אני מקבל/ת את כל התנאים וההגבלות',
  'register.start': 'התחלת המירוץ →',
  'register.errTeamName': 'שם הקבוצה הוא שדה חובה.',
  'register.errPhone': 'מספר הטלפון של הקפטן הוא שדה חובה.',
  'register.errParticipants': 'הוסיפו לפחות שם משתתף אחד.',
  'register.errMinParticipants': 'בקבוצה חייבים להיות לפחות {min} משתתפים.',
  'register.errMaxParticipants': 'בקבוצה יכולים להיות עד {max} משתתפים.',
  'register.errWaiver': 'יש לאשר את ההצהרה כדי להמשיך.',
  'register.errSubmit': 'הרישום נכשל — בדקו את החיבור ונסו שוב.',

  // Dashboard
  'dash.team': 'קבוצה',
  'dash.score': 'ניקוד',
  'dash.pts': 'נק׳',
  'dash.penalty': 'קנס',
  'dash.slotsCompleted': '{n} מתוך 6 שלבים הושלמו',
  'dash.currentMission': 'המשימה הנוכחית',
  'dash.loadError': 'לא ניתן לטעון את מצב המשחק. בדקו את החיבור.',
  'dash.noMission': 'אין משימה פעילה — פנו למנהל המשחק.',
  'dash.raceProgress': 'התקדמות המירוץ',
  'dash.activeMission': 'משימה פעילה',
  'dash.taskLabel': 'משימה: {id}',
  'dash.assigning': 'המשימה שלכם בהקצאה. המתינו.',
  'dash.timeFrozen': 'הזמן מוקפא',
  'dash.elapsed': 'זמן שחלף',
  'dash.beingJudged': 'בשיפוט',
  'slot.green': 'משימת שטח פתוח',
  'slot.greenN': 'משימת שדה {n}',
  'slot.gate': 'דו-קרב זיווג',
  'slot.orange': 'מצאו את הטנא',
  'slot.gold': 'יצירה ושיפוט',

  // Stage tracker status chips
  'stage.done': 'הושלם',
  'stage.current': 'עכשיו',
  'stage.locked': 'נעול',
  'stage.skipped': 'דולג',

  // Judge check-in (team requests grading)
  'checkin.arrived': 'הגעתי לשופט',
  'checkin.requested': 'השופט קיבל התראה.',
  'checkin.waiting': 'ממתינים לשופט…',
  'checkin.error': 'לא ניתן ליידע את השופט. נסו שוב.',
  'checkin.basketTitle': 'טנא — שיפוט סופי',

  // Evacuation (force-majeure station closure)
  'evac.moved': 'ההנהלה העבירה אתכם מ"{station}". המתינו למשימה הבאה.',

  // Connectivity
  'offline.lost': 'אין חיבור — ההתקדמות נשמרת ותסונכרן כשהחיבור יחזור.',
  'offline.restored': 'החיבור חזר — מסנכרן את ההתקדמות.',

  // Map
  'map.open': 'מפת המשימות',
  'map.title': 'מפת המשימות',
  'map.subtitle': 'מיקומי העמדות לאורך מסלול ירושלים.',
  'map.noToken': 'הוסיפו EXPO_PUBLIC_MAPBOX_TOKEN לקובץ apps/mobile/.env כדי להציג את המפה.',
  'map.back': '← חזרה',

  // Gate sprint (orange slot)
  'gate.title': 'רוצו לפארק התנ"ך!',
  'gate.subtitle': 'יעד: {target} דק׳ מעבר. השעון רץ.',
  'gate.elapsed': 'זמן מעבר',
  'gate.warning': '⚠️ איחור — יוחל עונש',
  'gate.arrived': 'צ׳ק-אין בשער ←',
  'gate.penalty': 'עונש מעבר: {pts} נק׳',

  // Matchmaking
  'match.title': 'דו-קרב בשער',
  'match.waiting': 'ממתינים ליריב…',
  'match.matched': 'זווגתם מול {opponent}!',
  'match.won': '🏆 ניצחתם! +{bonus} נק׳',
  'match.lost': '😤 הפסדתם — עיכוב {delay} שנ׳',
  'match.lostTitle': '😤 הפסדתם בדו-קרב',
  'match.rematchWaiting': 'ממתינים ליריב חדש — רק המנצח ממשיך.',
  'match.bypassed': 'אין זיווג — המשיכו לסל.',
  'match.mustDuel': 'חובה לנצח בדו-קרב כדי להתקדם. היכנסו לתור כשאתם מוכנים.',
  'match.joinQueue': 'כניסה לתור הזיווג',

  // Basket zone
  'basket.title': 'מצאו את הסל שלכם',
  'basket.riddleLabel': 'החידה שלכם:',
  'basket.zone': 'אזור: {name}',
  'basket.scanPrompt': 'סרקו את ה-QR של הסל כשתגיעו.',
  'basket.startTimer': 'התחלת טיימר 20 דק׳',
  'basket.delay': 'עונש דו-קרב — המתינו {sec} שנ׳',

  // Crafting countdown
  'craft.title': 'קשטו את הסל!',
  'craft.timeLeft': 'זמן שנותר',
  'craft.expired': 'הזמן נגמר — רוצו לשופט!',
  'craft.sprintWindow': 'חלון ריצה',
  'craft.sprintLeft': '{sec} שנ׳ להגיע לשופט',
  'craft.sprintExpired': 'איחור — עונש מצטבר!',
  'craft.menuTitle': 'מלאו את הטנא',
  'craft.menuHint': 'סמנו כל מוצר שהכנתם — הבחירות מוצגות לשופט.',
  'craft.minShort': 'דק׳',
  'craft.estTime': 'זמן מוערך: {min} דק׳',
  'craft.potentialPts': 'פוטנציאל: +{pts} נק׳',
  'craft.goToJudge': 'ללכת לשופט',
  'craft.goToJudgeEarly': 'אם תצאו עכשיו, נשאר לכם הזמן שנותר + 90 שניות להגיע לתור השיפוט.',
  'craft.goToJudgeLate': 'ספרינט! נותרו רק {sec} שניות להגיע לתור השיפוט.',

  // Flash mission
  'flash.label': 'משימת ברק',
  'flash.bonus': '+{bonus} נק׳',
  'flash.expiresIn': 'מסתיים בעוד {sec} שנ׳',
  'flash.dismiss': 'הבנתי',

  // Call staff (emergency / technical)
  'staff.open': 'קריאה לצוות',
  'staff.title': 'קריאה לאיש צוות',
  'staff.subtitle': 'בחרו את סוג העזרה שאתם צריכים. הצוות יקבל את המיקום, רשימת החברים וטלפון הקפטן.',
  'staff.emergency': 'אירוע חירום',
  'staff.emergencyDesc': 'פציעה או סכנה — מפעיל אזעקה חזקה אצל הצוות.',
  'staff.technical': 'תקלה תכנית',
  'staff.technicalDesc': 'ציוד או לוגיסטיקה — איש צוות יגיע לעזור.',
  'staff.sending': 'קורא לצוות…',
  'staff.sent': 'הצוות קיבל התראה.',
  'staff.sentEmergency': 'התראת חירום נשלחה — עזרה בדרך.',
  'staff.sentTechnical': 'הבקשה נשלחה — איש צוות יסייע בקרוב.',
  'staff.staySafe': 'הישארו במקום. הצוות קיבל התראה.',
  'staff.error': 'לא ניתן ליצור קשר עם הצוות. נסו שוב.',

  // SOS (legacy keys, retained)
  'sos.open': 'מצוקה',
  'sos.title': 'חירום',
  'sos.subtitle': 'שלחו התראה לצוות האירוע. השתמשו בזה רק במצב חירום אמיתי.',
  'sos.tapToArm': 'הקישו\nלבקשת עזרה',
  'sos.confirmPrompt': 'בטוחים? פעולה זו תתריע לצוות מיד.',
  'sos.sendNow': 'שלח מצוקה',
  'sos.cancel': 'ביטול',
  'sos.sending': 'שולח התראה…',
  'sos.sent': 'ההתראה נשלחה — עזרה בדרך.',
  'sos.confirmed': 'בקשת העזרה נשלחה',
  'sos.staySafe': 'הישארו במקום. הצוות קיבל התראה.',
  'sos.error': 'לא ניתן לשלוח התראה. נסו שוב.',

  // Clue hint
  'hint.ask': 'צריכים רמז?',
  'hint.cost': '−50 נק׳',
  'hint.confirm': 'השתמש ברמז (−50)',
  'hint.cancel': 'ביטול',
  'hint.applied': 'הרמז נפתח — נוכו 50 נק׳.',
  'hint.error': 'לא ניתן לבקש רמז.',

  // Final run
  'final.label': 'הסתיים',
  'final.title': 'המירוץ הושלם!',
  'final.finalScore': 'הניקוד הסופי שלכם',
  'final.awaitReveal': 'התוצאות נחשפות בשידור חי בקו הסיום — מהמקום האחרון לראשון. בהצלחה!',
  'final.backToDash': 'חזרה ללוח',
};

const DICTS: Record<Lang, Dict> = { en, he };

// ── Persistence (web localStorage; no-op on native without it) ─────────────────
function readInitialLang(): Lang {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    const saved = ls?.getItem(STORAGE_KEY);
    if (saved === 'he' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

function applySideEffects(lang: Lang): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    ls?.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  // Web RTL: flip document direction so logical CSS (ms-/me-/text-start) mirrors.
  const doc = (globalThis as { document?: Document }).document;
  if (doc?.documentElement) {
    doc.documentElement.lang = lang;
    doc.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  }
}

// ── Store ──────────────────────────────────────────────────────────────────────
interface LanguageState {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  lang: readInitialLang(),
  setLang: (l) => {
    applySideEffects(l);
    set({ lang: l });
  },
  toggle: () => get().setLang(get().lang === 'en' ? 'he' : 'en'),
}));

// Apply direction on first load (web).
applySideEffects(useLanguageStore.getState().lang);

// ── Hook ─────────────────────────────────────────────────────────────────────
export interface Translation {
  lang: Lang;
  isRtl: boolean;
  toggle: () => void;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export function useTranslation(): Translation {
  const { lang, toggle, setLang } = useLanguageStore();
  const t = (key: string, vars?: Record<string, string | number>): string => {
    let str = DICTS[lang][key] ?? DICTS.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  };
  return { lang, isRtl: lang === 'he', toggle, setLang, t };
}
