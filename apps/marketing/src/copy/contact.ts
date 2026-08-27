/**
 * Contact page copy, per language, including every state the form can report.
 *
 * Every outcome gets its own sentence. A form that fails without saying why is
 * the same defect as a callable that returns success having stored nothing: the
 * person is left guessing, and guessing usually means sending it again.
 *
 * Change: marketing-site.
 */
import type { Language } from '~/utils/i18n';

export interface ContactCopy {
  title: string;
  description: string;
  headline: string;
  intro: string;
  nameLabel: string;
  emailLabel: string;
  messageLabel: string;
  submit: string;
  sending: string;
  successTitle: string;
  successBody: string;
  errorInvalid: string;
  errorRateLimited: string;
  errorOffline: string;
  errorUnknown: string;
  otherWaysTitle: string;
  otherWaysBody: string;
}

export const contactCopy: Record<Language, ContactCopy> = {
  he: {
    title: 'דברו איתנו',
    description: 'שאלה, רעיון, בעיה או בקשה לאירוע. כתבו לנו ונחזור אליכם.',
    headline: 'דברו איתנו',
    intro:
      'אם משהו לא עובד, אם חסר לכם משהו, או אם אתם מתלבטים אם RushPoint מתאים לאירוע שלכם, כתבו. אנחנו קוראים הכול.',
    nameLabel: 'איך קוראים לכם',
    emailLabel: 'כתובת מייל לחזרה',
    messageLabel: 'מה רציתם להגיד',
    submit: 'שליחה',
    sending: 'שולח',
    successTitle: 'ההודעה נשלחה',
    successBody: 'תודה. נחזור אליכם לכתובת שהשארתם.',
    errorInvalid: 'משהו בטופס לא תקין. בדקו שהשם, המייל וההודעה מלאים ושההודעה לא ארוכה מדי.',
    errorRateLimited: 'נשלחו יותר מדי הודעות מהמכשיר הזה. נסו שוב בעוד כמה דקות.',
    errorOffline: 'אין כרגע חיבור לשרת. ההודעה עדיין כאן על המסך, נסו שוב כשהחיבור חוזר.',
    errorUnknown: 'ההודעה לא נשלחה. אפשר לנסות שוב, וההודעה נשארת כאן בינתיים.',
    otherWaysTitle: 'מחפשים משהו אחר',
    otherWaysBody: 'אם אתם רק רוצים לראות איך זה עובד, אפשר לפתוח משחק ולהתנסות בלי לשלוח כלום.',
  },
  en: {
    title: 'Contact us',
    description: 'A question, an idea, a problem, or a request about an event. Write and we will reply.',
    headline: 'Contact us',
    intro:
      'If something is not working, if something is missing, or if you are not sure whether RushPoint suits your event, write. We read all of it.',
    nameLabel: 'Your name',
    emailLabel: 'Email to reply to',
    messageLabel: 'What you wanted to say',
    submit: 'Send',
    sending: 'Sending',
    successTitle: 'Message sent',
    successBody: 'Thank you. We will reply to the address you left.',
    errorInvalid: 'Something in the form is not valid. Check that name, email and message are filled in, and that the message is not too long.',
    errorRateLimited: 'Too many messages have been sent from this device. Try again in a few minutes.',
    errorOffline: 'There is no connection to the server right now. Your message is still here on screen, try again once you are back online.',
    errorUnknown: 'The message was not sent. You can try again, and your message stays here meanwhile.',
    otherWaysTitle: 'Looking for something else',
    otherWaysBody: 'If you just want to see how it works, you can open a game and try it without sending anything.',
  },
};
