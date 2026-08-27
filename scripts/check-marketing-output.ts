/**
 * Assertions against the BUILT marketing site, not its source.
 *
 * Source can be right while output is wrong: a config the build ignores, a
 * canonical assembled from the wrong base, an integration that rewrote a file
 * after the page was rendered. What a crawler receives is the built file, so
 * that is what this reads.
 *
 * It never skips silently. An unbuilt output is a FAILURE with instructions,
 * because the alternative is a suite that reports green having examined nothing
 * (the vacuous-pass class the landing page drift check hit).
 *
 * Named check-*, not test-*, ON PURPOSE. scripts/run-unit-tests.mjs auto
 * discovers every scripts/test-*.ts and runs that lane CONCURRENTLY with the
 * builds, so a suite that needs built output would race them and fail on a dist
 * that is mid write. The repository already draws this line: check-bundle-budget,
 * check-build-base and check-backend-origin all read built artifacts and all run
 * in verify's artifacts phase, after the builds have finished. This belongs with
 * them.
 *
 * Change: marketing-site.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  SITE_ORIGIN,
  DIRECTION,
  HREFLANG,
  alternatesFor,
  pageUrl,
  standingPages,
  LANGUAGES,
  LANGUAGE_NAME,
  otherLanguage,
  pagePath,
  type Alternate,
} from './lib/marketingSite.ts';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'apps', 'marketing', 'dist');

let failures = 0;
let checks = 0;

function record(ok: boolean, name: string, detail: string): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
}

function check(name: string, ok: boolean, detail = ''): void {
  record(ok, name, detail);
}

// ── Load the built pages ─────────────────────────────────────────────────────

if (!existsSync(DIST)) {
  console.log(`FAIL  the marketing site is built :: ${DIST} is absent`);
  console.log('');
  console.log('Build it first:  npm run build --workspace=apps/marketing');
  console.log('MARKETING OUTPUT TESTS FAILED :: output not built');
  process.exit(1);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

interface Page {
  /** Path relative to dist, with forward slashes, e.g. `he/story/index.html`. */
  readonly file: string;
  /** The URL path this file is served at, e.g. `/he/story/`. */
  readonly urlPath: string;
  readonly html: string;
}

const pages: Page[] = walk(DIST).map((full) => {
  const file = relative(DIST, full).split(sep).join('/');
  const urlPath = '/' + file.replace(/index\.html$/, '').replace(/\.html$/, '');
  return { file, urlPath, html: readFileSync(full, 'utf8') };
});

check('reach · the built output contains pages', pages.length > 0, `${pages.length} html files`);

// ── A. Every absolute self URL carries the one declared origin ───────────────
//
// The point is portability: moving the site must be a change to ONE declaration,
// not a search and replace. Any of our own hostnames appearing in the output
// that is not the declared origin means something bypassed the declaration and
// would be left behind by such a move.

