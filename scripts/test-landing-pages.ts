// Pure-logic tests for the static SEO landing pages (change: seo-landing-pages).
//
// WHY THIS EXISTS: every failure mode of this feature is INVISIBLE. An asymmetric
// hreflang cluster, a canonical pointing at the wrong language, a sitemap entry for a
// file that was renamed, a page that quietly stopped being paired — none of them throw,
// none of them look wrong in a browser, and all of them surface (if at all) in Search
// Console weeks later as "alternate page with proper canonical tag" or simply as a page
// that never gets indexed. A human reviewing twelve documents that each carry a title, a
// description, a canonical, three alternates, six Open Graph tags, three Twitter tags and
// a JSON-LD block is not going to catch the one that drifted.
//
// So the relationships are DERIVED in scripts/lib/landingPages.ts and asserted here.
// Nothing positional is hand-authored: a page's alternates come from swapping its
// language prefix, so symmetry holds because it cannot not hold.
//
// The language-correctness section imports hasEnglishWord/hasHebrew from
// scripts/lib/i18nLeak.ts rather than writing its own regex. That file exists precisely
// because the rule used to live in two places and both copies carried the same defect.
// A third copy here would be the same mistake a third time.
//
// No emulator.  npx tsx scripts/test-landing-pages.ts
import {
  LANDING_PAGES,
  LANDING_SUBJECTS,
  LANDING_LANGUAGES,
  LANDING_ORIGIN,
  HOME_SUBJECT,
  landingPageUrl,
  alternatesFor,
  renderLandingPage,
  CREATOR_ORIGIN,
  LANDING_PUBLIC_DIR,
  STATIC_SITE_URLS,
  landingPageFile,
  sitemapXml,
  type LandingPage,
} from './lib/landingPages';
import { hasEnglishWord, hasHebrew } from './lib/i18nLeak';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const pages: readonly LandingPage[] = LANDING_PAGES;

// ── PART A — THE REGISTRY IS WELL FORMED ─────────────────────────────────────

check('A · the registry is not empty', pages.length > 0, `${pages.length} page(s)`);

check('A · every subject exists in every language',
  pages.length === LANDING_SUBJECTS.length * LANDING_LANGUAGES.length,
  `${pages.length} pages for ${LANDING_SUBJECTS.length} subjects x ${LANDING_LANGUAGES.length} languages`);

// Pairing is one-to-one. A subject with a Hebrew page and no English counterpart is the
// single most likely way this registry rots, and it produces an hreflang annotation
// pointing at a URL that 404s — which Google reads as the whole cluster being untrusted,
// not just the one entry.
{
  const unpaired: string[] = [];
  for (const subject of LANDING_SUBJECTS) {
    for (const lang of LANDING_LANGUAGES) {
      const found = pages.filter((p) => p.subject === subject && p.language === lang);
      if (found.length !== 1) unpaired.push(`${subject}/${lang} => ${found.length}`);
    }
  }
  check('A · every (subject, language) pair appears exactly once',
    unpaired.length === 0, unpaired.join(' | '));
}

// Slugs stay Latin in BOTH languages. Hebrew has two valid Unicode encodings (composed
// NFC and decomposed NFD); a path that mixes them matches nothing, silently. Latin slugs
// sidestep the entire class, and identical slugs across languages are what make the
// counterpart derivable by prefix swap instead of by lookup table.
{
  const bad: string[] = [];
  for (const p of pages) {
    if (!/^[a-z0-9-]*$/.test(p.slug)) bad.push(`${p.subject}/${p.language} => "${p.slug}"`);
  }
  check('A · every slug is lowercase Latin, digits and hyphens only',
    bad.length === 0, bad.join(' | '));
}

