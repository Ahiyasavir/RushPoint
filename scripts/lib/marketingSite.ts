/**
 * The marketing site's declared origin, and the derivations that hang off it.
 *
 * ONE declaration. Moving the site to a different address must be a change to
 * this constant plus DNS, never a search and replace through built markup, so
 * nothing else in the repository may name the host. `apps/marketing/src/config.yaml`
 * carries the same value for Astro's own use, and
 * `scripts/test-marketing-output.ts` asserts the built output agrees with what
 * is declared here.
 *
 * Why `www.` and not the apex: the apex currently serves play-web, and this site
 * is meant to become the primary address later without rework. Putting it on a
 * real host of the canonical domain now (never a *.web.app host, see the
 * canonical-domain rule) means the eventual move is a DNS decision rather than a
 * rebuild.
 *
 * Change: marketing-site.
 */

/** No trailing slash. Every derived URL appends its own leading slash. */
export const SITE_ORIGIN = 'https://www.rush-point.com';

/** The two languages the site publishes, in the order menus should offer them. */
export const LANGUAGES = ['he', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Which language a reader is sent to when none of theirs matched. */
export const X_DEFAULT_LANGUAGE: Language = 'en';

/** The hreflang value published for each language. */
export const HREFLANG: Readonly<Record<Language, string>> = {
  he: 'he-IL',
  en: 'en',
};

/** Text direction per language. Hebrew is RTL; this is not a preference. */
export const DIRECTION: Readonly<Record<Language, 'rtl' | 'ltr'>> = {
  he: 'rtl',
  en: 'ltr',
};

/**
 * The counterpart of a page in the other language, derived by swapping the
 * language prefix. Deliberately arithmetic rather than a lookup table: a table
 * can disagree with itself, and an asymmetric hreflang cluster is invisible
 * until a search engine quietly treats two pages as duplicates.
 */
export function otherLanguage(language: Language): Language {
  return language === 'he' ? 'en' : 'he';
}

/**
 * The URL path for a page. `subject` is the stable slug that identifies the
 * page across languages (`''` for a language home page).
 */
export function pagePath(language: Language, subject: string): string {
  return subject === '' ? `/${language}/` : `/${language}/${subject}/`;
}

/** The absolute URL for a page, which is also its canonical and its `og:url`. */
export function pageUrl(language: Language, subject: string): string {
  return `${SITE_ORIGIN}${pagePath(language, subject)}`;
}

export interface Alternate {
  readonly hreflang: string;
  readonly href: string;
}

/**
 * The complete alternate set for a page: a self referencing entry, its
 * counterpart, and exactly one x-default. Symmetry holds because both pages of
 * a pair run this same derivation over the same subject.
 */
export function alternatesFor(subject: string): Alternate[] {
  return [
    ...LANGUAGES.map((language) => ({
      hreflang: HREFLANG[language],
      href: pageUrl(language, subject),
    })),
    { hreflang: 'x-default', href: pageUrl(X_DEFAULT_LANGUAGE, subject) },
  ];
}
