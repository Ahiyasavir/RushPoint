// ─────────────────────────────────────────────────────────────────────────────
// The static SEO landing pages: the registry, and every value derived from it.
//
// WHY THESE PAGES ARE FILES AND NOT ROUTES
//
// Firebase Hosting resolves STATIC CONTENT before it reaches the rewrite table, so a
// real file under an app's `public/` wins over `"source": "**" -> /index.html`. That is
// not a guess: it is the same mechanism that fixed `/robots.txt` and `/favicon.ico`,
// both of which used to answer with the SPA's HTML (see the comments in
// apps/play-web/index.html). A directory path resolves to its own `index.html` as part
// of that same static pass, which is why `/he/bar-mitzva/` works with ZERO change to
// firebase.json.
//
// The consequence worth stating plainly: these pages need no server-side rendering, no
// static site generator, and no build wiring. The general advice for making an SPA
// indexable does not apply to a page that was never part of the SPA.
//
// WHY THE OUTPUT IS GENERATED AND COMMITTED
//
// Twelve documents, each carrying a title, a description, a canonical, three alternates,
// six Open Graph tags, three Twitter tags and a JSON-LD block, is roughly two hundred
// interdependent values. Hand-maintained, the second edit desynchronises something and
// nothing complains. Generated, the relationships are COMPUTED: `alternatesFor` derives a
// page's counterpart by swapping the language prefix, so the hreflang cluster is
// symmetric because it cannot be anything else.
//
// The files are committed rather than built, because generating during the build would
// mean the gate build and the playtest build both write them, which is the exact shared
// write that caused the dist/dist-playtest incident. The cost of committing is drift, and
// scripts/test-landing-pages.ts closes it: the committed bytes must equal what this
// module produces now, or `npm test` fails naming the stale file.
//
// Pure. No filesystem, no network. scripts/build-landing-pages.ts is the only writer.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The origin these pages are served from.
 *
 * The participant host, because that is where the files physically live: they are
 * real files under `apps/play-web/public/`, and play-web moved off the apex when the
 * marketing site took it (change: marketing-to-apex). Its robots.txt answers
 * `Allow: /`, whereas the console's crawl rules deliberately allow only `/$`,
 * `/privacy` and `/terms` because everything else there is behind authentication.
 *
 * The old apex URLs are 301'd here from the marketing site (`firebase.json`), so
 * nothing already indexed dies. Moving these pages INTO the marketing app was the
 * obvious alternative and does not work: their index is `/he/`, which is the
 * marketing home's own path, so the two would collide.
 */
export const LANDING_ORIGIN = 'https://player.rush-point.com';

/** Where the call to action sends a creator: the console's logged out landing page. */
export const CREATOR_ORIGIN = 'https://creator.rush-point.com';

/**
 * The marketing site (change: marketing-site).
 *
 * Linking to it is not decoration. Without a link in each direction these two
 * page sets are islands: each internally connected, neither reachable from the
 * other, and neither passing any signal to the other. The destination is always
 * in the SAME language as the page carrying the link, so a Hebrew reader is not
 * handed an English page.
 */
export const MARKETING_ORIGIN = 'https://rush-point.com';

const MARKETING_LABEL: Record<LandingLanguage, string> = {
  he: 'על RushPoint',
  en: 'About RushPoint',
};

/**
 * The directory the generated pages are written into, relative to the repo root.
 *
 * `public/` is copied verbatim into the build output by Vite, so this needs no build
 * wiring and is identical under `dist` and `dist-playtest`. It is deliberately NOT `src/`:
 * nothing here is part of the module graph, and nothing imports it.
 */
export const LANDING_PUBLIC_DIR = 'apps/play-web/public';

/**
 * The two languages, Hebrew first.
 *
 * Hebrew is the primary commercial surface, not a mirror of the English one: the
 * overwhelming majority of searches in this market are Hebrew, and the Hebrew copy below
 * is authored, not translated. A page translated from English reads like a translation,
 * and a creator searching for a bar mitzvah activity can tell.
 */
export const LANDING_LANGUAGES = ['he', 'en'] as const;
export type LandingLanguage = typeof LANDING_LANGUAGES[number];

/**
 * The subjects.
 *
 * Five of them are `OccasionId` values from apps/creator-web/src/lib/occasions.ts, which
 * is the list the game composer is actually tuned for. That is the whole reason these are
 * the pages: each one describes something the product genuinely does, so the copy can be
 * specific without being invented. `home` is the sixth, the general marketing page.
 *
 * `other` from that file is deliberately absent. It is the neutral "we were not told what
 * this event is" answer, which biases nothing and shapes nothing, and there is no search
 * intent behind it.
 */
export const LANDING_SUBJECTS = [
  'home',
  'birthday',
  'mitzvah',
  'wedding',
  'team-building',
  'youth-group',
] as const;
export type LandingSubject = typeof LANDING_SUBJECTS[number];

/** The subject that serves at the language root (`/he/`, `/en/`) rather than a slug. */
export const HOME_SUBJECT: LandingSubject = 'home';

