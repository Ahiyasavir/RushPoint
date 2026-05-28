import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// ── Supported languages ───────────────────────────────────────────────────────
export type Lang = 'en' | 'he';
const STORAGE_KEY = 'rushpoint.admin.lang';

// ── Translation dictionary ─────────────────────────────────────────────────────
// Every user-facing admin string. Keys are stable; values are per-language.
type Dict = Record<string, string>;

const en: Dict = {
  // App shell / nav
  'app.brandSuffix': 'Admin',
  'nav.liveMap': 'Live Map',
  'nav.teams': 'Teams',
  'nav.checkins': 'Check-ins',
  'nav.leaderboard': 'Leaderboard',
  'nav.judge': 'Judge',
  'lang.toggle': 'עברית',
  'lang.label': 'Language',

  // Common
  'common.refresh': 'Refresh',
  'common.loading': 'Loading…',
  'common.back': 'Back',

  // Heatmap
  'heatmap.title': 'Live Team Map',
  'heatmap.subtitle': 'Station positions across the Jerusalem course',
  'heatmap.placeholder': 'Mapbox integration — Phase 2',
  'heatmap.noToken': 'Add a Mapbox token (VITE_MAPBOX_TOKEN) to apps/admin/.env to enable the live map.',
  'heatmap.legendGreen': 'Open-field',
  'heatmap.legendOrange': 'Bible Park',
  'heatmap.legendGold': 'Basket craft',

  // Teams
  'teams.title': 'Teams',
  'teams.count': '{n} teams registered',
  'teams.updated': 'updated {time}',
  'teams.refreshing': 'Refreshing…',
  'teams.colTeam': 'Team',
  'teams.colCode': 'Code',
  'teams.colStatus': 'Status',
  'teams.colSlots': 'Slots',
  'teams.colScore': 'Score',
  'teams.loadingRow': 'Loading teams…',
  'teams.empty': 'No teams registered yet.',
  'teams.loadError': 'Failed to load teams',
  'teams.colAction': 'Action',
  'teams.skip': 'Skip task',
  'teams.confirmSkip': 'Confirm skip?',
  'teams.skipping': 'Skipping…',
  'teams.skipError': 'Could not skip the task.',
  'teams.skipDone': 'Skipped — team advanced (+{score} pts, task average).',
  'status.registered': 'registered',
  'status.active': 'active',
  'status.park': 'park',
  'status.finished': 'finished',

  // Leaderboard
  'leaderboard.title': 'Leaderboard',
  'leaderboard.frozenNote': 'Frozen — rankings hidden until ceremony',
  'leaderboard.live': 'Live rankings',
  'leaderboard.unfreeze': 'Unfreeze',
  'leaderboard.freeze': 'Freeze Board',
  'leaderboard.frozenBody': 'Leaderboard is frozen. Unfreeze to reveal.',
  'leaderboard.noFinishers': 'No finishers yet — results will appear after Finalize.',
  'leaderboard.finalize': 'Finalize & Compute',
  'leaderboard.finalizing': 'Computing…',
  'leaderboard.finalizeError': 'Could not finalize. Try again.',
  'leaderboard.finalizedAt': 'Finalized at {time}',
  'leaderboard.reveal': 'Start Reveal ▶',
  'leaderboard.revealNext': 'Next ▶',
  'leaderboard.revealDone': 'Reveal Complete 🏆',
  'leaderboard.colRank': '#',
  'leaderboard.colTeam': 'Team',
  'leaderboard.colScore': 'Score',
  'leaderboard.colRaw': 'Raw',
  'leaderboard.colDuration': 'Duration',
  'leaderboard.colSlots': 'Slots',
  'leaderboard.revealPos': 'Position #{rank}',
  'leaderboard.minsLabel': '{m} min',
  'nav.matchmaking': 'Matchmaking',
  // Matchmaking
  'match.title': 'Matchmaking',
  'match.subtitle': 'Live gate match queue. Resolve 1v1 duels here.',
  'match.queueTitle': 'Match Queue',
  'match.activeTitle': 'Active Matches',
  'match.empty': 'No teams in the queue.',
  'match.noMatches': 'No active matches.',
  'match.waiting': 'Waiting',
  'match.matched': 'Matched',
  'match.score': 'Score: {score}',
  'match.waited': 'Waited {min}m',
  'match.vs': 'vs',
  'match.winA': '{name} wins',
  'match.winB': '{name} wins',
  'match.resolving': 'Saving…',
  'match.resolveError': 'Could not save result.',
  'match.resolved': 'Match resolved — {winner} won (+{bonus} pts).',
  'match.bonusPts': '+{bonus} pts to winner',

  // Check-ins
  'checkins.title': 'Check-in Review',
  'checkins.subtitle': 'Teams waiting to be graded. Use the Judge tab to score them.',
  'checkins.loadError': 'Could not load pending check-ins. Is the emulator running?',
  'checkins.empty': 'No pending check-ins',
  'checkins.checkedIn': 'Checked in',
  'checkins.waiting': 'Waiting',

  // Judge
  'judge.title': 'Judge Station',
  'judge.subtitle': 'Check teams in on arrival, then grade their Tene basket.',
  'judge.loadError': 'Could not load pending teams. Is the emulator running?',
  'judge.checkInError': 'Check-in failed. Try again.',
  'judge.finalizeError': 'Could not finalize the score. Try again.',
  'judge.loadingTeams': 'Loading pending teams…',
  'judge.noTeams': 'No teams waiting. They’ll appear here when they check in at your station.',
  'judge.checkingIn': 'Checking in…',
  'judge.approve': 'Approve Arrival / Check-In',
  'judge.checkedInBanner': '{team} checked in',
  'judge.clockFrozen': 'Their race clock is frozen while you grade.',
  'judge.sectionChecklist': 'A. Tene Checklist',
  'judge.sectionChecklistHint': 'Tick everything the team actually brought.',
  'judge.productScore': 'Product score:',
  'judge.sectionDesign': 'B. Visual Design & Aesthetics',
  'judge.sectionDesignHint': 'Decorations and effort (0–{max}).',
  'judge.sectionPresentation': 'C. Team Presentation & Synergy',
  'judge.sectionPresentationHint': 'Cohesion and delivery (0–{max}).',
  'judge.note': 'Judge Note',
  'judge.noteHint': 'Optional — recorded with the score.',
  'judge.notePlaceholder': 'e.g. Beautiful olive arrangement, great teamwork.',
  'judge.labelProducts': 'Products',
  'judge.labelDesign': 'Design',
  'judge.labelPresentation': 'Presentation',
  'judge.totalCalculated': 'Total Calculated Score',
  'judge.releasing': 'Releasing…',
  'judge.finalize': 'Finalize & Release Team',
  'judge.releasedComplete': '{team} released — race complete! 🏁',
  'judge.released': '{team} released',
  'judge.clockResumed': 'Their clock has resumed for the next mission.',
  'judge.rowTaskCompletion': 'Task completion',
  'judge.rowProductScore': 'Product score',
  'judge.rowVisualDesign': 'Visual design',
  'judge.rowPresentation': 'Team presentation',
  'judge.rowBasketTotal': 'Basket total',
  'judge.rowNewScore': 'New team score',
  'judge.judgeAnother': 'Judge another team',
};

