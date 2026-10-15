/**
 * Every word of the RushPoint Live audition, per language
 * (change: rushpoint-live-english).
 *
 * It lives HERE, in src/copy, rather than inline in the page, for one reason that
 * is worth more than the indirection costs: scripts/test-marketing-content.ts
 * scans this directory and asserts that every string under `he` is Hebrew and
 * every string under `en` is English, using the same leak predicate the two apps
 * are gated by. Copy sitting inline in an .astro file is checked by nothing, and
 * a Hebrew sentence left in the English page is exactly the kind of thing that
 * survives review and is spotted by a visitor.
 *
 * The page WAS Hebrew only, deliberately: the event is one evening in Jerusalem,
 * and an English page looked like advertising to people who cannot attend. That
 * reasoning was half right. It is a race for people IN Israel, which is not the
 * same as a race for people who read Hebrew — a large part of the country reads
 * English first. So the page is bilingual now, and WHERE somebody is, rather than
 * which language they read, is what decides whether the home page band appears.
 * See utils/israelAudience.ts for how that is judged and why it errs toward showing.
 *
 * House rule, both languages: no hyphen, en dash, em dash or maqaf anywhere in
 * user-facing copy. Use a comma, a period, or rewrite.
 */
import type { Language } from '~/utils/i18n';

export interface LiveFact {
  value: string;
  label: string;
}

export interface LiveQuestion {
  /** Position in the interview, already padded. */
  n: string;
  title: string;
  hint: string;
  placeholder?: string;
}

export interface LiveCopy {
  /** Page metadata. */
  title: string;
  description: string;

  /** The band and the page hero share these. */
  badge: string;
  headlineTop: string;
  headlineBottom: string;
  blurb: string;
  facts: LiveFact[];
  cta: string;
  jumpToForm: string;
  ctaNote: string;
  prize: string;

  /** The countdown. */
  eventWhen: string;
  eventCity: string;
  units: { days: string; hours: string; minutes: string; seconds: string };
  started: string;
  /** Screen reader announcement, updated about once a minute. */
  remaining: (days: number, hours: number) => string;

  /** What we are looking for. */
  lookingTitle: string;
  lookingYes: string[];
  lookingNo: string[];

  /** The form. */
  formTitle: string;
  formIntro: string;
  allRequired: string;
  eligibility: string;
  choosePrompt: string;
  /** Three since the short form (rushpoint-live-short-form, 15.10): size, ages, phone. */
  questions: LiveQuestion[];

  /** The close. */
  closeTitle: string;
  closeBody: string;
  submit: string;
  sending: string;
  privacy: string;
  contactLead: string;

  /**
   * Following on Instagram. NOT a gate — see the block in the page for why a
   * self-declared checkbox would buy nothing and cost trust.
   */
  followTitle: string;
  followBody: string;
  followCta: string;
  followCtaTikTok: string;
  followCtaFacebook: string;
  followDone: string;
  successFollowTitle: string;
  successFollowBody: string;

  /** Outcomes. */
  successTitle: string;
  successBody: string;
  draftRestored: string;
  missingOne: string;
  missingMany: (n: number) => string;
  oneStillWrong: string;
  errInvalid: string;
  errRateLimited: string;
  errOffline: string;
  errUnknown: string;

  /** Progress. */
  progressStart: string;
  progressGoing: string;
  progressHalf: string;
  progressNearly: string;
  progressDone: string;
  progressCount: (done: number, total: number) => string;

  /** Per field refusals, keyed by the name of the control they belong to. */
  fieldErrors: Record<string, string>;
}