/** One block of body copy: a heading and its paragraphs. */
export interface LandingSection {
  heading: string;
  paragraphs: readonly string[];
}

export interface LandingPage {
  subject: LandingSubject;
  language: LandingLanguage;
  /** Shared by both languages of a subject, which is what makes pairing structural. */
  slug: string;
  /** The `<title>`. Unique across every page. */
  title: string;
  /** The `<meta name="description">`. Unique across every page. */
  description: string;
  /** The visible `<h1>`. */
  headline: string;
  /** The sentence under the headline. */
  intro: string;
  sections: readonly LandingSection[];
  /** The call to action label. Its href is always the creator console. */
  ctaLabel: string;
}

/**
 * Slug per subject. Latin in both languages, deliberately.
 *
 * Percent-encoded Hebrew in a path is fragile: Hebrew has two valid Unicode encodings
 * (composed and decomposed), and a mismatch between them matches nothing, silently.
 * Latin slugs remove the class. Hyphens here are fine: the no-dash copy standard governs
 * PROSE, and explicitly exempts file paths and URLs.
 *
 * `home` maps to the empty slug: it serves at the language root.
 */
export const SUBJECT_SLUGS: Record<LandingSubject, string> = {
  home: '',
  birthday: 'yom-huledet',
  mitzvah: 'bar-mitzva',
  wedding: 'hatuna',
  'team-building': 'gibush-tzevet',
  'youth-group': 'tnuat-noar',
};

// ── THE COPY ─────────────────────────────────────────────────────────────────
//
// NO HYPHEN OR DASH may appear in any string below. This is the product's UI text
// standard (change: ui-no-dashes), and landing page copy is the copy with the widest
// reach of all: like a <title>, it is text Google prints directly. PART D of
// scripts/test-no-dashes.ts scans this registry, so a dash here fails `npm test`.
//
// Hebrew copy is written in Hebrew, English copy in English, and
// scripts/test-landing-pages.ts checks both directions with the SHARED leak predicate
// from scripts/lib/i18nLeak.ts. "RushPoint" is on that predicate's Latin whitelist, so
// the brand name may stay Latin inside Hebrew copy.