const he: Dict = {
  // App shell / nav
  'app.brandSuffix': 'ניהול',
  'nav.liveMap': 'מפה חיה',
  'nav.teams': 'קבוצות',
  'nav.checkins': 'צ׳ק-אין',
  'nav.leaderboard': 'טבלת מובילים',
  'nav.judge': 'שיפוט',
  'lang.toggle': 'English',
  'lang.label': 'שפה',

  // Common
  'common.refresh': 'רענון',
  'common.loading': 'טוען…',
  'common.back': 'חזרה',

  // Heatmap
  'heatmap.title': 'מפת קבוצות חיה',
  'heatmap.subtitle': 'מיקומי העמדות לאורך מסלול ירושלים',
  'heatmap.placeholder': 'אינטגרציית Mapbox — שלב 2',
  'heatmap.noToken': 'הוסיפו טוקן Mapbox‏ (VITE_MAPBOX_TOKEN) לקובץ apps/admin/.env כדי להפעיל את המפה החיה.',
  'heatmap.legendGreen': 'שטח פתוח',
  'heatmap.legendOrange': 'פארק התנ"ך',
  'heatmap.legendGold': 'מלאכת סל',

  // Teams
  'teams.title': 'קבוצות',
  'teams.count': '{n} קבוצות רשומות',
  'teams.updated': 'עודכן {time}',
  'teams.refreshing': 'מרענן…',
  'teams.colTeam': 'קבוצה',
  'teams.colCode': 'קוד',
  'teams.colStatus': 'סטטוס',
  'teams.colSlots': 'משבצות',
  'teams.colScore': 'ניקוד',
  'teams.loadingRow': 'טוען קבוצות…',
  'teams.empty': 'עדיין אין קבוצות רשומות.',
  'teams.loadError': 'טעינת הקבוצות נכשלה',
  'teams.colAction': 'פעולה',
  'teams.skip': 'דלג משימה',
  'teams.confirmSkip': 'לאשר דילוג?',
  'teams.skipping': 'מדלג…',
  'teams.skipError': 'לא ניתן לדלג על המשימה.',
  'teams.skipDone': 'דולג — הקבוצה התקדמה (+{score} נק׳, ממוצע המשימה).',
  'status.registered': 'רשומה',
  'status.active': 'פעילה',
  'status.park': 'בפארק',
  'status.finished': 'סיימה',

  // Leaderboard
  'leaderboard.title': 'טבלת מובילים',
  'leaderboard.frozenNote': 'מוקפאת — הדירוג מוסתר עד הטקס',
  'leaderboard.live': 'דירוג חי',
  'leaderboard.unfreeze': 'בטל הקפאה',
  'leaderboard.freeze': 'הקפא טבלה',
  'leaderboard.frozenBody': 'טבלת המובילים מוקפאת. בטלו הקפאה כדי לחשוף.',
  'leaderboard.noFinishers': 'אין סיימות עדיין — תוצאות יופיעו אחרי סיום.',
  'leaderboard.finalize': 'סיום וחישוב',
  'leaderboard.finalizing': 'מחשב…',
  'leaderboard.finalizeError': 'הסיום נכשל. נסו שוב.',
  'leaderboard.finalizedAt': 'הסתיים ב-{time}',
  'leaderboard.reveal': 'התחל חשיפה ▶',
  'leaderboard.revealNext': 'הבא ▶',
  'leaderboard.revealDone': 'החשיפה הסתיימה 🏆',
  'leaderboard.colRank': '#',
  'leaderboard.colTeam': 'קבוצה',
  'leaderboard.colScore': 'ניקוד',
  'leaderboard.colRaw': 'גולמי',
  'leaderboard.colDuration': 'משך',
  'leaderboard.colSlots': 'משבצות',
  'leaderboard.revealPos': 'מקום #{rank}',
  'leaderboard.minsLabel': '{m} דק׳',
  'nav.matchmaking': 'זיווג',
  // Matchmaking
  'match.title': 'זיווג',
  'match.subtitle': 'תור הזיווג בשער. פתרו כאן את הדו-קרב.',
  'match.queueTitle': 'תור הזיווג',
  'match.activeTitle': 'זיווגים פעילים',
  'match.empty': 'אין קבוצות בתור.',
  'match.noMatches': 'אין זיווגים פעילים.',
  'match.waiting': 'ממתינה',
  'match.matched': 'מזווגת',
  'match.score': 'ניקוד: {score}',
  'match.waited': 'המתינה {min} דק׳',
  'match.vs': 'נגד',
  'match.winA': '{name} מנצח/ת',
  'match.winB': '{name} מנצח/ת',
  'match.resolving': 'שומר…',
  'match.resolveError': 'לא ניתן לשמור תוצאה.',
  'match.resolved': 'הזיווג נפתר — {winner} ניצח/ה (+{bonus} נק׳).',
  'match.bonusPts': '+{bonus} נק׳ למנצח',

  // Check-ins
  'checkins.title': 'בדיקת צ׳ק-אין',
  'checkins.subtitle': 'קבוצות הממתינות לשיפוט. השתמשו בלשונית השיפוט כדי לדרג אותן.',
  'checkins.loadError': 'לא ניתן לטעון צ׳ק-אין ממתינים. האם האמולטור פועל?',
  'checkins.empty': 'אין צ׳ק-אין ממתינים',
  'checkins.checkedIn': 'נרשמה הגעה',
  'checkins.waiting': 'ממתינה',

  // Judge
  'judge.title': 'עמדת שיפוט',
  'judge.subtitle': 'רשמו הגעת קבוצות, ואז דרגו את סל הטנא שלהן.',
  'judge.loadError': 'לא ניתן לטעון קבוצות ממתינות. האם האמולטור פועל?',
  'judge.checkInError': 'רישום ההגעה נכשל. נסו שוב.',
  'judge.finalizeError': 'לא ניתן לסיים את הניקוד. נסו שוב.',
  'judge.loadingTeams': 'טוען קבוצות ממתינות…',
  'judge.noTeams': 'אין קבוצות ממתינות. הן יופיעו כאן כשירשמו הגעה בעמדה שלכם.',
  'judge.checkingIn': 'רושם הגעה…',
  'judge.approve': 'אישור הגעה / צ׳ק-אין',
  'judge.checkedInBanner': '{team} נרשמה',
  'judge.clockFrozen': 'שעון המירוץ שלהם מוקפא בזמן השיפוט.',
  'judge.sectionChecklist': 'א. רשימת הטנא',
  'judge.sectionChecklistHint': 'סמנו כל מה שהקבוצה הביאה בפועל.',
  'judge.productScore': 'ניקוד מוצרים:',
  'judge.sectionDesign': 'ב. עיצוב חזותי ואסתטיקה',
  'judge.sectionDesignHint': 'קישוטים ומאמץ (0–{max}).',
  'judge.sectionPresentation': 'ג. הצגת הקבוצה ועבודת צוות',
  'judge.sectionPresentationHint': 'לכידות והגשה (0–{max}).',
  'judge.note': 'הערת שופט',
  'judge.noteHint': 'אופציונלי — נשמר עם הניקוד.',
  'judge.notePlaceholder': 'לדוגמה: סידור זיתים יפהפה, עבודת צוות מצוינת.',
  'judge.labelProducts': 'מוצרים',
  'judge.labelDesign': 'עיצוב',
  'judge.labelPresentation': 'הצגה',
  'judge.totalCalculated': 'ניקוד כולל מחושב',
  'judge.releasing': 'משחרר…',
  'judge.finalize': 'סיום ושחרור הקבוצה',
  'judge.releasedComplete': '{team} שוחררה — המירוץ הושלם! 🏁',
  'judge.released': '{team} שוחררה',
  'judge.clockResumed': 'השעון שלהם התחדש למשימה הבאה.',
  'judge.rowTaskCompletion': 'השלמת משימה',
  'judge.rowProductScore': 'ניקוד מוצרים',
  'judge.rowVisualDesign': 'עיצוב חזותי',
  'judge.rowPresentation': 'הצגת קבוצה',
  'judge.rowBasketTotal': 'סך הכל סל',
  'judge.rowNewScore': 'ניקוד קבוצה חדש',
  'judge.judgeAnother': 'שפוט קבוצה נוספת',
};

const DICTS: Record<Lang, Dict> = { en, he };

// ── Context ────────────────────────────────────────────────────────────────────
interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  /** Translate a key, with optional {placeholder} interpolation. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  isRtl: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

function readInitialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === 'he' || saved === 'en' ? saved : 'en';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  // Reflect language + direction on the document so global RTL styling applies.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'he' ? 'rtl' : 'ltr';
    window.localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const toggle = useCallback(() => setLangState((p) => (p === 'en' ? 'he' : 'en')), []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let str = DICTS[lang][key] ?? DICTS.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return str;
    },
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, toggle, t, isRtl: lang === 'he' }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within <LanguageProvider>');
  return ctx;
}
