/**
 * The marketing site's CONTENT: its per-language copy modules and its Markdown
 * posts.
 *
 * `scripts/check-i18n.ts` cannot reach any of this. It scans the two dictionary
 * driven apps for `.ts`/`.tsx` under `apps/<app>/src`, and this site has no
 * dictionary: copy lives in per-language modules and in Markdown. Silence there
 * is not coverage, so the language rules are enforced here instead, using the
 * SAME predicate from scripts/lib/i18nLeak.ts rather than a second opinion about
 * what counts as Hebrew.
 *
 * Change: marketing-site.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { hasEnglishWord, hasHebrew } from './lib/i18nLeak.ts';
import { LANGUAGES, type Language } from './lib/marketingSite.ts';

const ROOT = join(import.meta.dirname, '..');
const MARKETING = join(ROOT, 'apps', 'marketing');
const POSTS_DIR = join(MARKETING, 'src', 'data', 'post');
const COPY_DIR = join(MARKETING, 'src', 'copy');

let failures = 0;
let checks = 0;
let fieldsScanned = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
}

// ── Read posts ───────────────────────────────────────────────────────────────

interface ParsedPost {
  readonly file: string;
  readonly frontmatter: Record<string, string>;
  readonly body: string;
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: normalized };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    // Top level scalar keys only. Nested blocks (tags, metadata) are read by the
    // build's own schema, which is the authority on their shape; re-parsing YAML
    // here would be a second, worse parser.
    const kv = line.match(/^([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/);
    if (kv && kv[2] !== '') frontmatter[kv[1]] = kv[2].trim();
  }
  return { frontmatter, body: match[2] };
}

const posts: ParsedPost[] = existsSync(POSTS_DIR)
  ? readdirSync(POSTS_DIR)
      .filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
      .map((f) => {
        const raw = readFileSync(join(POSTS_DIR, f), 'utf8');
        return { file: f, ...parseFrontmatter(raw) };
      })
  : [];

check('reach · posts were found on disk', posts.length > 0, `${posts.length} post(s)`);

// ── A. Required frontmatter, and a slug that does not move ───────────────────

const REQUIRED = ['publishDate', 'language', 'slug', 'title'] as const;

for (const post of posts) {
  const absent = REQUIRED.filter((key) => !post.frontmatter[key]);
  check(`A · ${post.file} declares every required field`, absent.length === 0, absent.join(', ') || 'ok');

  const language = post.frontmatter.language;
  check(
    `A · ${post.file} declares a known language`,
    (LANGUAGES as readonly string[]).includes(language),
    language ?? '(absent)',
  );

  // The slug is DECLARED, never derived. A URL derived from a title breaks the
  // moment someone edits the title, and it breaks silently.
  const slug = post.frontmatter.slug ?? '';
  check(
    `A · ${post.file} has a url safe slug`,
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug),
    slug || '(absent)',
  );
}

// A slug must be unique WITHIN a language: two posts sharing one would collide
// on the same URL, and the build would silently keep whichever it wrote last.
for (const language of LANGUAGES) {
  const slugs = posts.filter((p) => p.frontmatter.language === language).map((p) => p.frontmatter.slug);
  const duplicates = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  check(`A · ${language} slugs are unique`, duplicates.length === 0, duplicates.join(', ') || `${slugs.length} slug(s)`);
}

// ── B. Pairing is symmetric where it is claimed at all ───────────────────────
//
// A post is NOT required to have a counterpart. But a post that CLAIMS one via
// pairedSubject must actually have it, in the other language: a claim pointing
// at nothing produces an hreflang cluster naming a page that does not exist.

const paired = posts.filter((p) => p.frontmatter.pairedSubject);
for (const post of paired) {
  const subject = post.frontmatter.pairedSubject;
  const partners = posts.filter(
    (p) => p.frontmatter.pairedSubject === subject && p.frontmatter.language !== post.frontmatter.language,
  );
  check(
    `B · ${post.file} claims pairing "${subject}" and the counterpart exists`,
    partners.length === 1,
    `${partners.length} counterpart(s)`,
  );
}
check(
  'B · at least one unpaired post exists, so the unpaired path is exercised',
  posts.some((p) => !p.frontmatter.pairedSubject),
  `${posts.length - paired.length} unpaired`,
);

// ── C. Language correctness, via the SHARED predicate ────────────────────────

/**
 * Markup is not copy. A Hebrew headline may legitimately wrap a word in
 * `<span class="text-accent">` to highlight it, and the tag name and class are
 * English by necessity, not by leaking. The shared predicate already strips
 * `{placeholders}` for exactly this reason; tags are the same case, so they are
 * removed before the language question is asked.
 */