const HE: Record<LandingSubject, Omit<LandingPage, 'subject' | 'language' | 'slug'>> = {
  home: {
    title: 'בונים משחק שדה אמיתי לכל אירוע, RushPoint',
    description: 'פלטפורמה לבניית משחקי שדה בשטח: מסלול משימות אמיתי, ניווט אוטומטי בין תחנות, ניקוד בזמן אמת וטבלת מובילים חיה. בלי אפליקציה להתקין ובלי שופטים.',
    headline: 'המשחק יוצא החוצה',
    intro: 'בונים משחק שדה משלכם, משתפים קוד כניסה אחד, והשחקנים יוצאים לשטח. הניקוד קורה לבד.',
    sections: [
      {
        heading: 'איך זה עובד',
        paragraphs: [
          'אתם מגדירים תחנות על המפה ומשימה בכל תחנה. צילום, חידה, קוד סודי, שאלה פתוחה או הגעה פיזית למקום. כל משימה יודעת לבדוק את עצמה.',
          'כשהמשחק מתחיל, כל קבוצה מקבלת לטלפון את המשימה הבאה שמתאימה לה: לפי המרחק שלה, לפי מה שכבר תפוס, ולפי הקצב שהיא מפגינה. אין תור לתחנה ואין קבוצות שנתקעות באותו מקום.',
        ],
      },
      {
        heading: 'בלי שופטים ובלי דפים',
        paragraphs: [
          'הניקוד אוטומטי. תשובה נכונה נבדקת מול השרת, הגעה לנקודה נבדקת מול המיקום האמיתי של הטלפון, וזמן המסלול נמדד לבד. אתם רואים טבלת מובילים שמתעדכנת תוך כדי, ולא סופרים פתקים בסוף.',
          'השחקנים לא מתקינים כלום. פותחים קישור, מקלידים קוד, ומתחילים לשחק.',
        ],
      },
      {
        heading: 'לכל סוג אירוע',
        paragraphs: [
          'יום הולדת, בר מצווה, חתונה, גיבוש צוות או פעולה בתנועת נוער. לכל אירוע יש קצב אחר, קהל אחר וכמות זמן אחרת, והמערכת בונה מסלול שמתאים לו.',
        ],
      },
    ],
    ctaLabel: 'בונים משחק עכשיו',
  },
  birthday: {
    title: 'משחק שדה ליום הולדת עם מסלול משימות בשכונה',
    description: 'יום הולדת שיוצא מהסלון. מסלול משימות אמיתי בשכונה או בפארק, עם צילומים, אתגרים וניקוד אוטומטי. מתאים לילדים ולנוער, ומוכן תוך דקות.',
    headline: 'יום הולדת שיוצא מהסלון',
    intro: 'מסלול משימות בשכונה, בפארק או בכל מקום שאתם מכירים. קצר, רועש, ומלא תמונות.',
    sections: [
      {
        heading: 'למה זה עובד ליום הולדת',
        paragraphs: [
          'ילדים משתעממים מהר, אז המשחק בנוי קצר ומתחיל בשיא האנרגיה כשכולם עדיין ביחד. העקומה עולה בעדינות: יום הולדת שנעשה קשה באמת מפסיק להיות מסיבה.',
          'רוב המשימות הן צילום ויצירה, כי אלה המשימות שכל ילד יכול לעשות בקצב שלו, והן גם מה שנשאר להורים בסוף הערב.',
        ],
      },
      {
        heading: 'מה צריך להכין',
        paragraphs: [
          'טלפון אחד לכל קבוצה, וקוד כניסה שאתם שולחים בקבוצת ההורים. זהו.',
          'אם אין לכם זמן לבנות מסלול לבד, אפשר לבקש מהמערכת להרכיב אחד לפי האזור שלכם, גיל החוגגים וכמה זמן יש לכם. המסלול שיוצא מוכן לשיגור.',
        ],
      },
    ],
    ctaLabel: 'בונים משחק ליום הולדת',
  },
  mitzvah: {
    title: 'משחק שדה לבר מצווה ובת מצווה',
    description: 'פעילות לבר מצווה שמחזיקה קהל שנע מסבתא ועד חברים מהכיתה. מסלול משימות בשטח, ניקוד אוטומטי וסיום שמוביל לטקס. בלי מדריכים ובלי ציוד.',
    headline: 'פעילות לבר מצווה שכולם יכולים לשחק',
    intro: 'קהל שנע מסבתא ועד חברים מהכיתה, ומשחק אחד שמחזיק את שניהם.',
    sections: [
      {
        heading: 'האתגר של הקהל המעורב',
        paragraphs: [
          'בבר מצווה יש בדרך כלל שלושה דורות באותו אירוע, וזה בדיוק מה שמפיל פעילויות. משימות שדורשות ריצה מוציאות חצי מהקהל, ומשימות שדורשות ידע מוציאות את החצי השני.',
          'לכן המסלול נשען על עבודת צוות ועל צילום. שתיהן משימות שאפשר לעשות בכל גיל ובכל קצב, והן מכריחות את הקבוצות להתערבב במקום להתפצל לפי גיל.',
        ],
      },
      {
        heading: 'סיום שמוביל לאירוע עצמו',
        paragraphs: [
          'המסלול בנוי בארבעה שלבים עם פינאלה אמיתי, כי יש טקס להוביל אליו. השלב האחרון הוא הקשה ביותר והוא נגמר בנקודה שאתם בוחרים, כך שהמשחק מסתיים בדיוק היכן שהאירוע ממשיך.',
          'בסוף כל קבוצה מקבלת את התמונות שלה ואת הדירוג, ואתם מקבלים דוח מלא של מי ענה מה.',
        ],
      },
    ],
    ctaLabel: 'בונים משחק לבר מצווה',
  },
  wedding: {
    title: 'משחק לחתונה שמעסיק את האורחים בין החלקים',
    description: 'פעילות לאורחי החתונה שלא דורשת ללכת רחוק ולא הורסת את הנעליים. משימות צילום קצרות בשטח האירוע, ניקוד אוטומטי ואלבום שנבנה מעצמו.',
    headline: 'פעילות לחתונה שלא הורסת נעליים',
    intro: 'האורחים לבושים ולא הולכים רחוק. המשחק הוא הבידור בין החלקים של הערב, לא הערב עצמו.',
    sections: [
      {
        heading: 'קרוב, קצר וקל',
        paragraphs: [
          'המסלול בנוי משלושה שלבים בלבד, וכל שלב מחזיק הרבה משימות קטנות באותו אזור. אף אחד לא נשלח לצד השני של המתחם, ואף אחד לא צריך להחליף נעליים.',
          'רמת הקושי היא הנמוכה ביותר מבין סוגי האירועים. אורח שמצטרף באמצע יכול להיכנס לקבוצה ולהתחיל לשחק בלי הסבר.',
        ],
      },
      {
        heading: 'האלבום נבנה תוך כדי',
        paragraphs: [
          'רוב המשימות הן צילום, והתמונות נכנסות לפיד חי שאפשר להקרין. בסוף הערב יש לכם אוסף תמונות מזוויות שאף צלם לא היה תופס, כי הן צולמו על ידי האורחים עצמם.',
        ],
      },
    ],
    ctaLabel: 'בונים משחק לחתונה',
  },
  'team-building': {
    title: 'משחק שדה לגיבוש צוות בחברות ובארגונים',
    description: 'יום גיבוש שבו הקושי הוא הנקודה. מסלול בן חמישה שלבים עם טוויסט באמצע, משימות שדורשות שיתוף פעולה אמיתי, וניקוד אובייקטיבי בלי שופטים.',
    headline: 'גיבוש שבו הקושי הוא הנקודה',
    intro: 'הקבוצה נמצאת שם כדי להיאלץ לשתף פעולה תחת לחץ. המסלול בנוי בשביל זה.',
    sections: [
      {
        heading: 'חמישה שלבים עם טוויסט באמצע',
        paragraphs: [
          'זה סוג האירוע היחיד שבו רמת הקושי עולה באמת. השלב השלישי הוא הכבד ביותר, בדיוק כשהצוותים כבר בטוחים שהבינו את המשחק, וזה השלב שמייצר את השיחות שנשארות אחרי.',
          'המשימות נשענות על עבודת צוות וחשיבה. אי אפשר לפתור אותן לבד, ואי אפשר לפתור אותן בלי שמישהו בקבוצה יוותר על להיות זה שמחליט.',
        ],
      },
      {
        heading: 'ניקוד אובייקטיבי',
        paragraphs: [
          'אין שופטים, אז אין ויכוחים. תשובה נבדקת מול השרת, הגעה לנקודה נבדקת מול המיקום האמיתי, וזמן נמדד אוטומטית. טבלת המובילים היא עובדה, לא החלטה.',
          'בסוף אתם מקבלים דוח מלא לכל צוות: מה ענו, כמה זמן לקח, ואיפה נתקעו. אפשר לייצא אותו לגיליון.',
        ],
      },
    ],
    ctaLabel: 'בונים יום גיבוש',
  },
  'youth-group': {
    title: 'פעולה בתנועת נוער כמשחק שדה לחניכים',
    description: 'פעולה שבועית שמדריך יכול להכין בזמן שיש לו. מסלול משימות בשכונה עם תוכן חינוכי, סיום מאתגר וניקוד אוטומטי. בלי ציוד ובלי הכנה בשטח.',
    headline: 'פעולה שאפשר להכין בערב',
    intro: 'משהו לעשות, משהו ללמוד, וסיום שמדברים עליו בפעולה הבאה.',
    sections: [
      {
        heading: 'בנוי לקצב של מדריך',
        paragraphs: [
          'למדריך אין ערב שלם להכין פעולה, ואין לו ציוד. המסלול נבנה מהמחשב, נשלח כקוד אחד, ורץ על הטלפונים של החניכים.',
          'ארבעה שלבים: פתיחה שמזיזה את כולם, שלב תוכן שבו נמצא החומר החינוכי, ואז סיום קשה. החניכים מגיעים לשיא בסוף, לא בהתחלה.',
        ],
      },
      {
        heading: 'תוכן שהוא חלק מהמשחק',
        paragraphs: [
          'משימה חינוכית שמרגישה כמו שיעור מפסיקה לעבוד ברגע שהיא מזוהה. לכן התוכן יושב בתוך חידה, בתוך קוד סודי או בתוך נקודה בשטח שצריך למצוא, והחניך פוגש אותו כשהוא כבר בתוך המשחק.',
          'אפשר להסתיר משימה לגמרי: החניכים מקבלים אזור חיפוש על המפה במקום סימון מדויק, וצריכים למצוא את הנקודה בעצמם.',
        ],
      },
    ],
    ctaLabel: 'בונים פעולה',
  },
};

