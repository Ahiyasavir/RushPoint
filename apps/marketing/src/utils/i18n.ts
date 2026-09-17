/**
 * The site's languages, its origin, and every URL derived from them.
 *
 * This is the SINGLE definition. `scripts/lib/marketingSite.ts` re-exports it
 * rather than restating it, so the test lane and the pages it checks cannot
 * describe two different sites. Deliberately dependency free (no `~/` alias, no
 * astro imports) so a plain tsx process can load it.
 *
 * Change: marketing-site.
 */

/** No trailing slash. Every derived URL appends its own leading slash. */
export const SITE_ORIGIN = 'https://rush-point.com';

/**
 * Where the contact form posts. The self hosted API, the same one the two apps
 * call, declared here so the site names it ONCE: a host spelled inline in a page
 * script is a host nobody finds when it moves.
 *
 * ⚠ The API refuses a browser origin that is not in its `ALLOWED_ORIGINS`
 * environment variable (functions/server.js). SITE_ORIGIN has to be in that list
 * or every submission comes back 403 while the site itself looks perfectly
 * healthy. That is a VPS step, not a build step, and it is in DEPLOY.md.
 */
export const API_ORIGIN = 'https://api.rush-point.com';

/**
 * The participant app (change: marketing-to-apex).
 *
 * This site took the apex, so the player app answers on its own subdomain now.
 * Declared here with the other origins rather than inline at each link, for the
 * same reason API_ORIGIN is: a host spelled inline is a host nobody finds when it
 * moves, and this one just moved.
 */
export const PLAYER_ORIGIN = 'https://player.rush-point.com';

/** The two languages the site publishes, in the order menus should offer them. */
export const LANGUAGES = ['he', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

/** Which language a reader is sent to when none of theirs matched. */
export const X_DEFAULT_LANGUAGE: Language = 'en';

/** The hreflang value published for each language. */
export const HREFLANG: Readonly<Record<Language, string>> = {
  he: 'he-IL',
  en: 'en',
};

/** Text direction. Hebrew is RTL; this is not a preference. */
export const DIRECTION: Readonly<Record<Language, 'rtl' | 'ltr'>> = {
  he: 'rtl',
  en: 'ltr',
};

/** The Open Graph locale for each language. */
export const OG_LOCALE: Readonly<Record<Language, string>> = {
  he: 'he_IL',
  en: 'en_US',
};

/** What each language calls itself, for the language switch. */
export const LANGUAGE_NAME: Readonly<Record<Language, string>> = {
  he: 'עברית',
  en: 'English',
};

/**
 * The counterpart language. Arithmetic rather than a lookup table: a table can
 * disagree with itself, and an asymmetric hreflang cluster is invisible on the
 * page until a search engine quietly stops treating the two as counterparts.
 */
export function otherLanguage(language: Language): Language {
  return language === 'he' ? 'en' : 'he';
}

/**
 * The STANDING pages: the ones that exist in both languages by definition.
 * `''` is the language home page.
 *
 * Blog posts are deliberately absent. A post declares one language and is not
 * required to have a counterpart: demanding one would either block publishing
 * until a translation exists or produce the machine translated Hebrew this site
 * refuses to ship.
 */
// `live` joined this list when the page became bilingual (change:
// rushpoint-live-english). It belongs here now BY DEFINITION: a standing page
// is one that exists in both languages, and both exist. Being here is what
// gives it a symmetric hreflang cluster and makes the language switch land on
// the counterpart page instead of the other language's home. It does NOT put
// it in the menu — the header's links are an explicit list in navigation.ts.
export const STANDING_SUBJECTS = ['', 'story', 'contact', 'blog', 'live'] as const;
export type StandingSubject = (typeof STANDING_SUBJECTS)[number];

/** The URL path for a page. `subject` identifies it across languages. */
export function pagePath(language: Language, subject: string): string {
  return subject === '' ? `/${language}/` : `/${language}/${subject}/`;
}

/** The absolute URL for a page: also its canonical and its `og:url`. */
export function pageUrl(language: Language, subject: string): string {
  return `${SITE_ORIGIN}${pagePath(language, subject)}`;
}

/** The URL path for a post. Derived from its declared slug, never its title. */
export function postPath(language: Language, slug: string): string {
  return `/${language}/blog/${slug}/`;
}

export function postUrl(language: Language, slug: string): string {
  return `${SITE_ORIGIN}${postPath(language, slug)}`;
}

export interface Alternate {
  readonly hreflang: string;
  readonly href: string;
}

/**
 * The complete alternate set for a standing page: a self referencing entry, its
 * counterpart, and exactly one x-default. Symmetry holds because both pages of a
 * pair run this same derivation over the same subject.
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

/** Every standing page, both languages. */
export function standingPages(): Array<{ language: Language; subject: string; path: string }> {
  return LANGUAGES.flatMap((language) =>
    STANDING_SUBJECTS.map((subject) => ({
      language,
      subject,
      path: pagePath(language, subject),
    })),
  );
}

/**
 * The RushPoint Live application page.
 *
 * It WAS Hebrew only and deliberately absent from STANDING_SUBJECTS, on the
 * reasoning that an English page would advertise a Jerusalem race to people who
 * cannot attend. That was half right: it is a race for people IN Israel, which is
 * not the same as people who read Hebrew, and a large part of the country reads
 * English first (change: rushpoint-live-english).
 *
 * So both languages exist, it is a standing subject like any other, and WHERE a
 * visitor is — not which language they read — decides whether the home page band
 * appears. See utils/israelAudience.ts, and note the page itself is never gated.
 */
export const liveEventPath = (language: Language): string => pagePath(language, 'live');
export const liveEventUrl = (language: Language): string => pageUrl(language, 'live');

/**
 * The Instagram account (change: rushpoint-live-instagram).
 *
 * Following it is a CONDITION OF ENTRY to RushPoint Live, so the handle is
 * declared here with the other addresses rather than spelled inline at each link:
 * an account name typed into three files is an account name nobody finds when it
 * changes, and one of those three silently sends applicants to a dead profile.
 */
export const INSTAGRAM_HANDLE = 'ahiyasavir';
export const INSTAGRAM_URL = `https://instagram.com/${INSTAGRAM_HANDLE}`;

/**
 * TikTok. A DIFFERENT handle from the Instagram one above, which is exactly why
 * both are declared here rather than being derived from a single brand name: a
 * `@${INSTAGRAM_HANDLE}` typed into a TikTok link would point at a profile that
 * is not ours and would look right in review.
 */
export const TIKTOK_HANDLE = 'ahiyasavir09';
export const TIKTOK_URL = `https://tiktok.com/@${TIKTOK_HANDLE}`;

/**
 * Facebook. A NUMERIC profile url, not a vanity one, so there is no handle to
 * display and the link is labelled by the network instead. Written out in full
 * rather than assembled from an id, because `profile.php?id=` is the whole shape
 * of the address and splitting it would invite someone to "tidy" it into a
 * /username form that does not resolve.
 */
export const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61593391145817';

/**
 * A direct address to fall back to when the contact form cannot reach the API.
 *
 * Configuration rather than copy: it is the same in both languages, and it must
 * not be something an editor can change in one language and not the other.
 */
export const CONTACT_FALLBACK_EMAIL = 'admin.rushpoint@gmail.com';
