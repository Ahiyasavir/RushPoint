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
 * Change: marketing-site.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SITE_ORIGIN } from './lib/marketingSite.ts';

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

const OUR_HOST_PATTERN = /https?:\/\/[a-z0-9.-]*(?:rush-point\.com|rushpoint[a-z0-9-]*\.(?:vercel\.app|web\.app|firebaseapp\.com)|astrowind[a-z0-9-]*\.[a-z.]+)[^\s"'<>)]*/gi;

const strayByPage = new Map<string, Set<string>>();
for (const page of pages) {
  const found = page.html.match(OUR_HOST_PATTERN) ?? [];
  const stray = found.filter((url) => !url.startsWith(SITE_ORIGIN));
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
  (n, p) => n + (p.html.match(OUR_HOST_PATTERN) ?? []).length,
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

console.log('');
if (failures > 0) {
  console.log(`MARKETING OUTPUT TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`ALL MARKETING OUTPUT TESTS PASSED :: ${checks} checks`);