const EN: Record<LandingSubject, Omit<LandingPage, 'subject' | 'language' | 'slug'>> = {
  home: {
    title: 'Build a real world field game for any event, RushPoint',
    description: 'Build your own outdoor team game: real missions on a map, automatic routing between stops, live scoring and a leaderboard that updates itself. No app to install and no judges.',
    headline: 'The game goes outside',
    intro: 'Build a field game, share one access code, and send players into the street. The scoring takes care of itself.',
    sections: [
      {
        heading: 'How it works',
        paragraphs: [
          'You place stops on a map and give each one a mission: a photo, a riddle, a secret code, a written answer, or simply arriving at the spot. Every mission knows how to check itself.',
          'Once the game starts, each team gets the next mission that suits it: how far away it is, what is already occupied, and how fast that team has been moving. No queue at a stop, and no two teams stuck in the same place.',
        ],
      },
      {
        heading: 'No judges, no paper',
        paragraphs: [
          'Scoring is automatic. An answer is checked against the server, an arrival is checked against the phone’s real location, and route time is measured on its own. You watch a leaderboard update while the game runs instead of counting slips afterwards.',
          'Players install nothing. They open a link, type a code, and start playing.',
        ],
      },
      {
        heading: 'Built for the occasion',
        paragraphs: [
          'A birthday, a bar mitzvah, a wedding, a team building day or a youth movement session. Each one has a different pace, a different crowd and a different amount of time, and the route is shaped to match.',
        ],
      },
    ],
    ctaLabel: 'Start building',
  },
  birthday: {
    title: 'Birthday scavenger hunt on a real mission route nearby',
    description: 'A birthday party that leaves the living room. A real mission route around your neighbourhood or park, with photo challenges and automatic scoring. Built for kids and teens, ready in minutes.',
    headline: 'A birthday that leaves the living room',
    intro: 'A mission route through your neighbourhood, a park, or anywhere you already know. Short, loud, and full of photos.',
    sections: [
      {
        heading: 'Why it works for a birthday',
        paragraphs: [
          'Kids lose interest fast, so the route is short and front loaded, hitting its peak while everyone is still together. The difficulty curve stays gentle on purpose: a birthday that gets genuinely hard stops being a party.',
          'Most missions are photo and creative ones, because those are the missions any child can do at their own pace, and they are also what the parents still have at the end of the evening.',
        ],
      },
      {
        heading: 'What you need to prepare',
        paragraphs: [
          'One phone per team, and an access code you send to the parents. That is the whole setup.',
          'If you have no time to design a route yourself, you can ask the system to compose one from your area, the age of the group, and how long you have. What comes out is ready to launch.',
        ],
      },
    ],
    ctaLabel: 'Build a birthday game',
  },
  mitzvah: {
    title: 'Bar mitzvah field game the whole crowd can play',
    description: 'A bar mitzvah activity that holds a crowd running from grandparents to classmates. An outdoor mission route, automatic scoring, and a finish that leads into the ceremony. No staff and no equipment.',
    headline: 'A bar mitzvah activity everyone can play',
    intro: 'A crowd that runs from grandparents to classmates, and one game that holds both.',
    sections: [
      {
        heading: 'The mixed crowd problem',
        paragraphs: [
          'A bar mitzvah usually puts three generations in one room, and that is exactly what breaks most activities. Missions that need running lose half the crowd, and missions that need knowledge lose the other half.',
          'So the route leans on teamwork and photography. Both are playable at any age and any pace, and both push the teams to mix instead of splitting along age lines.',
        ],
      },
      {
        heading: 'A finish that leads into the event',
        paragraphs: [
          'The route runs four stages with a real finale, because there is a ceremony to build toward. The last stage is the hardest and it ends at a point you choose, so the game finishes exactly where the event carries on.',
          'Afterwards every team gets its photos and its ranking, and you get a full report of who answered what.',
        ],
      },
    ],
    ctaLabel: 'Build a bar mitzvah game',
  },
  wedding: {
    title: 'Wedding game that keeps guests busy between the parts',
    description: 'A wedding activity that asks nobody to walk far or ruin their shoes. Short photo missions around the venue, automatic scoring, and an album that builds itself from the guests.',
    headline: 'A wedding activity that spares the shoes',
    intro: 'Guests are dressed up and are not walking far. The game is the entertainment between the parts of the evening, not the evening itself.',
    sections: [
      {
        heading: 'Close, short and easy',
        paragraphs: [
          'The route runs just three stages, and each stage holds many small missions in the same area. Nobody is sent to the far side of the venue, and nobody needs to change shoes.',
          'The difficulty is the lowest of any occasion. A guest who joins halfway through can drop into a team and start playing with no explanation.',
        ],
      },
      {
        heading: 'The album builds as you go',
        paragraphs: [
          'Most missions are photo missions, and the pictures land in a live feed you can put on a screen. By the end of the night you have shots from angles no photographer would have caught, because the guests took them.',
        ],
      },
    ],
    ctaLabel: 'Build a wedding game',
  },
  'team-building': {
    title: 'Team building field game for companies and groups',
    description: 'A team building day where the difficulty is the point. Five stages with a twist in the middle, missions that need genuine cooperation, and objective scoring with no judges to argue with.',
    headline: 'Team building where the difficulty is the point',
    intro: 'The group is there to be made to cooperate under pressure. The route is built for that.',
    sections: [
      {
        heading: 'Five stages with a twist in the middle',
        paragraphs: [
          'This is the one occasion where difficulty genuinely climbs. The third stage is the heaviest, arriving right when the teams are sure they have the game figured out, and it is the stage that produces the conversations people have afterwards.',
          'Missions lean on teamwork and thinking. They cannot be solved alone, and they cannot be solved until somebody on the team gives up being the one who decides.',
        ],
      },
      {
        heading: 'Objective scoring',
        paragraphs: [
          'There are no judges, so there is nothing to argue about. An answer is checked against the server, an arrival against the real location, and time is measured automatically. The leaderboard is a fact, not a decision.',
          'Afterwards you get a full report per team: what they answered, how long it took, and where they got stuck. It exports to a spreadsheet.',
        ],
      },
    ],
    ctaLabel: 'Build a team building day',
  },
  'youth-group': {
    title: 'Youth group field game for a weekly session',
    description: 'A weekly session a group leader can actually prepare in the time they have. An outdoor mission route with real content, a hard finish and automatic scoring. No equipment and no site visit.',
    headline: 'A session you can prepare in one evening',
    intro: 'Something to do, something to learn, and a finish worth talking about next week.',
    sections: [
      {
        heading: 'Built for a leader’s reality',
        paragraphs: [
          'A group leader does not have a whole evening to prepare, and has no equipment. The route is built at a computer, sent as one code, and runs on the phones the group already carries.',
          'Four stages: an opening that gets everyone moving, a content stage where the real material sits, and then a hard finish. The group peaks at the end, not at the start.',
        ],
      },
      {
        heading: 'Content that is part of the game',
        paragraphs: [
          'An educational mission that feels like a lesson stops working the moment it is recognised. So the material sits inside a riddle, inside a secret code, or inside a spot that has to be found, and it reaches the group once they are already playing.',
          'A mission can be hidden entirely: the group gets a search area on the map instead of an exact pin, and has to find the spot themselves.',
        ],
      },
    ],
    ctaLabel: 'Build a session',
  },
};