function stripMarkup(text: string): string {
  return text.replace(/<[^>]*>/g, ' ');
}

function assertLanguage(label: string, language: Language, raw: string, part = 'C'): void {
  fieldsScanned += 1;
  const text = stripMarkup(raw);
  if (language === 'he') {
    // Hebrew copy leaking English words is the recurring bug the dictionaries
    // have a gate for; this surface needs the same one.
    check(`${part} · ${label} is Hebrew without English leaking in`, !hasEnglishWord(text), text.slice(0, 60));
  } else {
    check(`${part} · ${label} is English without Hebrew leaking in`, !hasHebrew(text), text.slice(0, 60));
  }
}

for (const post of posts) {
  const language = post.frontmatter.language as Language;
  if (!(LANGUAGES as readonly string[]).includes(language)) continue;
  assertLanguage(`${post.file} title`, language, post.frontmatter.title ?? '');
  if (post.frontmatter.excerpt) assertLanguage(`${post.file} excerpt`, language, post.frontmatter.excerpt);
}

// The copy modules: every leaf string under a language key must be in that
// language. Read as source rather than imported, because importing them pulls in
// the `~/` alias, which only Astro resolves.
const copyFiles = existsSync(COPY_DIR) ? readdirSync(COPY_DIR).filter((f) => f.endsWith('.ts')) : [];
check('reach · copy modules were found', copyFiles.length > 0, `${copyFiles.length} module(s)`);

for (const file of copyFiles) {
  const source = readFileSync(join(COPY_DIR, file), 'utf8');
  // Each language block runs from `he: {` / `en: {` to the start of the next
  // top level language key, or to the end.
  for (const language of LANGUAGES) {
    const start = source.indexOf(`\n  ${language}: {`);
    if (start < 0) {
      check(`C · ${file} defines a ${language} block`, false, 'block not found');
      continue;
    }
    const others = LANGUAGES.filter((l) => l !== language)
      .map((l) => source.indexOf(`\n  ${l}: {`, start + 1))
      .filter((i) => i > start);
    const end = others.length > 0 ? Math.min(...others) : source.length;
    const block = source.slice(start, end);

    // Single or double quoted string literals, minus the ones that are clearly
    // not prose: css classes, icon names, urls, html fragments.
    for (const [, literal] of block.matchAll(/'((?:[^'\\]|\\.){4,})'/g)) {
      if (/^(tabler:|https?:|\/|#|[a-z-]+(\s[a-z0-9:-]+)*$)/.test(literal)) continue;
      if (!/[A-Za-z֐-׿]/.test(literal)) continue;
      assertLanguage(`${file} ${language} "${literal.slice(0, 28)}"`, language, literal);
    }
  }
}

// ── D. The scan actually reached something ───────────────────────────────────
//
// Every check above is phrased so that an empty input set satisfies it. Without
// this the suite reports green over zero files, which is the vacuous pass the
// landing page drift check hit.
check('D · the content scan reached a non zero number of fields', fieldsScanned > 0, `${fieldsScanned} field(s)`);

