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
  /**
   * The fallback channel. The form is the only path INTO the API, and the API
   * has exactly one origin allow list to misconfigure between here and a reply
   * (see DEPLOY.md section 12C). A direct address is what keeps a broken form
   * from being a broken contact page: it needs no JavaScript, no callable and no
   * CORS entry, so it works even in the specific failure mode the form itself
   * cannot detect from the browser.
   */
  directEmailLabel: string;
}

/**
 * The one address published as a fallback, never as the primary path: the form
 * stores a structured, rate limited, audit logged record, and a plain inbox
 * reply carries none of that.
 */
export const CONTACT_FALLBACK_EMAIL = 'spendora.tracker@gmail.com';

/**
 * A note on `errorOffline`. It is shown when `fetch` THROWS, which the browser does
 * for a genuine network failure AND for a request the server refused at the CORS
 * layer, because a refused response is unreadable from script and therefore
 * indistinguishable from never arriving. The two have completely different causes
 * and only one of them is the reader's fault, so the wording says what we know
 * ("we could not reach the server") rather than what we are guessing ("you are
 * offline"). Telling someone to check their connection when the actual cause is a
 * missing entry in our own allow list sends them to fix something that is not
 * broken. See DEPLOY.md section 12C.
 */
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
    directEmailLabel: 'אפשר גם לכתוב ישירות למייל',
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
    errorOffline: 'We could not reach the server. Your message is still here on screen, so nothing is lost. Try again in a moment.',
    errorUnknown: 'The message was not sent. You can try again, and your message stays here meanwhile.',
    otherWaysTitle: 'Looking for something else',
    otherWaysBody: 'If you just want to see how it works, you can open a game and try it without sending anything.',
    directEmailLabel: 'You can also write directly to',
  },
};