const COPY: Record<LandingLanguage, typeof HE> = { he: HE, en: EN };

/**
 * Every page, ordered language-major then subject-major.
 *
 * Built by cross product rather than listed, so a subject can never exist in one
 * language and not the other: the pairing the hreflang cluster depends on is a property
 * of the construction, not something a reviewer has to notice.
 */
export const LANDING_PAGES: readonly LandingPage[] = LANDING_LANGUAGES.flatMap((language) =>
  LANDING_SUBJECTS.map((subject) => ({
    subject,
    language,
    slug: SUBJECT_SLUGS[subject],
    ...COPY[language][subject],
  })),
);

// ── DERIVED VALUES ───────────────────────────────────────────────────────────
//
// Everything below is COMPUTED from the registry. Nothing positional is authored, which
// is what makes the hreflang cluster symmetric and the sitemap complete by construction
// rather than by review.

/**
 * The path of a page, relative to the site root, always ending in a slash.
 *
 * The trailing slash is not cosmetic. Hosting resolves a directory path to its own
 * `index.html`, so the address that actually serves is the slash form; a canonical or a
 * sitemap entry written without it names a URL that only exists as a redirect, and the
 * page then disagrees with itself about which of the two it is.
 *
 * The home subject carries an empty slug and serves at the language root, so it must not
 * pick up an extra empty segment: `/he/`, never `/he//`.
 */
