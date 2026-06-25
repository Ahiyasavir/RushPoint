// play-web i18n (change: play-web-i18n-hebrew). Hebrew-first participant app.
// HE is the source of truth; `EN: typeof HE` forces compile-time key parity so a
// missing key can never force an English fallback. A runtime parity + no-English
// guard lives in scripts/test-i18n-parity.ts. User-authored content (game title /
// description / task text) is NOT translated — render it with dir="auto".
//
// Namespaces are added per screen as screens are migrated to t.*. Keep HE free of
// Latin script except the brand/units whitelist (RushPoint, Pro, QR, SOS, ₪).

export type Lang = 'he' | 'en';

const HE = {
  dir: 'rtl' as 'rtl' | 'ltr',
  common: {
    appName: 'RushPoint',
    langToggle: 'English',
    loading: 'טוען…',
    close: 'סגירה',
  },
  join: {
    subtitle: 'הזינו את קוד הגישה מהמארגן כדי להצטרף למירוץ',
    codePlaceholder: 'הקוד שלכם',
    lookingUp: 'מחפש…',
    continue: 'המשך',
    staff: 'אני צוות',
    how1Label: 'הצטרפו', how1Sub: 'הזינו את הקוד',
    how2Label: 'תרוצו',  how2Sub: 'תנותבו למשימות',
    how3Label: 'תנצחו',  how3Sub: 'טפסו בטבלה',
    noAccountNeeded: 'לא צריך חשבון. רק הטלפון שלכם.',
    teamMembers: 'חברי הקבוצה',
    yourName: 'השם שלכם',
    memberPlaceholder: (n: number) => `חבר ${n}`,
    addMember: 'הוספת חבר',
    joining: 'מצטרף…',
    joinCta: '🏁 הצטרפו למירוץ',
    finished: 'המירוץ הזה כבר הסתיים.',
    invalidCode: 'קוד לא תקין',
    joinFailed: 'ההצטרפות נכשלה',
  },
  promo: {
    badge: 'הרפתקת RushPoint',
    notFound: 'ההרפתקה לא נמצאה',
    notPublic: 'המשחק הזה עדיין לא ציבורי. יש לכם קוד גישה?',
    enterCode: 'הזנת קוד',
    by: (name: string) => `מאת ${name}`,
    stages: 'שלבים',
    tasks: 'משימות',
    time: 'זמן',
    playingTitle: 'משתתפים באירוע הזה?',
    playingSub: 'המארגן ישתף קוד גישה כשהמירוץ יעלה לאוויר.',
    haveCode: 'יש לי קוד',
    buildOwn: '✨ רוצים להריץ אירוע משלכם? בנו מירוץ',
    noDescription: 'פרטים נוספים יגיעו מהמארגן.',
    reqGps: '📍 דרוש GPS, התנועעו בין הנקודות',
    reqAnywhere: '🌐 אפשר לשחק מכל מקום',
  },
};

const EN: typeof HE = {
  dir: 'ltr',
  common: {
    appName: 'RushPoint',
    langToggle: 'עברית',
    loading: 'Loading…',
    close: 'Close',
  },
  join: {
    subtitle: 'Enter the access code from your host to join the race',
    codePlaceholder: 'ABC 123',
    lookingUp: 'Looking up…',
    continue: 'Continue',
    staff: "I'm staff",
    how1Label: 'Join', how1Sub: 'Enter the code',
    how2Label: 'Race', how2Sub: 'Get routed to tasks',
    how3Label: 'Win',  how3Sub: 'Climb the board',
    noAccountNeeded: 'No account needed. Just your phone.',
    teamMembers: 'Team members',
    yourName: 'Your name',
    memberPlaceholder: (n: number) => `Member ${n}`,
    addMember: 'Add member',
    joining: 'Joining…',
    joinCta: '🏁 Join the race',
    finished: 'This race has already finished.',
    invalidCode: 'Invalid code',
    joinFailed: 'Join failed',
  },
  promo: {
    badge: 'RushPoint adventure',
    notFound: 'Adventure not found',
    notPublic: "This game isn't public yet. Got an access code?",
    enterCode: 'Enter a code',
    by: (name: string) => `by ${name}`,
    stages: 'Stages',
    tasks: 'Tasks',
    time: 'Time',
    playingTitle: 'Playing in this event?',
    playingSub: 'Your host will share an access code when the race goes live.',
    haveCode: 'I have a code',
    buildOwn: '✨ Want to run your own? Build a race',
    noDescription: 'More details coming from your host.',
    reqGps: '📍 GPS required, move between the spots',
    reqAnywhere: '🌐 Playable anywhere',
  },
};

export const translations: Record<Lang, typeof HE> = { he: HE, en: EN };
export type T = typeof HE;
