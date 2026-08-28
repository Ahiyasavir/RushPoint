/**
 * Header and footer navigation, per language.
 *
 * Both are FUNCTIONS of the language rather than constants: a Hebrew page that
 * renders an English menu is the exact bug the i18n gate exists to catch in the
 * two React apps, and this site has no dictionary to catch it for us. Taking the
 * language as an argument means a page cannot forget to pass one.
 *
 * Change: marketing-site.
 */
import { pagePath, otherLanguage, LANGUAGE_NAME, type Language } from './utils/i18n';

/** Where a reader goes to actually use the product. */
const CREATOR_APP = 'https://creator.rush-point.com';
/** The participant origin, which also serves the occasion landing pages. */
const PLAY_ORIGIN = 'https://rush-point.com';

/**
 * The occasion landing pages (change: seo-landing-pages). Linking to them is a
 * requirement, not decoration: without it the two page sets are islands that
 * pass no signal to each other. The language must match the page carrying the
 * link, so a Hebrew reader is not handed an English destination.
 */
export const landingPageUrl = (language: Language, slug = ''): string =>
  slug === '' ? `${PLAY_ORIGIN}/${language}/` : `${PLAY_ORIGIN}/${language}/${slug}/`;

interface Copy {
  home: string;
  story: string;
  blog: string;
  contact: string;
  ideas: string;
  startBuilding: string;
  /** For a visitor who came to PLAY, not to build: a door to the player app. */
  joinGame: string;
  legal: string;
  terms: string;
  privacy: string;
  product: string;
  footNote: string;
  // Accessible names. These are read aloud, so an English label on a Hebrew
  // page is the same leak as visible English copy, just harder to notice.
  toggleMenu: string;
  toggleTheme: string;
  mainNav: string;
  /**
   * The skip link. Unlike the labels above it is VISIBLE once focused, so it is
   * read as well as heard, and a keyboard user is the only person who ever sees
   * it: getting its language wrong is invisible to everyone who would notice.
   */
  skipToContent: string;
  /**
   * The founder video's controls (change: marketing-home-front-door).
   *
   * Chrome, not marketing copy, which is why they live here beside `toggleMenu`
   * and not in the CMS: an author asked to translate "turn on sound" is being
   * asked to maintain a control, and a control they leave blank has no
   * accessible name at all. The video plays muted on its own; these labels are
   * the play affordance a reduced motion visitor sees and the unmute button
   * everyone else does.
   */
  playVideo: string;
  unmuteVideo: string;
}

const COPY: Record<Language, Copy> = {
  he: {
    home: 'ראשי',
    story: 'הסיפור שלנו',
    blog: 'הבלוג',
    contact: 'דברו איתנו',
    ideas: 'רעיונות לפי סוג אירוע',
    startBuilding: 'בונים משחק',
    joinGame: 'יש לי קוד',
    legal: 'מידע משפטי',
    terms: 'תנאי שימוש',
    privacy: 'מדיניות פרטיות',
    product: 'המוצר',
    footNote: 'RushPoint. המשחק יוצא החוצה.',
    toggleMenu: 'פתיחת התפריט',
    toggleTheme: 'מעבר בין מצב בהיר לכהה',
    mainNav: 'ניווט ראשי',
    skipToContent: 'דילוג לתוכן',
    playVideo: 'הפעלת הסרטון',
    unmuteVideo: 'הפעלת הקול',
  },
  en: {
    home: 'Home',
    story: 'Our story',
    blog: 'Blog',
    contact: 'Contact',
    ideas: 'Ideas by occasion',
    startBuilding: 'Build a game',
    joinGame: 'I have a code',
    legal: 'Legal',
    terms: 'Terms of Service',
    privacy: 'Privacy Policy',
    product: 'Product',
    footNote: 'RushPoint. The game goes outside.',
    toggleMenu: 'Open the menu',
    toggleTheme: 'Switch between light and dark mode',
    mainNav: 'Main navigation',
    skipToContent: 'Skip to content',
    playVideo: 'Play the video',
    unmuteVideo: 'Turn on sound',
  },
};

/**
 * Accessible names for interface controls that carry no visible text.
 *
 * Same rule as `headerData`: a function of the language, so a page cannot render
 * one language's chrome on the other language's document by forgetting an
 * argument.
 */
export const mediaLabels = (language: Language) => ({
  playVideo: COPY[language].playVideo,
  unmuteVideo: COPY[language].unmuteVideo,
});

/**
 * @param counterpartHref Where the language switch should go: the SAME page in
 *   the other language. Passed in rather than derived here, because the only
 *   thing that knows a page's counterpart is the page, and it already computes
 *   it for its hreflang cluster. Threading that same value through means the
 *   switch and the cluster cannot disagree: a reader and a crawler are told the
 *   same thing about where the other version lives.
 *
 *   Omitted for a page that genuinely has no counterpart (an unpaired post), in
 *   which case the switch falls back to the other language's home. That is the
 *   honest answer rather than a link to a page that does not exist.
 */
export const headerData = (language: Language, counterpartHref?: string) => {
  const t = COPY[language];
  const other = otherLanguage(language);

  return {
    labels: { toggleMenu: t.toggleMenu, toggleTheme: t.toggleTheme, mainNav: t.mainNav },
    skipToContent: t.skipToContent,
    links: [
      { text: t.home, href: pagePath(language, '') },
      { text: t.story, href: pagePath(language, 'story') },
      { text: t.blog, href: pagePath(language, 'blog') },
      { text: t.contact, href: pagePath(language, 'contact') },
    ],
    actions: [
      // The language switch is an ordinary link to the counterpart page, so it
      // works with scripting disabled and reads as a real destination. It used to
      // point at the other language's HOME regardless of where the reader was,
      // which sent someone halfway through the story back to the front page to
      // find their place again.
      {
        text: LANGUAGE_NAME[other],
        href: counterpartHref ?? pagePath(other, ''),
        variant: 'secondary' as const,
      },
      // Two doors, always both visible. A creator pays and is the reason the
      // product exists, so "build" is the emphasised one; but a participant who
      // followed a link here and just wants to enter a code must not have to
      // read a marketing page to find the way in.
      { text: t.joinGame, href: `${PLAY_ORIGIN}/`, variant: 'tertiary' as const, target: '_blank' },
      { text: t.startBuilding, href: CREATOR_APP, target: '_blank' },
    ],
  };
};

export const footerData = (language: Language) => {
  const t = COPY[language];

  return {
    links: [
      {
        title: t.product,
        links: [
          { text: t.startBuilding, href: CREATOR_APP },
          { text: t.ideas, href: landingPageUrl(language, '') },
          { text: t.blog, href: pagePath(language, 'blog') },
        ],
      },
      {
        title: t.legal,
        links: [
          { text: t.terms, href: `${PLAY_ORIGIN}/terms` },
          { text: t.privacy, href: `${PLAY_ORIGIN}/privacy` },
        ],
      },
    ],
    secondaryLinks: [
      { text: t.story, href: pagePath(language, 'story') },
      { text: t.contact, href: pagePath(language, 'contact') },
    ],
    socialLinks: [],
    footNote: t.footNote,
  };
};