export function landingPagePath(page: LandingPage): string {
  return page.subject === HOME_SUBJECT
    ? `/${page.language}/`
    : `/${page.language}/${page.slug}/`;
}

/** The absolute canonical URL of a page. The one form used everywhere. */
export function landingPageUrl(page: LandingPage): string {
  return `${LANDING_ORIGIN}${landingPagePath(page)}`;
}

/**
 * Where this page's file lives inside an app's `public/` directory.
 *
 * Derived from the same path function as the URL, so the file that exists and the URL
 * that is advertised cannot describe different places.
 */
export function landingPageFile(page: LandingPage): string {
  return `${landingPagePath(page).slice(1)}index.html`;
}

/**
 * The `hreflang` value a language is annotated with.
 *
 * Hebrew is `he-IL`, language plus region, because it targets one market specifically.
 * English is bare `en`, deliberately NOT `en-US`: an unnecessary region target narrows
 * reach to no benefit, since the product is not marketed into a particular English
 * speaking country.
 */
export function hreflangFor(language: LandingLanguage): string {
  return language === 'he' ? 'he-IL' : 'en';
}

/**
 * The language that answers a visitor whom none of the targeted annotations match.
 *
 * English, because `x-default` is by definition the international fallback, and replying
 * to a visitor whose language is neither Hebrew nor English WITH Hebrew serves them worse
 * than replying in English.
 */
export const X_DEFAULT_LANGUAGE: LandingLanguage = 'en';

export interface LandingAlternate {
  hreflang: string;
  href: string;
}

/**
 * The `<link rel="alternate">` set for a page: itself, its counterpart, and `x-default`.
 *
 * The counterpart is found by matching the SUBJECT, which is exactly why both languages
 * of a subject share one slug. Nothing here is a lookup table and nothing is authored, so
 * the relation is symmetric because every page computes the same set from the same
 * registry. An asymmetric cluster is discarded by Google wholesale rather than partially,
 * which is why this must be structural instead of maintained.
 */
/**
 * The stable public URLs of the participant app that are NOT landing pages.
 *
 * These already existed in the sitemap and are legitimately indexable: the join screen
 * and the two legal documents. They are listed here because the generator now OWNS the
 * whole sitemap file, and a generator that emitted only its own pages would silently
 * delete these on its first run. Deliberately absent: per game teasers (`?game=`) and
 * public leaderboards (`?board=`), which are event scoped and would go stale in the index
 * faster than they could be crawled.
 */
export const STATIC_SITE_URLS: readonly { path: string; changefreq: string; priority: string }[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3' },
];

/**
 * The whole `sitemap.xml` for the participant origin: the stable URLs plus every landing
 * page.
 *
 * Generated rather than hand maintained for the same reason the pages are: a sitemap
 * entry naming a file that was renamed is invisible until Search Console reports a
 * crawl error weeks later, and the test asserts set equality in BOTH directions so a
 * stale entry fails exactly as loudly as a missing one.
 *
 * `lastmod` is deliberately absent. An honest `lastmod` would have to track when each
 * page's copy actually changed, and a generator that stamped "today" on every page at
 * every build would be telling Google the whole site changes daily, which is both false
 * and, once noticed, a reason to trust the file less.
 */