// Every absolute URL in the family of hosts this site could plausibly be served
// from, plus the hosts a stale template or a bad deploy would leave behind.
const OUR_HOST_PATTERN = /https?:\/\/[a-z0-9.-]*(?:rush-point\.com|rushpoint[a-z0-9-]*\.(?:vercel\.app|web\.app|firebaseapp\.com)|astrowind[a-z0-9-]*\.[a-z.]+)[^\s"'<>)]*/gi;

// Sibling products on the same domain. They are DESTINATIONS this site links to,
// not URLs of this site, so they must not be rewritten to the declared origin.
// Listing them explicitly rather than loosening the pattern keeps the check able
// to catch a genuine stray (a *.web.app host, a leftover template domain, a
// missing `www.`) instead of waving through anything ending in rush-point.com.
const SIBLING_ORIGINS = [
  'https://creator.rush-point.com',
  'https://api.rush-point.com',
  'https://rush-point.com',
];

const isSelfUrl = (url: string): boolean =>
  !SIBLING_ORIGINS.some((origin) => url === origin || url.startsWith(`${origin}/`));

const strayByPage = new Map<string, Set<string>>();
for (const page of pages) {
  const found = page.html.match(OUR_HOST_PATTERN) ?? [];
  const stray = found.filter((url) => isSelfUrl(url) && !url.startsWith(SITE_ORIGIN));
  if (stray.length > 0) strayByPage.set(page.file, new Set(stray));
}

const strayCount = [...strayByPage.values()].reduce((n, s) => n + s.size, 0);
check(
  'A · every absolute self URL uses the declared origin',
  strayCount === 0,
  strayCount === 0
    ? SITE_ORIGIN
    : `${strayCount} stray url(s), e.g. ${[...strayByPage.entries()]
        .slice(0, 3)
        .map(([file, urls]) => `${file}: ${[...urls][0]}`)
        .join(' | ')}`,
);

// The companion reach assertion: "no stray origins" is trivially true of a page
// set that contains no absolute URLs at all, so prove the scan saw some.
const selfUrlCount = pages.reduce(
  (n, p) => n + (p.html.match(OUR_HOST_PATTERN) ?? []).filter(isSelfUrl).length,
  0,
);
check(
  'A · the origin scan actually reached absolute urls',
  selfUrlCount > 0,
  `${selfUrlCount} absolute self url(s) examined`,
);

// Canonicals specifically must be absolute and on the declared origin: a
// relative canonical is resolved against whatever host served the page, which
// defeats the purpose of declaring one.
// Attribute ORDER is not guaranteed: the build minifies, and this output emits
// `href` before `rel`. A regex that assumed `rel` first matched nothing and made
// the "every canonical is on the declared origin" check pass over an empty set.
// Match the tag, then read its attributes.
function linkHref(html: string, relValue: string): string {
  for (const [, tag] of html.matchAll(/<link\b([^>]*)>/gi)) {
    if (!new RegExp(`\\brel=["']?${relValue}\\b`, 'i').test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i);
    if (href) return href[1];
  }
  return '';
}

/** The same order-independent treatment for <meta name=… content=…>. */
function metaContent(html: string, nameValue: string): string {
  for (const [, tag] of html.matchAll(/<meta\b([^>]*)>/gi)) {
    if (!new RegExp(`\\bname=["']?${nameValue}\\b`, 'i').test(tag)) continue;
    const content = tag.match(/\bcontent=["']([^"']*)["']/i);
    if (content) return content[1];
  }
  return '';
}

const canonicals = pages
  .map((p) => ({ file: p.file, href: linkHref(p.html, 'canonical') }))
  .filter((c) => c.href !== '');

const badCanonical = canonicals.filter((c) => !c.href.startsWith(SITE_ORIGIN));
check(
  'A · every canonical is absolute and on the declared origin',
  badCanonical.length === 0,
  badCanonical.length === 0
    ? `${canonicals.length} canonical(s)`
    : `${badCanonical.length} bad, e.g. ${badCanonical[0].file} -> ${badCanonical[0].href}`,
);
check(
  'A · the canonical scan actually reached canonicals',
  canonicals.length > 0,
  `${canonicals.length} canonical(s) examined`,
);

// ── B. Standing pages are paired, and declare the right language ─────────────

const byPath = new Map(pages.map((p) => [p.urlPath, p]));

const missing = standingPages().filter(({ path }) => !byPath.has(path));
check(
  'B · every standing page is published in both languages',
  missing.length === 0,
  missing.length === 0
    ? `${standingPages().length} standing page(s)`
    : `missing: ${missing.map((m) => m.path).join(', ')}`,
);

for (const { language, path } of standingPages()) {
  const page = byPath.get(path);
  if (!page) continue; // already reported by the check above
  const lang = (page.html.match(/<html[^>]*\blang="([^"]+)"/i) ?? [])[1] ?? '';
  const dir = (page.html.match(/<html[^>]*\bdir="([^"]+)"/i) ?? [])[1] ?? '';
  check(
    `B · ${path} declares lang and dir consistently`,
    lang === language && dir === DIRECTION[language],
    `lang="${lang}" dir="${dir}", expected lang="${language}" dir="${DIRECTION[language]}"`,
  );
}

// ── C. hreflang: self referencing, symmetric, exactly one x-default ──────────
//
// Symmetry is the property that cannot be eyeballed. An asymmetric cluster is
// invisible on the page and silently tells a search engine the two pages are not
// really counterparts.

function alternatesOf(html: string): Alternate[] {
  const out: Alternate[] = [];
  for (const [, tag] of html.matchAll(/<link\b([^>]*)>/gi)) {
    if (!/\brel=["']?alternate\b/i.test(tag)) continue;
    const hreflang = tag.match(/\bhreflang=["']([^"']+)["']/i);
    const href = tag.match(/\bhref=["']([^"']+)["']/i);
    if (hreflang && href) out.push({ hreflang: hreflang[1], href: href[1] });
  }
  return out;
}

let alternateTagsSeen = 0;
const declared = new Map<string, Set<string>>(); // page url -> alternates it names

for (const { language, subject, path } of standingPages()) {
  const page = byPath.get(path);
  if (!page) continue;
  const alts = alternatesOf(page.html);
  alternateTagsSeen += alts.length;

  const own = pageUrl(language, subject);
  declared.set(own, new Set(alts.map((a) => a.href)));

  check(
    `C · ${path} names itself among its alternates`,
    alts.some((a) => a.href === own && a.hreflang === HREFLANG[language]),
    `expected ${HREFLANG[language]} -> ${own}`,
  );

  const xDefaults = alts.filter((a) => a.hreflang === 'x-default');
  check(`C · ${path} declares exactly one x-default`, xDefaults.length === 1, `${xDefaults.length}`);

  const expected = alternatesFor(subject);
  const got = alts.map((a) => `${a.hreflang} ${a.href}`).sort();
  const want = expected.map((a) => `${a.hreflang} ${a.href}`).sort();
  check(
    `C · ${path} publishes the derived alternate set`,
    got.join('|') === want.join('|'),
    got.join('|') === want.join('|') ? `${alts.length} entries` : `got [${got}] want [${want}]`,
  );
}

check(
  'C · the alternate scan actually reached alternate tags',
  alternateTagsSeen > 0,
  `${alternateTagsSeen} alternate tag(s) examined`,
);

// Symmetry, checked as a relation rather than per page: if A names B, B must
// name A. Reported in both directions so the break is locatable from either end.
const asymmetric: string[] = [];
for (const [from, targets] of declared) {
  for (const to of targets) {
    if (to === from) continue;
    const back = declared.get(to);
    if (!back) continue; // a target outside the standing set is reported elsewhere
    if (!back.has(from)) asymmetric.push(`${from} -> ${to} but ${to} does not name ${from}`);
  }
}
check(
  'C · alternate annotations are symmetric',
  asymmetric.length === 0,
  asymmetric.length === 0 ? `${declared.size} page(s) cross checked` : asymmetric.slice(0, 3).join(' ; '),
);

// ── D. Sitemap lists exactly the published set ───────────────────────────────

const sitemapFiles = readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f));
const sitemapUrls = new Set(
  sitemapFiles.flatMap((f) =>
    [...readFileSync(join(DIST, f), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
  ),
);

check('D · a sitemap was generated', sitemapUrls.size > 0, `${sitemapUrls.size} url(s)`);

// The published set is derived from the OUTPUT, so this compares two independent
// products of the build rather than the sitemap against its own generator.
// 404 is excluded: it is a real file but not a published page.
// Real files that are NOT published pages. The 404 is served rather than
// linked; the admin surface is a tool, not content. Both must therefore be
// absent from the sitemap, and the admin one is asserted suppressed three ways
// below.
const ADMIN_PATH = '/admin/';
const publishedUrls = new Set(
  pages
    .filter((p) => p.file !== '404.html' && !p.urlPath.startsWith(ADMIN_PATH))
    .map((p) => `${SITE_ORIGIN}${p.urlPath}`),
);

const inSitemapOnly = [...sitemapUrls].filter((u) => !publishedUrls.has(u));
const inPagesOnly = [...publishedUrls].filter((u) => !sitemapUrls.has(u));

check(
  'D · the sitemap lists no url without a page',
  inSitemapOnly.length === 0,
  inSitemapOnly.slice(0, 3).join(', ') || 'none stale',
);
check(
  'D · every published page is in the sitemap',
  inPagesOnly.length === 0,
  inPagesOnly.slice(0, 3).join(', ') || `${publishedUrls.size} page(s)`,
);
check('D · the 404 is not advertised as a page', !sitemapUrls.has(`${SITE_ORIGIN}/404`), '404');

// ── E. robots.txt permits the pages and advertises the sitemap ───────────────

const robotsPath = join(DIST, 'robots.txt');
const robots = existsSync(robotsPath) ? readFileSync(robotsPath, 'utf8') : '';
check('E · robots.txt exists', robots.length > 0, `${robots.length} chars`);

// Only `Disallow:` with a non empty value blocks anything. A bare `Disallow:`
// is the idiom for "nothing is disallowed", so it must not be read as a rule.
const disallowed = [...robots.matchAll(/^\s*Disallow:\s*(\S+)\s*$/gim)].map((m) => m[1]);
const blocked = [...publishedUrls].filter((url) => {
  const path = url.slice(SITE_ORIGIN.length);
  return disallowed.some((rule) => path.startsWith(rule.replace(/\*$/, '')));
});
check('E · no published page is disallowed', blocked.length === 0, blocked.slice(0, 3).join(', ') || 'none');
check('E · robots.txt advertises a sitemap', /^\s*Sitemap:\s*\S+/im.test(robots), 'Sitemap directive');

// The admin surface, suppressed three independent ways. Any one of them can be
// missed by an edit; all three failing silently is much less likely, and the
// cost of an indexed editor is an authenticated tool showing up in search.
const adminPage = pages.find((p) => p.urlPath.startsWith(ADMIN_PATH));
check('E · the admin surface exists to be excluded', Boolean(adminPage), ADMIN_PATH);
check(
  'E · the admin surface is absent from the sitemap',
  ![...sitemapUrls].some((u) => u.includes(ADMIN_PATH)),
  ADMIN_PATH,
);
check('E · the admin surface is disallowed in robots.txt', disallowed.includes(ADMIN_PATH), ADMIN_PATH);
check(
  'E · the admin surface declares noindex in its own markup',
  Boolean(adminPage) && /noindex/i.test(metaContent(adminPage!.html, 'robots')),
  'meta robots noindex',
);

// ── F. A feed per language, listing published posts and no draft ─────────────

for (const language of LANGUAGES) {
  const feedPath = join(DIST, language, 'rss.xml');
  const feed = existsSync(feedPath) ? readFileSync(feedPath, 'utf8') : '';
  check(`F · ${language} has a feed`, feed.length > 0, feedPath);

  // Every post of this language that reached the output must be in its feed.
  const postUrls = [...publishedUrls].filter((u) => u.includes(`/${language}/blog/`));
  const missingFromFeed = postUrls.filter((u) => !feed.includes(u.slice(SITE_ORIGIN.length)));
  check(
    `F · the ${language} feed lists every published post`,
    feed.length > 0 && missingFromFeed.length === 0,
    missingFromFeed.slice(0, 2).join(', ') || `${postUrls.length} post(s)`,
  );

  // ...and nothing from the other language.
  const other = language === 'he' ? 'en' : 'he';
  check(
    `F · the ${language} feed contains no ${other} post`,
    !feed.includes(`/${other}/blog/`),
    other,
  );
}

// ── F2. The language switch agrees with the hreflang cluster ─────────────────
//
// A reader and a crawler must be told the SAME thing about where the other
// version of this page lives. They were not: the switch pointed at the other
// language's home from every page, so someone halfway through the story who
// changed language was returned to the front page to find their place again,
// while the page's own hreflang correctly named the counterpart. Nothing
// reported the disagreement, because each half was individually right.

for (const { path, language, subject } of standingPages()) {
  const page = byPath.get(path);
  if (!page) continue;

  const expected = pagePath(otherLanguage(language), subject);
  // The switch is the link whose text is the other language's own name for
  // itself, which is how a reader identifies it too.
  const other = otherLanguage(language);
  const label = LANGUAGE_NAME[other];
  const anchor = new RegExp(`<a[^>]*href="([^"]+)"[^>]*>[^<]*${label}[^<]*</a>`, 'i');
  const found = page.html.match(anchor)?.[1];

  check(
    `F2 · ${path} offers a language switch`,
    Boolean(found),
    found ?? `no link labelled ${label}`,
  );
  check(
    `F2 · ${path} switches to its own counterpart, not to a home page`,
    found === expected,
    `${found ?? '(none)'} expected ${expected}`,
  );
}

// ── G. No framework runtime reaches a content page ───────────────────────────
//
// The reason these pages are static is that a crawler and a slow phone both get
// the content in the first response. A hydration bundle creeping back in would
// not break anything visibly, which is exactly why it needs an assertion.

const FRAMEWORK_MARKERS = /(astro\/runtime|client:load|client:visible|client:idle|hydrate|react-dom|\bvue\b|svelte)/i;

for (const { path } of standingPages()) {
  const page = byPath.get(path);
  if (!page) continue;
  check(`G · ${path} ships no hydration runtime`, !FRAMEWORK_MARKERS.test(page.html), path);
}

// The content still has to be THERE without scripts. A page whose body is an
// empty mount point would pass every tag check above.
for (const { path } of standingPages()) {
  const page = byPath.get(path);
  if (!page) continue;
  const body = page.html.slice(page.html.indexOf('<body'));
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  check(`G · ${path} carries readable text without scripts`, text.length > 400, `${text.length} chars`);
}

// ── G2. Every post carries valid structured data ─────────────────────────────
//
// A blog post is the surface structured data was designed for: it is what lets a
// result carry a date and a publisher rather than a bare title. It is also the
// easiest thing on the page to break without anyone noticing, because it is
// invisible to a reader and a malformed block is silently ignored by the crawler
// rather than reported anywhere.
//
// So the block is PARSED, not pattern matched. A regex confirming the tag is
// present would pass over a truncated object, which is the realistic failure:
// unescaped content, not a missing tag.

const postPages = pages.filter((p) => /\/(he|en)\/blog\/[^/]+\/$/.test(p.urlPath));
check('G2 · the built output contains blog posts', postPages.length > 0, `${postPages.length} post(s)`);

for (const page of postPages) {
  const match = page.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) {
    check(`G2 · ${page.urlPath} carries structured data`, false, 'no ld+json block');
    continue;
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(match[1]) as Record<string, unknown>;
  } catch (e) {
    check(`G2 · ${page.urlPath} structured data parses`, false, String(e));
    continue;
  }
  check(`G2 · ${page.urlPath} structured data parses`, true, String(data['@type']));
  check(
    `G2 · ${page.urlPath} structured data declares the page it describes`,
    data.url === `${SITE_ORIGIN}${page.urlPath}`,
    String(data.url),
  );
  // The language a post is written in is not inferable from a short post, and the
  // two languages live under different prefixes, so it is stated.
  const expected = page.urlPath.startsWith('/he/') ? 'he-IL' : 'en';
  check(
    `G2 · ${page.urlPath} structured data states the language`,
    data.inLanguage === expected,
    `${String(data.inLanguage)} (expected ${expected})`,
  );
  // An image in structured data is published VERBATIM. The frontmatter value is an
  // authoring path, so passing it through emits a reference to a file that exists
  // nowhere, in a block no reader ever sees. Absent is fine; unresolved is not.
  if ('image' in data) {
    check(
      `G2 · ${page.urlPath} structured data image is a resolvable absolute url`,
      typeof data.image === 'string' && /^https?:\/\//.test(data.image as string),
      String(data.image),
    );
  }
  check(
    `G2 · ${page.urlPath} structured data carries a headline and a date`,
    typeof data.headline === 'string' && (data.headline as string).length > 0
      && typeof data.datePublished === 'string',
    `${String(data.headline).slice(0, 40)} @ ${String(data.datePublished)}`,
  );
}

// ── H. The markup a phone needs ──────────────────────────────────────────────
//
// Real layout is measured in a browser, and this change did that across phone,
// tablet and desktop: no page scrolled sideways at 375, 768 or 1440, and the tap
// targets that were under 24px (footer links, the post's back link, the index's
// read more links) were fixed. A browser pass is not repeatable in CI though, so
// what is pinned here are the STATIC preconditions: without these, no amount of
// CSS makes a page behave on a phone.

for (const { path } of standingPages()) {
  const page = byPath.get(path);
  if (!page) continue;

  // Without a viewport meta a phone renders at ~980px and scales down, so every
  // breakpoint in the stylesheet is bypassed and the page is simply tiny.
  const viewport = metaContent(page.html, 'viewport');
  check(
    `H · ${path} declares a responsive viewport`,
    /width=device-width/.test(viewport) && /initial-scale=1/.test(viewport),
    viewport || '(absent)',
  );

  // A fixed pixel width on a wrapper is the single most common cause of a page
  // scrolling sideways on a phone, and it survives every check that only looks
  // at tags.
  const fixedWidths = [...page.html.matchAll(/style="[^"]*\bwidth:\s*(\d{3,})px/gi)].map((m) => m[1]);
  const tooWide = fixedWidths.filter((w) => Number(w) > 375);
  check(
    `H · ${path} has no inline width wider than a phone`,
    tooWide.length === 0,
    tooWide.join(', ') || `${fixedWidths.length} inline width(s)`,
  );
}

console.log('');
if (failures > 0) {
  console.log(`MARKETING OUTPUT TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`ALL MARKETING OUTPUT TESTS PASSED :: ${checks} checks`);
