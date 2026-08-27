/**
 * Blog chrome copy, per language. The posts themselves are content files.
 *
 * Change: marketing-site.
 */
import type { Language } from '~/utils/i18n';

export interface BlogCopy {
  title: string;
  description: string;
  headline: string;
  intro: string;
  empty: string;
  readMore: string;
  backToBlog: string;
  publishedOn: string;
}

export const blogCopy: Record<Language, BlogCopy> = {
  he: {
    title: 'הבלוג',
    description: 'רעיונות למשחקי שדה, מה עובד בשטח ומה לא, ומה למדנו מאירועים אמיתיים.',
    headline: 'מה למדנו בשטח',
    intro: 'רעיונות למשימות, טעויות ששווה לא לחזור עליהן, ודברים שגילינו רק כשאנשים באמת שיחקו.',
    empty: 'עוד לא פורסמו כאן פוסטים. חוזרים בקרוב.',
    readMore: 'להמשך קריאה',
    backToBlog: 'חזרה לבלוג',
    publishedOn: 'פורסם ב',
  },
  en: {
    title: 'Blog',
    description: 'Ideas for field games, what works outside and what does not, and what real events taught us.',
    headline: 'What we learned outside',
    intro: 'Task ideas, mistakes worth not repeating, and things we only found out once people actually played.',
    empty: 'No posts published here yet. Back soon.',
    readMore: 'Read more',
    backToBlog: 'Back to the blog',
    publishedOn: 'Published on',
  },
};