export const liveCopy: Record<Language, LiveCopy> = {
  he: {
    title: 'RushPoint Live · המירוץ הגדול על ירושלים',
    description:
      'עשר קבוצות בלבד, מכל המגזרים בישראל, מתמודדות בערב אחד של מירוץ בשטח על פני ירושלים. יום חמישי, 22 באוקטובר. ההרשמה פתוחה לקבוצות של 5 עד 8 חברים, מגיל 16 ומעלה.',

    badge: 'האודישן פתוח · RushPoint Live',
    headlineTop: 'המירוץ הגדול',
    headlineBottom: 'על ירושלים',
    blurb:
      'ערב אחד. עיר שלמה. עשר קבוצות שנבחרות מכל המגזרים בישראל, רצות אחרי משימות בשטח עד שנשארת אחת. מצלמות איתכן לאורך כל הדרך.',
    facts: [
      {
        value: '10',
        label: 'קבוצות ייבחרו',
      },
      {
        value: '5 עד 8',
        label: 'חברים בקבוצה',
      },
      {
        value: 'ערב אחד',
        label: 'מהתחלה ועד הסוף',
      },
    ],
    cta: 'אנחנו רוצים להתמודד',
    jumpToForm: 'קחו אותי לשאלון',
    ctaNote: 'פחות מדקה · בלי תשלום · בלי התחייבות',
    prize:
      'לקבוצה המנצחת מחכה פרס. מה הוא בדיוק נחשוף לקראת המירוץ, יחד עם ההטבות משיתופי הפעולה עם המותגים. מה שכבר סגור: הערב הזה מצולם מהתחלה ועד הסוף, וכל קבוצה יוצאת איתו בידיים.',

    eventWhen: 'יום חמישי, 22 באוקטובר, בערב',
    eventCity: 'ירושלים',
    units: {
      days: 'ימים',
      hours: 'שעות',
      minutes: 'דקות',
      seconds: 'שניות',
    },
    started: 'המירוץ יצא לדרך',
    remaining: (days, hours) => `נותרו ${days} ימים ו${hours} שעות למירוץ`,

    lookingTitle: 'מה אנחנו מחפשים, ומה לא',
    lookingYes: [
      'קבוצה שכיף לה ביחד, וזה נראה',
      'סיפור אמיתי שמחבר ביניכם',
      'ראש פתוח ואנרגיה לערב שלם',
    ],
    lookingNo: [
      'לא צריך להיות ספורטאים',
      'לא צריך ניסיון מול מצלמה',
      'לא צריך להכיר את ירושלים',
    ],

    formTitle: 'שלוש שאלות. זה הכול.',
    formIntro:
      'מספיק שנדע כמה אתם, בני כמה אתם ואיך משיגים אתכם. את כל השאר נשאל בשיחת טלפון.',
    allRequired: 'פחות מדקה, ואין פה תשובות נכונות.',
    eligibility: 'המירוץ פתוח מגיל 16 ומעלה, בלי גיל מקסימום.',
    choosePrompt: 'בחרו מספר',
    questions: [
      {
        n: '01',
        title: 'כמה אתם?',
        hint: 'בין חמישה לשמונה. זה תנאי ולא המלצה, כי ככה המשימות בנויות.',
      },
      {
        n: '02',
        title: 'בני כמה אתם?',
        hint: 'מגיל 16 ומעלה, ואין גיל מקסימום. כתבו את הטווח שלכם, מהצעיר ועד המבוגר.',
        placeholder: 'הצעיר ביותר עד המבוגר ביותר',
      },
      {
        n: '03',
        title: 'למי מתקשרים?',
        hint: 'מספר אחד שעונים בו. נתקשר רק אם נתקדם איתכם.',
        placeholder: '050 000 0000',
      },
    ],

    closeTitle: 'עשר קבוצות יוצאות לדרך, 22 באוקטובר',
    closeBody: 'אנחנו קוראים כל מועמדות. אם נתקדם איתכם, נתקשר למספר שהשארתם.',
    submit: 'שלחו אותנו למירוץ',
    sending: 'שולחים...',
    privacy:
      'הפרטים נשמרים אצלנו בלבד, משמשים רק לבחירת הקבוצות למירוץ הזה, ולא מועברים לאף גורם אחר.',
    contactLead: 'אם משהו לא עובד, כתבו לנו אל',

    followTitle: 'ככה תדעו אם נבחרתם',
    followBody:
      'את עשר הקבוצות שנבחרו נכריז ברשתות, ושם גם יעלה כל מה שמצולם בערב עצמו. שווה שכל הקבוצה תעקוב, אחרת תגלו מכולם.',
    followCta: 'אינסטגרם',
    followCtaTikTok: 'טיקטוק',
    followCtaFacebook: 'פייסבוק',
    followDone: 'יפה. נתראה שם.',
    successFollowTitle: 'עכשיו הדבר האחרון',
    successFollowBody:
      'את עשר הקבוצות נכריז ברשתות. עקבו, ותעבירו לשאר הקבוצה שיעקבו גם, כדי שלא תפספסו את ההודעה.',

    successTitle: 'המועמדות נשלחה',
    successBody: 'קיבלנו אתכם. אנחנו עוברים על כל הקבוצות ומודיעים לנבחרות בטלפון שהשארתם. בהצלחה.',
    draftRestored: 'המשכנו מאיפה שהפסקתם. אפשר לערוך הכול.',
    missingOne: 'חסרה תשובה אחת',
    missingMany: (n) => `חסרות ${n} תשובות`,
    oneStillWrong: 'משהו אחד עוד לא תקין',
    errInvalid: 'חלק מהפרטים לא התקבלו. עברו על הטופס ונסו שוב',
    errRateLimited: 'נשלחו יותר מדי בקשות מהחיבור הזה. נסו שוב בעוד כמה דקות',
    errOffline: 'אין חיבור לרשת. הפרטים נשמרו בטופס, נסו שוב כשיחזור',
    errUnknown: 'משהו השתבש בשליחה. נסו שוב, ואם זה חוזר כתבו לנו במייל',

    progressStart: 'בואו נתחיל',
    progressGoing: 'ממשיכים',
    progressHalf: 'עברתם את החצי',
    progressNearly: 'כמעט שם',
    progressDone: 'הכול מלא. אפשר לשלוח',
    progressCount: (done, total) => `${done} מתוך ${total}`,

    fieldErrors: {
      teamSize: 'בחרו כמה אתם, בין חמישה לשמונה',
      ageRange: 'כתבו את טווח הגילאים',
      phone: 'צריך מספר טלפון נייד ישראלי תקין',
    },
  },

  en: {
    title: 'RushPoint Live · The big race across Jerusalem',
    description:
      'Ten teams only, from every part of Israeli society, racing across Jerusalem for one evening. Thursday 22 October. Open to teams of 5 to 8 people aged 16 and over.',

    badge: 'Auditions are open · RushPoint Live',
    headlineTop: 'The big race',
    headlineBottom: 'across Jerusalem',
    blurb:
      'One evening. One whole city. Ten teams, chosen from every part of Israeli society, chasing real missions on the ground until one is left standing. Cameras with you the entire way.',
    facts: [
      {
        value: '10',
        label: 'teams will be chosen',
      },
      {
        value: '5 to 8',
        label: 'people per team',
      },
      {
        value: 'One evening',
        label: 'start to finish',
      },
    ],
    cta: 'We want in',
    jumpToForm: 'Take me to the questions',
    ctaNote: 'Under a minute · Free · No commitment',
    prize:
      'There is a prize waiting for the winning team. Exactly what it is, we will reveal closer to the race, along with the perks from our brand partners. What is already settled: the whole evening is filmed, start to finish, and every team walks away with the footage.',

    eventWhen: 'Thursday 22 October, evening',
    eventCity: 'Jerusalem',
    units: {
      days: 'days',
      hours: 'hours',
      minutes: 'minutes',
      seconds: 'seconds',
    },
    started: 'The race is under way',
    remaining: (days, hours) => `${days} days and ${hours} hours until the race`,

    lookingTitle: 'What we are looking for, and what we are not',
    lookingYes: [
      'A team that enjoys being together, and it shows',
      'A real story that ties you to each other',
      'An open mind and energy for a whole evening',
    ],
    lookingNo: [
      'You do not need to be athletes',
      'You do not need experience on camera',
      'You do not need to know Jerusalem',
    ],

    formTitle: 'Three questions. That is all.',
    formIntro:
      'All we need is how many you are, how old you are and how to reach you. Everything else we will ask on the phone.',
    allRequired: 'Under a minute, and there are no right answers.',
    eligibility: 'Open to anyone aged 16 and over. There is no upper age limit.',
    choosePrompt: 'Choose a number',
    questions: [
      {
        n: '01',
        title: 'How many of you are there?',
        hint: 'Between five and eight. That is a condition rather than a suggestion, because it is how the missions are built.',
      },
      {
        n: '02',
        title: 'How old are you?',
        hint: 'Sixteen and over, with no upper limit. Give us your own range, youngest to oldest.',
        placeholder: 'Youngest to oldest',
      },
      {
        n: '03',
        title: 'Who do we call?',
        hint: 'One number somebody actually answers. We will only call if we take it further with you.',
        placeholder: '050 000 0000',
      },
    ],

    closeTitle: 'Ten teams set off on 22 October',
    closeBody: 'We read every application. If we take it further with you, we will call the number you left.',
    submit: 'Send us to the race',
    sending: 'Sending...',
    privacy:
      'Your details stay with us, are used only to choose the teams for this race, and are never passed to anyone else.',
    contactLead: 'If something is not working, write to us at',

    followTitle: 'This is how you will know',
    followBody:
      'We announce the ten chosen teams there, and everything filmed on the night goes up there too. Worth having the whole team follow, or you will hear it from everyone else first.',
    followCta: 'Instagram',
    followCtaTikTok: 'TikTok',
    followCtaFacebook: 'Facebook',
    followDone: 'Good. See you there.',
    successFollowTitle: 'One last thing',
    successFollowBody:
      'We announce the ten teams there. Follow, and send this to the rest of the team so nobody misses it.',

    successTitle: 'Your application is in',
    successBody:
      'We have got you. We are going through every team and will call the ones we choose on the number you left. Good luck.',
    draftRestored: 'We picked up where you left off. You can edit anything.',
    missingOne: 'One answer is missing',
    missingMany: (n) => `${n} answers are missing`,
    oneStillWrong: 'One thing is still not right',
    errInvalid: 'Some of the details were not accepted. Look over the form and try again',
    errRateLimited: 'Too many requests from this connection. Try again in a few minutes',
    errOffline: 'No connection. Your answers are still in the form, try again when it is back',
    errUnknown: 'Something went wrong sending this. Try again, and if it keeps happening write to us',

    progressStart: 'Let us begin',
    progressGoing: 'Keep going',
    progressHalf: 'Past halfway',
    progressNearly: 'Almost there',
    progressDone: 'All done. Ready to send',
    progressCount: (done, total) => `${done} of ${total}`,

    fieldErrors: {
      teamSize: 'Choose how many you are, between five and eight',
      ageRange: 'Give us the age range',
      phone: 'We need a valid Israeli mobile number',
    },
  },
};