// The slug identifies the SUBJECT, not the page, so both languages of a subject share it.
{
  const mismatched: string[] = [];
  for (const subject of LANDING_SUBJECTS) {
    const slugs = new Set(pages.filter((p) => p.subject === subject).map((p) => p.slug));
    if (slugs.size !== 1) mismatched.push(`${subject} => ${[...slugs].join(',')}`);
  }
  check('A · both languages of a subject share one slug',
    mismatched.length === 0, mismatched.join(' | '));
}

// ── PART B — NO TWO PAGES COMPETE AS DUPLICATES ──────────────────────────────
//
// Two pages sharing a title or a description are two pages asking Google to rank them
// for the same thing. Google picks one and drops the other, and which one it drops is
// not the author's decision.

function assertUnique(label: string, values: Array<[string, string]>): void {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const [owner, value] of values) {
    const prior = seen.get(value);
    if (prior !== undefined) dupes.push(`"${value}" on both ${prior} and ${owner}`);
    else seen.set(value, owner);
  }
  check(label, dupes.length === 0, dupes.join(' | '));
}

const id = (p: LandingPage) => `${p.language}/${p.subject}`;

assertUnique('B · every title is unique across all pages',
  pages.map((p) => [id(p), p.title] as [string, string]));

assertUnique('B · every description is unique across all pages',
  pages.map((p) => [id(p), p.description] as [string, string]));

// A title or description that is present but empty passes a "unique" test trivially and
// then ships an untitled page, so presence is asserted separately from uniqueness.
{
  const empty: string[] = [];
  for (const p of pages) {
    if (p.title.trim() === '') empty.push(`${id(p)} title`);
    if (p.description.trim() === '') empty.push(`${id(p)} description`);
  }
  check('B · no title or description is empty', empty.length === 0, empty.join(' | '));
}

// ── PART C — THE CANONICAL URL SHAPE ─────────────────────────────────────────
//
// One canonical form, computed once. A trailing slash difference is not cosmetic: to a
// crawler `/he/hatuna` and `/he/hatuna/` are two URLs, and if the canonical says one
// while the sitemap says the other, the page argues with itself about which it is.
// Directory-index hosting serves the trailing-slash form, so that is the form.

{
  const bad: string[] = [];
  for (const p of pages) {
    const url = landingPageUrl(p);
    const expected = p.subject === HOME_SUBJECT
      ? `${LANDING_ORIGIN}/${p.language}/`
      : `${LANDING_ORIGIN}/${p.language}/${p.slug}/`;
    if (url !== expected) bad.push(`${id(p)} => "${url}" expected "${expected}"`);
  }
  check('C · every URL is absolute, language prefixed, and ends in a slash',
    bad.length === 0, bad.join(' | '));
}

// The home page of a language serves at the language root, so it must NOT pick up an
// extra empty path segment from its empty slug (`/he//` is a different URL again).
{
  const homes = pages.filter((p) => p.subject === HOME_SUBJECT).map((p) => landingPageUrl(p));
  check('C · a language home has no empty extra segment',
    homes.every((u) => !u.includes('//', 'https://'.length)), homes.join(' | '));
}

// Two pages resolving to one URL means one of them is unreachable, and which one wins is
// decided by the filesystem rather than by anyone's intent.
assertUnique('C · no two pages resolve to the same URL',
  pages.map((p) => [id(p), landingPageUrl(p)] as [string, string]));

// ── PART D — THE HREFLANG CLUSTER ────────────────────────────────────────────
//
// Roughly three quarters of hreflang implementations on the web are broken, and the
// reason is always the same: the annotations are AUTHORED, so keeping N pages agreeing
// with each other is manual work that silently stops being done. Here they are DERIVED
// by swapping the language prefix, so the properties below are structural. The tests
// exist to prove the derivation stayed structural, not to check somebody's typing.

const LEGAL_HREFLANG = new Set(['he-IL', 'en', 'x-default']);

