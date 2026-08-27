/**
 * Home page copy, per language.
 *
 * Hebrew is AUTHORED, not translated. The two versions say the same thing and
 * are not sentence for sentence mirrors, because copy that reads as translated
 * is the thing this site is trying not to be. Roughly 78% of the searches this
 * page is written for are Hebrew.
 *
 * No em dash, en dash, or spaced hyphen anywhere in these strings: the no dash
 * standard covers marketing copy (change: ui-text-standards).
 *
 * Change: marketing-site.
 */
import type { Language } from '~/utils/i18n';

export interface HomeCopy {
  title: string;
  description: string;
  tagline: string;
  headline: string;
  subhead: string;
  primaryAction: string;
  secondaryAction: string;
  ideasAction: string;
  featuresTagline: string;
  featuresTitle: string;
  featuresSubtitle: string;
  features: Array<{ title: string; description: string; icon: string }>;
  stepsTitle: string;
  steps: Array<{ title: string; description: string; icon: string }>;
  ctaTitle: string;
  ctaSubtitle: string;
}

export const homeCopy: Record<Language, HomeCopy> = {
  he: {
    title: 'בונים משחק שדה אמיתי בשטח',
    description:
      'פלטפורמה לבניית משחקי שדה: מסלול משימות אמיתי בשטח, ניווט בטלפון, ניקוד אוטומטי. בלי שופטים, בלי דפי נייר, בלי לרוץ אחרי כולם.',
    tagline: 'משחק שדה',
    headline: 'המשחק יוצא <span class="text-accent">החוצה</span>',
    subhead:
      'אתם בונים את המסלול, הקבוצות משחקות בטלפון שלהן, והניקוד מתעדכן לבד. אתם נשארים עם החלק המהנה, לראות אנשים רצים בשטח ונהנים.',
    primaryAction: 'בונים משחק',
    secondaryAction: 'הסיפור שלנו',
    ideasAction: 'רעיונות לפי סוג אירוע',
    featuresTagline: 'למה זה עובד',
    featuresTitle: 'כל מה שהיה מסובך, קורה עכשיו לבד',
    featuresSubtitle:
      'משחק שדה טוב נופל בדרך כלל על הלוגיסטיקה ולא על הרעיון. כאן הלוגיסטיקה כבר פתורה.',
    features: [
      {
        title: 'ניקוד אוטומטי',
        description:
          'התשובות נבדקות בשרת ברגע שהן נשלחות. אין שופט שצריך לעמוד בעמדה, ואין ויכוח בסוף על מי קיבל כמה.',
        icon: 'tabler:trophy',
      },
      {
        title: 'ניווט אמיתי בשטח',
        description:
          'לכל משימה יש מיקום על המפה, והכניסה אליה נבדקת מול המיקום של המכשיר עצמו. הקבוצה מגיעה למקום, לא מדווחת שהגיעה.',
        icon: 'tabler:map-pin',
      },
      {
        title: 'ניתוב חכם בין קבוצות',
        description:
          'המערכת שולחת כל קבוצה לתחנה שפנויה וקרובה אליה. במקום פקק בעמדה אחת, כולם בתנועה.',
        icon: 'tabler:route',
      },
      {
        title: 'עובד גם כשהרשת נופלת',
        description:
          'האפליקציה בנויה לשטח פתוח: היא זוכרת את המצב, ממשיכה לעבוד ומסתנכרנת כשהקליטה חוזרת.',
        icon: 'tabler:wifi-off',
      },
      {
        title: 'שליטה חיה במהלך המשחק',
        description:
          'לוח בקרה שמראה איפה כל קבוצה, מי תקוע ומי מוביל. אפשר לשלוח הודעה, לסגור תחנה או לתת ניקוד ידני תוך כדי.',
        icon: 'tabler:device-desktop-analytics',
      },
      {
        title: 'הצטרפות בלי התקנה',
        description:
          'המשתתפים פותחים קישור ומקלידים קוד. אין אפליקציה להוריד, אין הרשמה, אין סיסמאות שנשכחו ברגע האחרון.',
        icon: 'tabler:qrcode',
      },
    ],
    stepsTitle: 'מהרעיון עד שהקבוצות בשטח',
    steps: [
      {
        title: 'בונים את המסלול',
        description:
          'מסמנים תחנות על המפה וכותבים לכל אחת משימה. אפשר להתחיל ממשחק מוכן ולשנות אותו, או לתת למערכת להרכיב אחד לפי סוג האירוע.',
        icon: 'tabler:map-2',
      },
      {
        title: 'פותחים משחק ומשתפים קוד',
        description:
          'לוחצים על הפעלה ומקבלים קוד הצטרפות. שולחים אותו בווטסאפ לקבוצה, וזהו.',
        icon: 'tabler:send',
      },
      {
        title: 'צופים במה שקורה',
        description:
          'הקבוצות מתחילות לזוז, הניקוד מתעדכן, ואתם רואים הכול על מסך אחד עד הסיום.',
        icon: 'tabler:eye',
      },
    ],
    ctaTitle: 'המשחק הראשון שלכם רחוק בערך חצי שעה',
    ctaSubtitle: 'אין צורך בכרטיס אשראי, ואפשר להתחיל ממשחק מוכן ולשנות אותו.',
  },
  en: {
    title: 'Build a real field game',
    description:
      'A platform for building field games: a real route through real places, navigation on the phone, automatic scoring. No judges, no paper, no chasing everyone around.',
    tagline: 'Field game',
    headline: 'The game goes <span class="text-accent">outside</span>',
    subhead:
      'You design the route, teams play on their own phones, and the scoring takes care of itself. You get to keep the good part, which is watching people run around enjoying it.',
    primaryAction: 'Build a game',
    secondaryAction: 'Our story',
    ideasAction: 'Ideas by occasion',
    featuresTagline: 'Why it works',
    featuresTitle: 'The hard parts now happen on their own',
    featuresSubtitle:
      'A field game usually fails on logistics rather than on the idea. The logistics are already solved here.',
    features: [
      {
        title: 'Automatic scoring',
        description:
          'Answers are checked on the server the moment they are sent. Nobody has to stand at a station, and nobody argues afterwards about who got what.',
        icon: 'tabler:trophy',
      },
      {
        title: 'Real navigation',
        description:
          'Every task has a place on the map, and arriving is verified against the device GPS. A team gets there rather than reporting that it did.',
        icon: 'tabler:map-pin',
      },
      {
        title: 'Smart routing between teams',
        description:
          'Each team is sent to a station that is free and close to it. Instead of a queue at one stop, everyone keeps moving.',
        icon: 'tabler:route',
      },
      {
        title: 'Survives a bad signal',
        description:
          'The app is built for open ground: it holds its state, keeps working, and syncs when reception comes back.',
        icon: 'tabler:wifi-off',
      },
      {
        title: 'Live control while you run it',
        description:
          'One console shows where every team is, who is stuck and who is ahead. Send a message, close a station or adjust a score without stopping the game.',
        icon: 'tabler:device-desktop-analytics',
      },
      {
        title: 'Joining takes no install',
        description:
          'Players open a link and type a code. Nothing to download, nothing to sign up for, no passwords forgotten at the worst moment.',
        icon: 'tabler:qrcode',
      },
    ],
    stepsTitle: 'From an idea to teams in the field',
    steps: [
      {
        title: 'Design the route',
        description:
          'Drop stations on the map and write a task for each one. Start from a ready made game and change it, or let the system compose one for the occasion.',
        icon: 'tabler:map-2',
      },
      {
        title: 'Launch and share a code',
        description: 'Press launch and you get a join code. Send it to the group and that is the setup done.',
        icon: 'tabler:send',
      },
      {
        title: 'Watch it happen',
        description:
          'Teams start moving, scores update themselves, and you follow all of it on one screen until the finish.',
        icon: 'tabler:eye',
      },
    ],
    ctaTitle: 'Your first game is about half an hour away',
    ctaSubtitle: 'No card needed, and you can start from a ready made game and change it.',
  },
};