// ── F. The PAGE content files ────────────────────────────────────────────────
//
// The home, story and contact pages moved out of src/copy/*.ts into JSON data
// files so the CMS can edit them (change: editable-pages-and-media). Section C
// above scans the copy MODULES, and after that move it was scanning a directory
// the site barely uses: every check stayed green while the words a reader
// actually sees went unchecked in both languages.
//
// This is the same "silence is not coverage" trap the i18n checker had. The
// language rules follow the content.
{
  const beforePages = fieldsScanned;
  const PAGES_DIR = join(MARKETING, 'src', 'data', 'pages');
  const pageFiles = existsSync(PAGES_DIR)
    ? readdirSync(PAGES_DIR).filter((f) => f.endsWith('.json'))
    : [];

  check('F · page content files were found', pageFiles.length > 0, `${pageFiles.length} file(s)`);

  // Every standing page must exist in BOTH languages, as a file. A missing one
  // fails the build, but failing here names it before a build has to.
  for (const page of ['home', 'story', 'contact']) {
    for (const language of LANGUAGES) {
      check(
        `F · ${page} exists in ${language}`,
        pageFiles.includes(`${page}.${language}.json`),
        `${page}.${language}.json`,
      );
    }
  }

  /** Every string leaf in a parsed JSON value, with a dotted path. */
  function leaves(value: unknown, path = ''): Array<[string, string]> {
    if (typeof value === 'string') return [[path, value]];
    if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
    if (value && typeof value === 'object') {
      return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
    }
    return [];
  }

  // Fields that are identifiers rather than prose. `src`, `poster` and `icon`
  // are paths and icon names: they are Latin by necessity in both languages, and
  // the standard already exempts file paths.
  //
  // `id` and the tag arrays under `ideas` join them for the same reason (change:
  // mission-ideas): the idea generator filters by tag, so those strings are structural keys
  // that no visitor ever sees, and they must stay identical across languages or the Hebrew
  // bank would filter against Hebrew tags while the widget asked for English ones.
  //
  // NOTE `kind` is on this list from an earlier change, where it meant 'image' or 'video'.
  // A user-visible label must therefore NOT be called `kind`, or it silently escapes this
  // check — which is exactly what happened when the playable demo first shipped its mission
  // labels under that name. Visible labels are `kindLabel`.
  //
  // `visual` joins them for the same reason (change: hero-photo-reveal): it selects which
  // drawn illustration a hero-taste mission renders (e.g. `crosswalk-photo`) and is never
  // shown to a visitor as text, so it must stay the same closed-enum value in both languages
  // rather than being translated.
  // The `(\[\d+\])?` tail matters: tag arrays are visited element by element, so a path
  // reads `ideas[0].occasions[0]` and would not match an anchor that expects the key to be
  // last. Without it the exemption silently covered nothing for exactly the fields it was
  // added for.
  const NOT_PROSE = /(^|\.)(src|poster|icon|kind|id|occasions|places|visual)(\[\d+\])?$/;

  for (const file of pageFiles) {
    const language = file.split('.')[1] as Language;
    if (!(LANGUAGES as readonly string[]).includes(language)) {
      check(`F · ${file} names a known language`, false, language);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(PAGES_DIR, file), 'utf8'));
    } catch (e) {
      check(`F · ${file} is valid JSON`, false, (e as Error).message);
      continue;
    }

    for (const [path, text] of leaves(parsed)) {
      if (NOT_PROSE.test(path)) continue;
      if (!/[A-Za-z\u0590-\u05FF]/.test(text)) continue;
      assertLanguage(`${file} ${path}`, language, text, 'F');
    }
  }

  // Counted, not assumed. Every language check above is a check on a field that
  // was found; if the leaf walk or the NOT_PROSE filter ever stopped yielding
  // anything, this section would print nothing but passes.
  check(
    'F · the page scan actually reached page fields',
    fieldsScanned - beforePages > 0,
    `${fieldsScanned - beforePages} page field(s)`,
  );
}

console.log('');
if (failures > 0) {
  console.log(`MARKETING CONTENT TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`ALL MARKETING CONTENT TESTS PASSED :: ${checks} checks, ${fieldsScanned} fields scanned`);
