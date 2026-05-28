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
  'register.addParticipant': '+ Add Participant',
  'register.waiverTitle': 'Liability & Health Waiver',
  'register.waiverBody':
    'I confirm all participants are in good health and fit to participate in this physical outdoor activity. I release the organizers from any liability for personal injuries or accidents during the event.',
  'register.waiverAccept': 'I accept all terms and conditions',
  'register.start': 'Start the Race →',
  'register.errTeamName': 'Team name is required.',
  'register.errPhone': "Captain's phone number is required.",
  'register.errParticipants': 'Add at least one participant name.',
  'register.errWaiver': 'You must accept the waiver to continue.',
  'register.errSubmit': 'Registration failed — check your connection and try again.',

  // Dashboard
  'dash.team': 'Team',
  'dash.score': 'Score',
  'dash.pts': 'pts',
  'dash.slotsCompleted': '{n} of 8 slots completed',
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
  'slot.gate': 'Gate Filter',
  'slot.orange': 'Find the Tene',
  'slot.gold': 'Craft & Judge',

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
  'match.bypassed': 'No match — proceed to basket.',
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
  'register.addParticipant': '+ הוספת משתתף',
  'register.waiverTitle': 'הצהרת בריאות ואחריות',
  'register.waiverBody':
    'אני מאשר/ת שכל המשתתפים בריאים וכשירים להשתתף בפעילות גופנית חיצונית זו. אני משחרר/ת את המארגנים מכל אחריות לפציעות אישיות או תאונות במהלך האירוע.',
  'register.waiverAccept': 'אני מקבל/ת את כל התנאים וההגבלות',
  'register.start': 'התחלת המירוץ →',
  'register.errTeamName': 'שם הקבוצה הוא שדה חובה.',
  'register.errPhone': 'מספר הטלפון של הקפטן הוא שדה חובה.',
  'register.errParticipants': 'הוסיפו לפחות שם משתתף אחד.',
  'register.errWaiver': 'יש לאשר את ההצהרה כדי להמשיך.',
  'register.errSubmit': 'הרישום נכשל — בדקו את החיבור ונסו שוב.',

  // Dashboard
  'dash.team': 'קבוצה',
  'dash.score': 'ניקוד',
  'dash.pts': 'נק׳',
  'dash.slotsCompleted': '{n} מתוך 8 משבצות הושלמו',
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
  'slot.gate': 'מסנן השער',
  'slot.orange': 'מצאו את הטנא',
  'slot.gold': 'יצירה ושיפוט',

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
  'match.bypassed': 'אין זיווג — המשיכו לסל.',
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