{
  const bad: string[] = [];
  for (const p of pages) {
    const alts = alternatesFor(p);
    if (alts.length !== 3) bad.push(`${id(p)} has ${alts.length} alternates`);
    for (const a of alts) {
      if (!LEGAL_HREFLANG.has(a.hreflang)) bad.push(`${id(p)} illegal hreflang "${a.hreflang}"`);
      if (!a.href.startsWith(LANDING_ORIGIN + '/')) bad.push(`${id(p)} relative href "${a.href}"`);
    }
  }
  check('D · every page names exactly three alternates, all legal and absolute',
    bad.length === 0, bad.join(' | '));
}

// A page that does not name ITSELF is the classic broken cluster: Google reads the set as
// describing some other group of pages and discards the annotation entirely.
{
  const missing: string[] = [];
  for (const p of pages) {
    const self = alternatesFor(p).find((a) => a.href === landingPageUrl(p) && a.hreflang !== 'x-default');
    const expectedTag = p.language === 'he' ? 'he-IL' : 'en';
    if (!self) missing.push(`${id(p)} names no self entry`);
    else if (self.hreflang !== expectedTag) missing.push(`${id(p)} self tagged "${self.hreflang}"`);
  }
  check('D · every page names itself, tagged with its own language',
    missing.length === 0, missing.join(' | '));
}

// x-default is the fallback for every visitor the targeted annotations do NOT match,
// which is by definition an international audience. It points at English on purpose:
// `he-IL` is a language plus region target for the primary market, and answering a
// visitor in neither language with Hebrew serves them worse than answering in English.
{
  const bad: string[] = [];
  for (const p of pages) {
    const defaults = alternatesFor(p).filter((a) => a.hreflang === 'x-default');
    if (defaults.length !== 1) { bad.push(`${id(p)} has ${defaults.length} x-default entries`); continue; }
    const english = pages.find((q) => q.subject === p.subject && q.language === 'en')!;
    if (defaults[0].href !== landingPageUrl(english)) {
      bad.push(`${id(p)} x-default points at "${defaults[0].href}"`);
    }
  }
  check('D · exactly one x-default per page, pointing at the English page of that subject',
    bad.length === 0, bad.join(' | '));
}

// Symmetry: if A names B, B must name A. An asymmetric cluster is ignored wholesale, so
// this is the property that decides whether any of the annotations do anything at all.
{
  const asymmetric: string[] = [];
  const byUrl = new Map(pages.map((p) => [landingPageUrl(p), p]));
  for (const a of pages) {
    for (const alt of alternatesFor(a)) {
      const b = byUrl.get(alt.href);
      if (!b) { asymmetric.push(`${id(a)} names unknown "${alt.href}"`); continue; }
      const namesBack = alternatesFor(b).some((back) => back.href === landingPageUrl(a));
      if (!namesBack) asymmetric.push(`${id(a)} names ${id(b)} but not the reverse`);
    }
  }
  check('D · the alternate relation is symmetric across every page',
    asymmetric.length === 0, asymmetric.join(' | '));
}

// The gate is only worth its reach: assert it actually examined every page's cluster, so
// a registry reshape that makes the loops iterate nothing fails instead of passing.
check('D · the hreflang checks reached every page',
  pages.reduce((n, p) => n + alternatesFor(p).length, 0) === pages.length * 3,
  `${pages.reduce((n, p) => n + alternatesFor(p).length, 0)} annotation(s)`);

// ── PART E — THE RENDERED DOCUMENT ───────────────────────────────────────────

const rendered = new Map<string, string>(pages.map((p) => [id(p), renderLandingPage(p)]));
const html = (p: LandingPage) => rendered.get(id(p))!;

/** Read one `<meta name|property="k" content="v">` value out of a document. */
function metaOf(doc: string, key: string): string | null {
  const re = new RegExp(`<meta\\s+(?:name|property)="${key.replace(/[:]/g, '\\:')}"\\s+content="([^"]*)"`);
  return re.exec(doc)?.[1] ?? null;
}

