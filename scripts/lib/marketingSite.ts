/**
 * The marketing site's languages and URL derivations, for the test lane.
 *
 * This is a RE-EXPORT, not a second definition. The site itself reads
 * `apps/marketing/src/utils/i18n.ts`, and a test that restated those values
 * would be checking the output against its own copy of the answer rather than
 * against what the site was built from: the two could drift and every assertion
 * would still pass.
 *
 * Change: marketing-site.
 */
export {
  SITE_ORIGIN,
  LANGUAGES,
  X_DEFAULT_LANGUAGE,
  HREFLANG,
  DIRECTION,
  OG_LOCALE,
  LANGUAGE_NAME,
  STANDING_SUBJECTS,
  isLanguage,
  otherLanguage,
  pagePath,
  pageUrl,
  postPath,
  postUrl,
  alternatesFor,
  standingPages,
  type Language,
  type StandingSubject,
  type Alternate,
} from '../../apps/marketing/src/utils/i18n.ts';