export function sitemapXml(): string {
  const entries = [
    ...STATIC_SITE_URLS.map((u) => ({
      loc: `${LANDING_ORIGIN}${u.path}`,
      changefreq: u.changefreq,
      priority: u.priority,
    })),
    ...LANDING_PAGES.map((p) => ({
      loc: landingPageUrl(p),
      changefreq: 'monthly',
      // The language homes are the entry points of the marketing set, so they outrank the
      // occasion pages, which in turn outrank the legal documents.
      priority: p.subject === HOME_SUBJECT ? '0.9' : '0.8',
    })),
  ];

  const body = entries
    .map((e) => [
      '  <url>',
      `    <loc>${e.loc}</loc>`,
      `    <changefreq>${e.changefreq}</changefreq>`,
      `    <priority>${e.priority}</priority>`,
      '  </url>',
    ].join('\n'))
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by scripts/build-landing-pages.ts. Do not edit by hand: run
     \`npm run seo:build\`. scripts/test-landing-pages.ts fails if this file drifts from
     the generator, and asserts the URL set matches the pages that actually exist. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export function alternatesFor(page: LandingPage): readonly LandingAlternate[] {
  const siblings = LANDING_PAGES.filter((p) => p.subject === page.subject);
  const fallback = siblings.find((p) => p.language === X_DEFAULT_LANGUAGE)!;
  return [
    ...siblings.map((p) => ({ hreflang: hreflangFor(p.language), href: landingPageUrl(p) })),
    { hreflang: 'x-default', href: landingPageUrl(fallback) },
  ];
}

// ── RENDERING ────────────────────────────────────────────────────────────────

/**
 * HTML-escape a text value.
 *
 * Applied to EVERY interpolated value without exception, including copy the registry
 * owns. Not because a title is hostile, but because an apostrophe in English copy or a
 * stray ampersand would otherwise produce invalid markup in an attribute, and the failure
 * would be a mangled search result rather than a visible break.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The visible label a page uses when linking to its counterpart language. */
const COUNTERPART_LABEL: Record<LandingLanguage, string> = {
  he: 'עברית',
  en: 'English',
};

/** The heading above the sibling link list. */
const MORE_LABEL: Record<LandingLanguage, string> = {
  he: 'עוד סוגי אירועים',
  en: 'More occasions',
};

/** A short nav label per subject, for the sibling links. */
const NAV_LABEL: Record<LandingLanguage, Record<LandingSubject, string>> = {
  he: {
    home: 'ראשי',
    birthday: 'יום הולדת',
    mitzvah: 'בר מצווה',
    wedding: 'חתונה',
    'team-building': 'גיבוש צוות',
    'youth-group': 'תנועת נוער',
  },
  en: {
    home: 'Home',
    birthday: 'Birthday',
    mitzvah: 'Bar mitzvah',
    wedding: 'Wedding',
    'team-building': 'Team building',
    'youth-group': 'Youth group',
  },
};

/** `og:locale` per language. */
const OG_LOCALE: Record<LandingLanguage, string> = { he: 'he_IL', en: 'en_US' };

/**
 * The inline stylesheet.
 *
 * Inline, and no font from a CDN, on purpose. The page must render completely from ONE
 * request with no JavaScript, and it must reference no hashed asset: a hashed filename
 * changes on every rebuild, and a committed static file cannot track one, so a reference
 * to it would work locally and 404 in production after the next deploy.
 *
 * Logical properties throughout (`margin-inline`, `padding-inline-start`, `text-align:
 * start`) so the same stylesheet lays out correctly under both `dir="rtl"` and
 * `dir="ltr"` without a second set of rules to keep in sync.
 */
const STYLE = `
:root { color-scheme: light dark; --ink: #1c1917; --muted: #57534e; --bg: #fffbf5;
  --card: #ffffff; --line: #e7e0d6;
  /* --brand is the FILL, --brand-ink is brand-coloured TEXT, and --cta-ink is what
     sits on the fill. One token was doing all three and failed as two of them:
     #EA580C measured 3.56:1 under white and 3.45:1 as link text, where both need
     4.5:1.

     The replacement is play-web's ink-fire token, not a shade invented here. No
     backticks in this comment: the whole stylesheet is a template literal, and a
     backtick here ends it several hundred characters early. The
     product already solved this problem and wrote down the rule beside the token:
     fills keep the brand orange, TEXT uses a darkened variant. Using it gives
     5.89:1 as link text and 6.08:1 under white, and means these pages carry the
     product's colour rather than a third orange that happens to pass. */
  --brand: #b03a0b; --brand-ink: #b03a0b; --cta-ink: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --ink: #f5f5f4; --muted: #a8a29e;
  --bg: #0c0a09; --card: #1c1917; --line: #292524;
  /* In dark the fill is a LIGHT orange, so white on it was 2.26:1, the worst
     pairing on either page set. The fix is the TEXT, not the fill: the page's own
     near-black on that orange is 8.73:1 and the fill is unchanged. */
  --brand: #fb923c; --brand-ink: #fb923c; --cta-ink: #0c0a09; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); line-height: 1.7;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
main, header, footer { max-width: 46rem; margin-inline: auto; padding-inline: 1.25rem; }
header { padding-block: 2.5rem 1rem; }
.brand { font-weight: 700; letter-spacing: .02em; color: var(--brand-ink); text-decoration: none; }
h1 { font-size: clamp(1.9rem, 5vw, 2.75rem); line-height: 1.2; margin-block: .75rem .5rem; }
h2 { font-size: 1.3rem; margin-block: 2.25rem .5rem; }
.intro { font-size: 1.15rem; color: var(--muted); margin-block: 0 1.5rem; }
p { margin-block: 0 1rem; }
.cta { display: inline-block; background: var(--brand); color: var(--cta-ink); text-decoration: none;
  font-weight: 600; padding: .85rem 1.6rem; border-radius: .6rem; margin-block: 1.5rem; }
.cta:hover { filter: brightness(1.08); }
nav.more { border-top: 1px solid var(--line); margin-block-start: 3rem; padding-block-start: 1.25rem; }
nav.more ul { list-style: none; padding-inline-start: 0; margin: 0;
  display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; }
nav.more a { color: var(--brand-ink); }
footer { border-top: 1px solid var(--line); margin-block-start: 2rem; padding-block: 1.25rem 3rem;
  color: var(--muted); font-size: .9rem; display: flex; flex-wrap: wrap; gap: 1rem; }
footer a { color: var(--brand-ink); }
`.trim();

/**
 * The structured data for a landing page.
 *
 * `WebApplication` rather than `Article`: the page describes the product, and the brand
 * name collides with an unrelated Roblox shooter that dominates the query, so stating
 * plainly what this is carries real weight. `inLanguage` names only THIS page's language,
 * unlike the app shells, which legitimately serve both.
 */
function jsonLd(page: LandingPage): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'RushPoint',
    url: landingPageUrl(page),
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any',
    inLanguage: page.language,
    description: page.description,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'ILS' },
  }, null, 2);
}

/**
 * Render one landing page to a complete, self contained HTML document.
 *
 * Everything positional (canonical, og:url, the alternate set, the sibling links) is
 * derived from the registry rather than passed in, so a page cannot be rendered with
 * signals that disagree with where it will actually live.
 */
export function renderLandingPage(page: LandingPage): string {
  const url = landingPageUrl(page);
  const dir = page.language === 'he' ? 'rtl' : 'ltr';
  const counterpart = LANDING_PAGES.find(
    (p) => p.subject === page.subject && p.language !== page.language,
  )!;
  const home = LANDING_PAGES.find(
    (p) => p.subject === HOME_SUBJECT && p.language === page.language,
  )!;
  // Siblings in the same language, minus this page. This is what keeps the set
  // internally connected instead of twelve dead ends that each only Google can reach.
  const siblings = LANDING_PAGES.filter(
    (p) => p.language === page.language && p.subject !== page.subject,
  );

  const alternates = alternatesFor(page)
    .map((a) => `    <link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`)
    .join('\n');

  const sections = page.sections
    .map((s) => [
      `      <h2>${esc(s.heading)}</h2>`,
      ...s.paragraphs.map((t) => `      <p>${esc(t)}</p>`),
    ].join('\n'))
    .join('\n');

  const siblingLinks = siblings
    .map((p) => `        <li><a href="${landingPageUrl(p)}">${esc(NAV_LABEL[page.language][p.subject])}</a></li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${page.language}" dir="${dir}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(page.title)}</title>
    <meta name="description" content="${esc(page.description)}" />
    <link rel="canonical" href="${url}" />
${alternates}
    <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="RushPoint" />
    <meta property="og:url" content="${url}" />
    <meta property="og:locale" content="${OG_LOCALE[page.language]}" />
    <meta property="og:title" content="${esc(page.title)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:image" content="${LANDING_ORIGIN}/og.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(page.title)}" />
    <meta name="twitter:description" content="${esc(page.description)}" />
    <meta name="twitter:image" content="${LANDING_ORIGIN}/og.jpg" />
    <script type="application/ld+json">
${jsonLd(page)}
    </script>
    <style>
${STYLE}
    </style>
  </head>
  <body>
    <header>
      <a class="brand" href="${landingPageUrl(home)}">RushPoint</a>
      <h1>${esc(page.headline)}</h1>
      <p class="intro">${esc(page.intro)}</p>
      <a class="cta" href="${CREATOR_ORIGIN}/">${esc(page.ctaLabel)}</a>
    </header>
    <main>
${sections}
      <p><a class="cta" href="${CREATOR_ORIGIN}/">${esc(page.ctaLabel)}</a></p>
      <nav class="more">
        <h2>${esc(MORE_LABEL[page.language])}</h2>
        <ul>
${siblingLinks}
        </ul>
      </nav>
    </main>
    <footer>
      <a href="${landingPageUrl(counterpart)}" hreflang="${hreflangFor(counterpart.language)}">${esc(COUNTERPART_LABEL[counterpart.language])}</a>
      <a href="${MARKETING_ORIGIN}/${page.language}/">${esc(MARKETING_LABEL[page.language])}</a>
      <a href="${LANDING_ORIGIN}/">${esc(page.language === 'he' ? 'הצטרפות למשחק' : 'Join a game')}</a>
      <a href="${LANDING_ORIGIN}/privacy">${esc(page.language === 'he' ? 'פרטיות' : 'Privacy')}</a>
      <a href="${LANDING_ORIGIN}/terms">${esc(page.language === 'he' ? 'תנאים' : 'Terms')}</a>
    </footer>
  </body>
</html>
`;
}