// A page that declares Hebrew but lays out left to right is broken for every reader, and
// a page whose declared language disagrees with its copy misleads the crawler about what
// it even is.
{
  const bad: string[] = [];
  for (const p of pages) {
    const doc = html(p);
    const expectedDir = p.language === 'he' ? 'rtl' : 'ltr';
    if (!doc.includes(`lang="${p.language}"`)) bad.push(`${id(p)} missing lang="${p.language}"`);
    if (!doc.includes(`dir="${expectedDir}"`)) bad.push(`${id(p)} missing dir="${expectedDir}"`);
  }
  check('E · lang and dir agree with the page language', bad.length === 0, bad.join(' | '));
}

// The full signal set. Absence of any one of these is a page Google can index but cannot
// describe, which in practice means a search result with a title Google invented.
const REQUIRED_META = [
  'description', 'og:type', 'og:title', 'og:description', 'og:url', 'og:image', 'og:locale',
  'twitter:card', 'twitter:title', 'twitter:description',
];
{
  const missing: string[] = [];
  for (const p of pages) {
    const doc = html(p);
    const title = /<title>([\s\S]*?)<\/title>/.exec(doc)?.[1] ?? '';
    if (title.trim() === '') missing.push(`${id(p)} empty or absent <title>`);
    for (const key of REQUIRED_META) {
      const v = metaOf(doc, key);
      if (v === null || v.trim() === '') missing.push(`${id(p)} missing ${key}`);
    }
    if (!/<link\s+rel="canonical"\s+href="[^"]+"/.test(doc)) missing.push(`${id(p)} missing canonical`);
  }
  check('E · every page carries the full metadata set', missing.length === 0, missing.join(' | '));
}

// The canonical must name THIS page, and og:url must agree with it. A canonical pointing
// at the other language is how a bilingual site accidentally tells Google that half its
// pages are duplicates of the other half and should be dropped.
{
  const bad: string[] = [];
  for (const p of pages) {
    const doc = html(p);
    const canonical = /<link\s+rel="canonical"\s+href="([^"]+)"/.exec(doc)?.[1] ?? '';
    const ogUrl = metaOf(doc, 'og:url') ?? '';
    if (canonical !== landingPageUrl(p)) bad.push(`${id(p)} canonical "${canonical}"`);
    if (ogUrl !== canonical) bad.push(`${id(p)} og:url "${ogUrl}" != canonical "${canonical}"`);
  }
  check('E · canonical is self referencing and og:url agrees with it',
    bad.length === 0, bad.join(' | '));
}

// The rendered title and description must be the registry's, not something the renderer
// invented. PART B already proved those are unique, so this carries uniqueness through.
{
  const bad: string[] = [];
  for (const p of pages) {
    const doc = html(p);
    const title = /<title>([\s\S]*?)<\/title>/.exec(doc)?.[1]?.trim() ?? '';
    if (title !== p.title) bad.push(`${id(p)} title "${title}"`);
    if (metaOf(doc, 'description') !== p.description) bad.push(`${id(p)} description drifted`);
  }
  check('E · rendered title and description come from the registry',
    bad.length === 0, bad.join(' | '));
}

// Every hreflang annotation reaches the markup. These are the annotations Google warns
// are unreliable when injected by JavaScript, which is the entire reason these pages are
// static files rather than an SPA route.
{
  const bad: string[] = [];
  for (const p of pages) {
    const doc = html(p);
    for (const alt of alternatesFor(p)) {
      const tag = `<link rel="alternate" hreflang="${alt.hreflang}" href="${alt.href}" />`;
      if (!doc.includes(tag)) bad.push(`${id(p)} missing ${alt.hreflang} -> ${alt.href}`);
    }
  }
  check('E · every alternate is present in the static markup', bad.length === 0, bad.join(' | '));
}

