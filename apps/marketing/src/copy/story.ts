/**
 * The story page, per language. Authored in both, not translated between them.
 *
 * Change: marketing-site.
 */
import type { Language } from '~/utils/i18n';

export interface StoryCopy {
  title: string;
  description: string;
  headline: string;
  intro: string;
  sections: Array<{ title: string; body: string[] }>;
  closing: string;
  action: string;
}

export const storyCopy: Record<Language, StoryCopy> = {
  he: {
    title: 'הסיפור שלנו',
    description:
      'איך מירוץ אחד בירושלים, שנוהל על דפי נייר ועם שופטים בעמדות, הפך לפלטפורמה שכל אחד יכול לבנות בה משחק שדה משלו.',
    headline: 'התחלנו ממירוץ אחד שכמעט התפרק',
    intro:
      'RushPoint לא נולד כרעיון למוצר. הוא נולד כי היה צריך להפעיל מירוץ אמיתי, והדרך שבה עשינו את זה פשוט לא החזיקה.',
    sections: [
      {
        title: 'מה שלא עבד',
        body: [
          'המשחק הראשון היה מירוץ בעיר העתיקה בירושלים. תכננו מסלול, חילקנו דפים, והצבנו שופטים בעמדות שירשמו מי הגיע ומתי.',
          'בפועל, רוב האנרגיה הלכה לניהול ולא למשחק. שופט אחד לא הגיע, קבוצה אחת חיכתה עשרים דקות בתחנה תפוסה, ובסוף הערב ישבנו לחשב ניקוד מדפים שנרטבו. אף אחד לא רב על מי ניצח, כי אף אחד לא היה בטוח.',
        ],
      },
      {
        title: 'מה שהבנו',
        body: [
          'הבעיה לא הייתה הרעיון. אנשים אהבו את המשחק. הבעיה הייתה שכל מה שהופך משחק שדה לאפשרי, לדעת מי איפה, לבדוק תשובות, למנוע פקקים בתחנות, לחשב ניקוד, דורש אנשים שעומדים בשטח ועושים את זה ידנית.',
          'וזה בדיוק סוג העבודה שמחשב עושה טוב יותר מאדם. לא כי הוא חכם יותר, אלא כי הוא לא מתעייף, לא מאחר ולא מאבד דף.',
        ],
      },
      {
        title: 'מה בנינו במקום',
        body: [
          'הגרסה הראשונה הייתה אפליקציה לאירוע אחד בלבד. היא עבדה, אבל היא ידעה לעשות רק את המשחק ההוא.',
          'הגרסה שרצה היום היא פלטפורמה. כל אחד בונה את המשחק שלו, מפעיל אותו מתי שהוא רוצה, ומקבל את כל מה שהיה דורש צוות שלם. המירוץ המקורי בירושלים הוא היום פשוט עוד משחק אחד מתוך רבים שנבנו כאן.',
        ],
      },
    ],
    closing:
      'המטרה לא השתנתה מאז הערב ההוא בעיר העתיקה: שאנשים יצאו החוצה, יסתובבו במקום אמיתי ויהנו. כל השאר הוא רק מה שצריך לקרות ברקע כדי שזה יהיה אפשרי.',
    action: 'בונים משחק',
  },
  en: {
    title: 'Our story',
    description:
      'How one race in Jerusalem, run on paper with judges standing at stations, turned into a platform anyone can build their own field game on.',
    headline: 'It started with one race that nearly fell apart',
    intro:
      'RushPoint did not begin as a product idea. It began because a real race had to happen, and the way we ran it did not hold up.',
    sections: [
      {
        title: 'What did not work',
        body: [
          'The first game was a race through the Old City in Jerusalem. We planned a route, handed out paper, and put judges at stations to record who arrived and when.',
          'In practice most of the energy went into running the thing rather than into the game. One judge did not show up, one team waited twenty minutes at an occupied station, and at the end of the night we sat down to total up scores from paper that had got wet. Nobody argued about who won, because nobody was sure.',
        ],
      },
      {
        title: 'What we realised',
        body: [
          'The idea was not the problem. People loved the game. The problem was that everything which makes a field game possible, knowing where each team is, checking answers, keeping stations from jamming, working out scores, needed people standing outside doing it by hand.',
          'That is exactly the kind of work a computer does better than a person. Not because it is cleverer, but because it does not get tired, arrive late, or lose a sheet of paper.',
        ],
      },
      {
        title: 'What we built instead',
        body: [
          'The first version was an app for one event. It worked, but the only game it knew how to run was that one.',
          'What runs today is a platform. Anyone builds their own game, launches it when they want, and gets everything that used to take a whole crew. The original Jerusalem race is now just one of many games built here.',
        ],
      },
    ],
    closing:
      'The goal has not changed since that night in the Old City: get people outside, moving around a real place, enjoying themselves. Everything else is just what has to happen in the background to make that possible.',
    action: 'Build a game',
  },
};
