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
  optionalTag: string;
  choosePrompt: string;
  questions: LiveQuestion[];
  sectors: { religious: string; secular: string; mixed: string; other: string };
  camera: string[];
  photoPick: string;
  photoReplace: string;
  photoWorking: string;
  photoReady: (kb: number) => string;
  photoAlt: string;

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
  photoErrors: { type: string; unreadable: string; huge: string };
}

export const liveCopy: Record<Language, LiveCopy> = {
  he: {
    title: 'RushPoint Live · המירוץ הגדול על ירושלים',
    description:
      'עשר קבוצות בלבד, מכל המגזרים בישראל, מתמודדות בערב אחד של מירוץ בשטח על פני ירושלים. יום חמישי, 22 באוקטובר. ההרשמה פתוחה לקבוצות של 5 עד 8 חברים.',

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
    ctaNote: 'כשלוש דקות · בלי תשלום · בלי התחייבות',
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

    formTitle: 'תשע שאלות. זה הכול.',
    formIntro:
      'אין פה תשובות נכונות ואין מה להתכונן. אנחנו קוראים כל מועמדות, אז כתבו כמו שאתם מדברים. ככל שתהיו יותר אתם, כך נדע טוב יותר אם אתם הקבוצה שאנחנו מחפשים.',
    allRequired: 'כל השאלות קצרות. התמונה בסוף היא רשות.',
    optionalTag: 'רשות',
    choosePrompt: 'בחרו מספר',
    questions: [
      {
        n: '01',
        title: 'איך קוראים לקבוצה שלכם?',
        hint: 'השם שנכריז בו עליכם. אפשר רציני, ואפשר בדיחה פנימית שרק אתם מבינים.',
        placeholder: 'הנשרים',
      },
      {
        n: '02',
        title: 'כמה אתם?',
        hint: 'בין חמישה לשמונה. זה תנאי ולא המלצה, כי ככה המשימות בנויות.',
      },
      {
        n: '03',
        title: 'מאיפה אתם בעולם?',
        hint: 'אפשר לסמן יותר מאחד. אנחנו מרכיבים ערב שיש בו את כולם, אז זה עוזר לנו ולא פוסל אתכם.',
      },
      {
        n: '04',
        title: 'מאיפה אתם מגיעים?',
        hint: 'עיר או אזור. אם אתם מפוזרים, כתבו את כולם.',
        placeholder: 'ירושלים, ושניים מבית שמש',
      },
      {
        n: '05',
        title: 'איך אתם מכירים?',
        hint: 'צבא, תנועה, שכונה, עבודה, משפחה. הסיפור שמחבר ביניכם הוא חצי מהעניין.',
        placeholder: 'נפגשנו בתנועה לפני חמש שנים ומאז לא הצלחנו להיפרד',
      },
      {
        n: '06',
        title: 'בני כמה אתם?',
        hint: 'טווח הגילאים בקבוצה. אין גיל נכון.',
        placeholder: '16 עד 18',
      },
      {
        n: '07',
        title: 'למה שנבחר דווקא בכם?',
        hint: 'זו השאלה שמכריעה, וזו גם היחידה שאין בה תשובה נכונה. אל תכתבו מה שנשמע טוב. כתבו מה שנכון עליכם.',
        placeholder: 'כתבו כאן כמו שהייתם מספרים לחבר',
      },
      {
        n: '08',
        title: 'כמה נוח לכם מול מצלמה?',
        hint: 'הערב מצולם. לא מחפשים שחקנים, אז תענו בכנות. גם ארבע וגם אחת זו תשובה טובה.',
      },
      {
        n: '09',
        title: 'למי מתקשרים?',
        hint: 'מספר אחד שעונים בו. נתקשר רק אם נתקדם איתכם.',
        placeholder: '050 000 0000',
      },
      {
        n: '10',
        title: 'תנו לנו לראות אתכם',
        hint: 'לא חובה, אבל זה עוזר לנו לראות אתכם. לא צריך מקצועית ולא צריך שכולם יהיו בה. סלפי מהטלפון מספיק.',
      },
    ],
    sectors: {
      religious: 'דתי',
      secular: 'חילוני',
      mixed: 'מעורב',
      other: 'אחר',
    },
    camera: [
      'מעדיפים בלי',
      'קצת ביישנים',
      'זורמים',
      'נהנים',
      'תנו לנו מצלמה',
    ],
    photoPick: 'בחרו תמונה מהטלפון',
    photoReplace: 'החלפת התמונה',
    photoWorking: 'מקטינים את התמונה...',
    photoReady: (kb) => `התמונה מוכנה · ${kb} KB`,
    photoAlt: 'התמונה שנבחרה',

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
      teamName: 'צריך שם לקבוצה',
      teamSize: 'בחרו כמה אתם, בין חמישה לשמונה',
      sectors: 'סמנו לפחות מגזר אחד',
      location: 'כתבו מאיפה אתם',
      howTheyMet: 'ספרו איך אתם מכירים',
      ageRange: 'כתבו את טווח הגילאים',
      motivation: 'זו השאלה שמכריעה, אל תדלגו עליה',
      cameraComfort: 'בחרו כמה נוח לכם מול מצלמה',
      phone: 'צריך מספר טלפון נייד ישראלי תקין',
    },
    photoErrors: {
      type: 'התמונה צריכה להיות JPG, PNG או WebP',
      unreadable: 'לא הצלחנו לקרוא את התמונה. נסו תמונה אחרת',
      huge: 'התמונה גדולה מדי גם אחרי הקטנה. נסו תמונה אחרת',
    },
  },

  en: {
    title: 'RushPoint Live · The big race across Jerusalem',
    description:
      'Ten teams only, from every part of Israeli society, racing across Jerusalem for one evening. Thursday 22 October. Open to teams of 5 to 8 people.',

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
    ctaNote: 'About three minutes · Free · No commitment',
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

    formTitle: 'Nine questions. That is all.',
    formIntro:
      'There are no right answers here and nothing to prepare. We read every application, so write the way you talk. The more you sound like yourselves, the better we can tell whether you are the team we are looking for.',
    allRequired: 'All of them are short. The photo at the end is optional.',
    optionalTag: 'optional',
    choosePrompt: 'Choose a number',
    questions: [
      {
        n: '01',
        title: 'What is your team called?',
        hint: 'The name we will announce you by. Serious is fine, and so is an inside joke only you understand.',
        placeholder: 'The Eagles',
      },
      {
        n: '02',
        title: 'How many of you are there?',
        hint: 'Between five and eight. That is a condition rather than a suggestion, because it is how the missions are built.',
      },
      {
        n: '03',
        title: 'Where do you come from?',
        hint: 'Tick as many as fit. We are building an evening with everyone in it, so this helps us and never rules you out.',
      },
      {
        n: '04',
        title: 'Where do you live?',
        hint: 'A city or an area. If you are spread out, list everyone.',
        placeholder: 'Jerusalem, and two from Beit Shemesh',
      },
      {
        n: '05',
        title: 'How do you know each other?',
        hint: 'Army, youth movement, the neighbourhood, work, family. The story that ties you together is half of what we are reading for.',
        placeholder: 'We met in the youth movement five years ago and never managed to split up',
      },
      {
        n: '06',
        title: 'How old are you?',
        hint: 'The age range in the team. There is no right age.',
        placeholder: '16 to 18',
      },
      {
        n: '07',
        title: 'Why should we pick you?',
        hint: 'This is the question that decides it, and the only one with no right answer. Do not write what sounds good. Write what is true about you.',
        placeholder: 'Write it here the way you would tell a friend',
      },
      {
        n: '08',
        title: 'How comfortable are you on camera?',
        hint: 'The evening is filmed. We are not looking for actors, so answer honestly. A four and a one are both good answers.',
      },
      {
        n: '09',
        title: 'Who do we call?',
        hint: 'One number somebody actually answers. We will only call if we take it further with you.',
        placeholder: '050 000 0000',
      },
      {
        n: '10',
        title: 'Let us see you',
        hint: 'Not required, but it helps us picture you. It does not have to be professional and not everyone has to be in it. A phone selfie is plenty.',
      },
    ],
    sectors: {
      religious: 'Religious',
      secular: 'Secular',
      mixed: 'Mixed',
      other: 'Other',
    },
    camera: [
      'Rather not',
      'A bit shy',
      'Happy enough',
      'We enjoy it',
      'Give us the camera',
    ],
    photoPick: 'Choose a photo from your phone',
    photoReplace: 'Change the photo',
    photoWorking: 'Shrinking the photo...',
    photoReady: (kb) => `Photo ready · ${kb} KB`,
    photoAlt: 'The photo you chose',

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
      teamName: 'Your team needs a name',
      teamSize: 'Choose how many you are, between five and eight',
      sectors: 'Tick at least one',
      location: 'Tell us where you live',
      howTheyMet: 'Tell us how you know each other',
      ageRange: 'Give us the age range',
      motivation: 'This is the question that decides it, do not skip it',
      cameraComfort: 'Choose how you feel about the camera',
      phone: 'We need a valid Israeli mobile number',
    },
    photoErrors: {
      type: 'The photo needs to be a JPG, PNG or WebP',
      unreadable: 'We could not read that photo. Try another one',
      huge: 'That photo is still too large after shrinking. Try another one',
    },
  },
};