// JSON LD that does not parse is worse than none: it is a promise of structure that
// Google reads, fails on, and silently discards.
{
  const bad: string[] = [];
  for (const p of pages) {
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html(p))?.[1];
    if (!block) { bad.push(`${id(p)} has no JSON LD block`); continue; }
    try {
      const parsed = JSON.parse(block) as Record<string, unknown>;
      if (!parsed['@context'] || !parsed['@type']) bad.push(`${id(p)} JSON LD lacks @context or @type`);
    } catch (e) {
      bad.push(`${id(p)} JSON LD does not parse: ${(e as Error).message}`);
    }
  }
  check('E · every JSON LD block parses and declares @context and @type',
    bad.length === 0, bad.join(' | '));
}

// ── PART F — THE PAGE IS INERT AND SELF CONTAINED ────────────────────────────
//
// These pages must render with no JavaScript, because that is the whole point, and they
// must reference no hashed asset, because a hashed name changes on every rebuild and a
// committed static file cannot track one. A page that quietly grew a bundle reference
// would keep working locally and 404 its asset in production after the next deploy.

{
  const bad: string[] = [];
  for (const p of pages) {
    const doc = html(p);
    // A Vite hashed asset looks like `index-a1b2c3d4.js`. Nothing here should have one.
    if (/\b[\w-]+-[A-Za-z0-9_]{8}\.(js|css)\b/.test(doc)) bad.push(`${id(p)} references a hashed asset`);
    if (/<script[^>]+src=/.test(doc)) bad.push(`${id(p)} loads an external script`);
    if (/<link[^>]+rel="stylesheet"/.test(doc)) bad.push(`${id(p)} loads an external stylesheet`);
    if (/fonts\.(googleapis|gstatic)\.com/.test(doc)) bad.push(`${id(p)} pulls a font from a CDN`);
    if (/\/src\/main\.tsx/.test(doc)) bad.push(`${id(p)} references an app entry module`);
  }
  check('F · no page loads a script, a stylesheet, a CDN font or a hashed asset',
    bad.length === 0, bad.join(' | '));
}

// The content itself is in the markup, not assembled at runtime.
{
  const bad: string[] = [];
  for (const p of pages) {
    const doc = html(p);
    if (!doc.includes(p.headline)) bad.push(`${id(p)} headline absent`);
    if (!doc.includes(p.intro)) bad.push(`${id(p)} intro absent`);
    if (!doc.includes(p.ctaLabel)) bad.push(`${id(p)} cta label absent`);
    for (const s of p.sections) {
      if (!doc.includes(s.heading)) bad.push(`${id(p)} heading absent: ${s.heading}`);
      for (const para of s.paragraphs) {
        if (!doc.includes(para)) bad.push(`${id(p)} paragraph absent under ${s.heading}`);
      }
    }
  }
  check('F · every headline, heading, paragraph and cta is present with no script run',
    bad.length === 0, bad.join(' | '));
}

// ── PART G — THE PAGES ARE LINKED, NOT ORPHANED ──────────────────────────────

{
  const noCta: string[] = [];
  const noSibling: string[] = [];
  for (const p of pages) {
    const doc = html(p);
    if (!doc.includes(`href="${CREATOR_ORIGIN}`)) noCta.push(id(p));
    const others = pages.filter((q) => id(q) !== id(p));
    if (!others.some((q) => doc.includes(`href="${landingPageUrl(q)}"`))) noSibling.push(id(p));
  }
  check('G · every page links into the application', noCta.length === 0, noCta.join(' | '));
  check('G · every page links to another landing page', noSibling.length === 0, noSibling.join(' | '));
}

// A visitor who lands on the wrong language needs a way across that does not depend on
// Google honouring an annotation. hreflang steers SEARCH RESULTS; it redirects nobody.
{
  const bad: string[] = [];
  for (const p of pages) {
    const counterpart = pages.find((q) => q.subject === p.subject && q.language !== p.language)!;
    if (!html(p).includes(`href="${landingPageUrl(counterpart)}"`)) bad.push(id(p));
  }
  check('G · every page offers a visible link to its own counterpart language',
    bad.length === 0, bad.join(' | '));
}

// ── PART H — LANGUAGE CORRECTNESS ────────────────────────────────────────────
//
// The predicates are IMPORTED from scripts/lib/i18nLeak.ts, never restated here. That
// file exists because this exact rule used to live as near-duplicate copies in
// check-i18n.ts and test-i18n-parity.ts, both carried the same defect, and both had to be
// patched in one commit. A third copy would be the same mistake a third time.
//
// This matters more than usual for these pages: scripts/check-i18n.ts scans only
// `apps/*/src` for .ts and .tsx, so files under `public/` are invisible to it in BOTH
// directions. They cannot raise a hardcoded-string finding, and without this section they
// would not be language checked at all. This is the only thing standing between a Hebrew
// marketing page and a paragraph of English nobody noticed.

/** Every human-facing string the registry owns, with a label naming where it came from. */
function copyFields(p: LandingPage): Array<[string, string]> {
  const out: Array<[string, string]> = [
    [`${id(p)}.title`, p.title],
    [`${id(p)}.description`, p.description],
    [`${id(p)}.headline`, p.headline],
    [`${id(p)}.intro`, p.intro],
    [`${id(p)}.ctaLabel`, p.ctaLabel],
  ];
  p.sections.forEach((s, i) => {
    out.push([`${id(p)}.sections[${i}].heading`, s.heading]);
    s.paragraphs.forEach((t, j) => out.push([`${id(p)}.sections[${i}].paragraphs[${j}]`, t]));
  });
  return out;
}

let copyScanned = 0;
{
  const leaks: string[] = [];
  for (const p of pages) {
    for (const [label, value] of copyFields(p)) {
      copyScanned++;
      if (p.language === 'he' && hasEnglishWord(value)) leaks.push(`${label} leaks English`);
      if (p.language === 'en' && hasHebrew(value)) leaks.push(`${label} leaks Hebrew`);
    }
  }
  check('H · no page leaks the other language', leaks.length === 0, leaks.join(' | '));
}

// A gate that silently scans zero fields is indistinguishable from a gate that passes,
// and a registry reshape is exactly how the loop above would quietly start iterating
// nothing. Twelve pages carrying five scalars plus at least two sections of two
// paragraphs is comfortably over a hundred fields, so the floor is set well below what a
// healthy registry produces but well above zero.
check('H · the language scan actually reached the copy', copyScanned >= 100,
  `${copyScanned} field(s)`);

// ── PART I — THE SITEMAP ─────────────────────────────────────────────────────
//
// Set EQUALITY, both directions, not a subset check. A missing entry is a page Google is
// never told about; a stale entry is a promise of a URL that 404s, which costs crawl
// budget and reads as a neglected site. Neither is visible in a browser.

{
  const xml = sitemapXml();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  // The generator owns the WHOLE file, so the expected set is the pre-existing stable
  // URLs (join screen, the two legal documents) plus every landing page. Asserting
  // against the landing pages alone would let the generator silently delete the three
  // URLs that were in this file before it existed.
  const expected = [
    ...STATIC_SITE_URLS.map((u) => `${LANDING_ORIGIN}${u.path}`),
    ...pages.map((p) => landingPageUrl(p)),
  ];

  const missing = expected.filter((u) => !locs.includes(u));
  const stale = locs.filter((u) => !expected.includes(u));

  check('I · the sitemap lists every landing page and every stable URL',
    missing.length === 0, missing.join(' | '));
  check('I · the sitemap lists nothing that does not exist', stale.length === 0, stale.join(' | '));
  check('I · the pre-existing stable URLs survived the generator',
    STATIC_SITE_URLS.every((u) => locs.includes(`${LANDING_ORIGIN}${u.path}`)),
    STATIC_SITE_URLS.map((u) => u.path).join(' '));
  check('I · the sitemap has no duplicate entries',
    new Set(locs).size === locs.length, `${locs.length} entries, ${new Set(locs).size} unique`);
  check('I · the sitemap is a well formed urlset',
    xml.startsWith('<?xml') && xml.includes('<urlset') && xml.trimEnd().endsWith('</urlset>'));
}

// ── PART J — THE COMMITTED FILES MATCH THE GENERATOR ─────────────────────────
//
// The output is committed rather than built, because generating during the build would
// mean the gate build and the playtest build both write it, which is the exact class of
// shared write that produced the dist/dist-playtest incident. The price of committing is
// drift, and this is what closes it: edit the registry, forget to regenerate, and `npm
// test` fails naming the stale file instead of shipping quietly.

{
  const missing: string[] = [];
  const drifted: string[] = [];
  let compared = 0;
  for (const p of pages) {
    const path = join(ROOT, LANDING_PUBLIC_DIR, landingPageFile(p));
    if (!existsSync(path)) { missing.push(landingPageFile(p)); continue; }
    compared++;
    if (readFileSync(path, 'utf8') !== renderLandingPage(p)) drifted.push(landingPageFile(p));
  }
  check('J · every landing page exists on disk', missing.length === 0, missing.join(' | '));
  check('J · every committed page matches what the generator produces now',
    drifted.length === 0, `run npm run seo:build => ${drifted.join(' | ')}`);
  // Without this, the drift check above passes VACUOUSLY when the files are absent: every
  // page is skipped, `drifted` stays empty, and a green line claims the committed output
  // is current when nothing was compared at all. A comparison that examined nothing must
  // not report success.
  check('J · the drift comparison actually compared every page',
    compared === pages.length, `${compared} of ${pages.length} compared`);
}

{
  const path = join(ROOT, LANDING_PUBLIC_DIR, 'sitemap.xml');
  check('J · the committed sitemap matches the generator',
    existsSync(path) && readFileSync(path, 'utf8') === sitemapXml(),
    'run npm run seo:build');
}

// Every alternate must resolve to a page that really exists as a file. An hreflang
// pointing at a 404 invalidates the cluster it belongs to, and the only way to catch it
// is to check the annotation against the filesystem rather than against the registry that
// produced it.
{
  const dangling: string[] = [];
  const onDisk = new Set(
    pages.filter((p) => existsSync(join(ROOT, LANDING_PUBLIC_DIR, landingPageFile(p))))
      .map((p) => landingPageUrl(p)),
  );
  for (const p of pages) {
    for (const alt of alternatesFor(p)) {
      if (!onDisk.has(alt.href)) dangling.push(`${id(p)} -> ${alt.href}`);
    }
  }
  check('J · every alternate href resolves to a file that exists',
    dangling.length === 0, dangling.join(' | '));
}

// ── PART K — CRAWLING IS NOT BLOCKED ─────────────────────────────────────────
//
// A perfect page set behind a Disallow is a page set nobody reads. Cheap to assert, and
// the failure mode is total.

{
  const robots = readFileSync(join(ROOT, LANDING_PUBLIC_DIR, 'robots.txt'), 'utf8');
  const disallowed = robots
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^Disallow:/i.test(l))
    .map((l) => l.replace(/^Disallow:\s*/i, '').trim())
    .filter((v) => v !== '');

  const blocked: string[] = [];
  for (const p of pages) {
    const path = new URL(landingPageUrl(p)).pathname;
    for (const rule of disallowed) {
      if (path.startsWith(rule)) blocked.push(`${path} blocked by "Disallow: ${rule}"`);
    }
  }
  check('K · robots.txt disallows no landing page path', blocked.length === 0, blocked.join(' | '));
  check('K · robots.txt advertises the sitemap',
    /^Sitemap:\s*\S+/im.test(robots));
}

console.log(`\n${failures === 0 ? 'ALL LANDING PAGE TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
