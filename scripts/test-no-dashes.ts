// UI text standard guard (change: ui-no-dashes). Per product decision, NO hyphen
// or dash of any kind may appear in user-facing copy — not a compound-word hyphen
// (check-in), not a Hebrew prefix maqaf (ב-RushPoint), not an em/en dash. Use a
// space, a comma, a period, or a rephrase instead. The ONLY horizontal-bar
// character allowed is the true minus sign U+2212 (−), used for negative point
// values (−25 pts), which is a math symbol, not a dash.
//
// Banned (any one fails the gate):
//   U+002D hyphen-minus '-'   U+2010 hyphen        U+2011 non-breaking hyphen
//   U+2012 figure dash        U+2013 en dash '–'   U+2014 em dash '—'
//   U+2015 horizontal bar
// Allowed: U+2212 minus '−'.
//
// Scans BOTH apps' translation maps and covers BOTH plain string leaves AND
// function-valued entries (dynamic copy) by invoking each function with sample
// args and inspecting the rendered string — the looser old rule missed those.
// No emulator.
// Two parts, mirroring the i18n gate:
//   PART A — translation dictionaries (all copy that flows through t.*).
//   PART B — hardcoded UI strings in components (JSX text / text attributes /
//            dialog|error calls), so a stray hyphen can't hide in a literal that
//            bypasses the dictionary. Same UI-text-position detection as
//            scripts/check-i18n.ts → no className/import false positives. Suppress
//            a deliberate literal with a trailing `// i18n-ignore`.
//   npx tsx scripts/test-no-dashes.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { translations as creatorT } from '../apps/creator-web/src/i18n';
import { translations as playT } from '../apps/play-web/src/i18n';
import { LANDING_PAGES } from './lib/landingPages';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Every dash/hyphen EXCEPT the true minus sign U+2212.
// U+05BE HEBREW PUNCTUATION MAQAF is banned too. The rule always SAID so
// (CLAUDE.md: "not a Hebrew prefix maqaf"), but it was missing from this class, so
// four maqafs sat in shipped Hebrew copy while the gate stayed green. It renders as a
// dash to a reader, which is the whole point of the standard.
const BANNED_DASH = /[-‐‑‒–—―־]/;

// Render a function-valued i18n entry to its string. Entries take either
// positional primitives or a single options object; try both shapes and take the
// first that yields a string. A broad sample object covers every key our copy
// destructures (email, rank, team, game, url, …) so the literal template text —
// which is where a stray hyphen would live — is always exercised.
const SAMPLE_OBJ = {
  n: 2, count: 2, rank: 3, score: 100, points: 25, minutes: 10,
  dist: 40, radius: 50, r: 50, time: '12:00',
  email: 'a@b.com', name: 'Sample', title: 'Sample', team: 'Sample',
  game: 'Sample', url: 'example.com', rankPart: '', targetLang: 'en',
};
function render(fn: (...a: unknown[]) => unknown): string | null {
  for (const args of [[2, 'Sample', 'Sample', 'Sample'], [SAMPLE_OBJ]] as unknown[][]) {
    try {
      const r = fn(...args);
      if (typeof r === 'string') return r;
    } catch { /* try the next arg shape */ }
  }
  return null;
}

// Collect [dottedKey, renderedValue] for every leaf: strings directly, functions
// via render(). Unrenderable functions are reported so they can't hide a dash.
function leafStrings(obj: unknown, prefix = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (typeof obj === 'function') {
    const r = render(obj as (...a: unknown[]) => unknown);
    if (r === null) {
      console.log(`WARN  could not render function entry "${prefix}" — not dash-checked`);
      return [];
    }
    return [[prefix, r]];
  }
  if (obj === null || typeof obj !== 'object') return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...leafStrings(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

// ── PART A — dictionaries ─────────────────────────────────────────────────────
for (const [app, t] of [['creator-web', creatorT], ['play-web', playT]] as const) {
  for (const [lang, map] of [['he', t.he], ['en', t.en]] as const) {
    const offenders = leafStrings(map).filter(([, v]) => BANNED_DASH.test(v));
    check(`A · ${app}.${lang}: no hyphen or dash in copy`,
      offenders.length === 0,
      offenders.slice(0, 12).map(([k, v]) => `${k}="${v}"`).join(' | '));
  }
}

// ── PART B — hardcoded UI strings in component source ─────────────────────────
// Files whose literals are data/markup, not switchable UI chrome (kept in sync
// with check-i18n.ts's allow-list).
const FILE_ALLOWLIST = new Set([
  'i18n.ts', 'i18nContext.tsx', 'templates.ts', 'taskTemplates.ts',
  'LegalPage.tsx', 'legalMarkdown.ts',
]);
const TEXT_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label']);
const TEXT_CALL = /(alert|confirm|prompt|toast|Err|Error|message|Message)$/;
const SCAN_DIRS = [join(ROOT, 'apps/creator-web/src'), join(ROOT, 'apps/play-web/src')];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(ent.name) && !FILE_ALLOWLIST.has(ent.name)) out.push(full);
  }
  return out;
}
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const span of node.templateSpans) s += span.literal.text;
    return s;
  }
  return null;
}
function inUiTextPosition(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isJsxAttribute(p) && TEXT_ATTRS.has(p.name.getText())) return true;
  if (ts.isJsxExpression(p) && p.parent) {
    if (ts.isJsxAttribute(p.parent) && TEXT_ATTRS.has(p.parent.name.getText())) return true;
    if (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent)) return true;
  }
  if (ts.isCallExpression(p) && p.arguments.includes(node as ts.Expression)) {
    const fn = ts.isPropertyAccessExpression(p.expression) ? p.expression.name.text : p.expression.getText();
    if (TEXT_CALL.test(fn)) return true;
  }
  return false;
}

const sourceOffenders: string[] = [];
for (const dir of SCAN_DIRS) {
  for (const file of listSourceFiles(dir)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const raw = readFileSync(file, 'utf8');
    const lines = raw.split('\n');
    const sf = ts.createSourceFile(basename(file), raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const flag = (node: ts.Node, text: string) => {
      if (!BANNED_DASH.test(text)) return;
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const srcLine = lines[line] ?? '';
      if (/\bi18n-ignore\b/.test(srcLine)) return;            // deliberate exception
      if (/^https?:\/\//.test(text.trim())) return;           // a URL is not copy
      sourceOffenders.push(`${rel}:${line + 1} → "${text.trim().replace(/\s+/g, ' ').slice(0, 80)}"`);
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) {
        if (node.text.trim()) flag(node, node.text);
      } else {
        const txt = literalText(node);
        if (txt && txt.trim() && inUiTextPosition(node)) flag(node, txt);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}
check('B · no hyphen or dash in hardcoded UI strings', sourceOffenders.length === 0,
  sourceOffenders.slice(0, 20).join(' | '));

// ── PART C — SHIPPED PAGE METADATA (index.html + manifest.webmanifest) ────────
// The copy with the widest reach was the ONLY copy nobody checked. PART A scans the
// t.* dictionaries and PART B scans component source, but a <title> and a
// <meta name="description"> live in index.html, which is in neither — so an em dash
// sat in the Google result for both sites ("RushPoint — build your own field game",
// "Join the game — RushPoint") while `npm test` stayed green. The manifest's `name`
// and `description` are the same class of miss: they surface on the installed-app
// icon and the Android install prompt.
//
// Only human-facing VALUES are scanned. A URL, a hash, a mime type and an asset path
// legitimately contain hyphens (`rush-point.com`, `image/svg+xml`, `/icon-192.png`),
// so this checks the specific metadata fields that render as prose to a person, never
// whole attributes or whole files.
const HTML_TEXT_META = new Set([
  'description', 'twitter:title', 'twitter:description', 'twitter:image:alt',
  'og:title', 'og:description', 'og:image:alt', 'og:site_name', 'apple-mobile-web-app-title',
]);
const MANIFEST_TEXT_KEYS = new Set(['name', 'short_name', 'description']);

const metaOffenders: string[] = [];

// HTML comments are stripped before scanning. Two reasons, and the first one bit
// immediately: these files carry long explanatory comments that MENTION the tags they
// describe (`a <title> lives in neither`), so a naive non-greedy match ran from the
// comment's `<title>` to the real `</title>` and reported the comment as the title. And
// substantively, a comment is not shipped copy — a hyphen in prose explaining the rule
// must not fail the rule, nor should a commented-out <meta> tag count as live metadata.
const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '');

for (const app of ['creator-web', 'play-web']) {
  // index.html — <title> plus the prose <meta> fields listed above.
  const htmlRel = `apps/${app}/index.html`;
  const html = stripComments(readFileSync(join(ROOT, htmlRel), 'utf8'));

  const title = /<title>([\s\S]*?)<\/title>/.exec(html);
  if (title && BANNED_DASH.test(title[1])) {
    metaOffenders.push(`${htmlRel} <title> → "${title[1].trim()}"`);
  }

  const metaRe = /<meta\s+(?:name|property)=["']([^"']+)["']\s+content=["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html))) {
    const [, key, value] = m;
    if (!HTML_TEXT_META.has(key)) continue;
    if (BANNED_DASH.test(value)) metaOffenders.push(`${htmlRel} ${key} → "${value.trim()}"`);
  }

  // manifest.webmanifest — the installed-app name/description.
  const manRel = `apps/${app}/public/manifest.webmanifest`;
  const manifest = JSON.parse(readFileSync(join(ROOT, manRel), 'utf8')) as Record<string, unknown>;
  for (const key of MANIFEST_TEXT_KEYS) {
    const v = manifest[key];
    if (typeof v === 'string' && BANNED_DASH.test(v)) {
      metaOffenders.push(`${manRel} ${key} → "${v}"`);
    }
  }
}

check('C · no hyphen or dash in shipped page metadata (title/description/OG/manifest)',
  metaOffenders.length === 0, metaOffenders.join(' | '));

// The gate is only worth as much as its reach: assert it actually FOUND the fields it
// claims to police, so a future markup reshuffle that makes every regex miss shows up
// as a failure instead of a silent pass over zero fields.
let scanned = 0;
for (const app of ['creator-web', 'play-web']) {
  const html = stripComments(readFileSync(join(ROOT, `apps/${app}/index.html`), 'utf8'));
  if (/<title>[\s\S]*?<\/title>/.test(html)) scanned++;
  const metaRe = /<meta\s+(?:name|property)=["']([^"']+)["']\s+content=["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html))) if (HTML_TEXT_META.has(m[1])) scanned++;
}
check('C · the metadata scan actually reached the fields it polices', scanned >= 14, `${scanned} field(s)`);

// ── PART D — STATIC LANDING PAGE COPY ────────────────────────────────────────
// Same lesson as PART C, one surface further out. The landing pages under
// apps/play-web/public/ are prose Google prints directly, and they live in NEITHER of the
// places the earlier parts look: not in a t.* dictionary (a static HTML file cannot
// import the module graph) and not in component source. PART C does not reach them either
// — it scans `apps/<app>/index.html` by name, and these are different files entirely.
//
// The REGISTRY is scanned rather than the generated HTML, deliberately: the registry is
// where a human types, so an offender can be named by its field path
// (`en/home.sections[0].paragraphs[1]`) instead of by a line number in generated markup
// that the author would then have to trace back by hand.
//
// Slugs and URLs are NOT scanned. The standard governs prose and explicitly exempts file
// paths, so `bar-mitzva` and `rush-point.com` are correct as they are.
const landingOffenders: string[] = [];
let landingScanned = 0;

for (const page of LANDING_PAGES) {
  const label = `${page.language}/${page.subject}`;
  const fields: Array<[string, string]> = [
    [`${label}.title`, page.title],
    [`${label}.description`, page.description],
    [`${label}.headline`, page.headline],
    [`${label}.intro`, page.intro],
    [`${label}.ctaLabel`, page.ctaLabel],
  ];
  page.sections.forEach((s, i) => {
    fields.push([`${label}.sections[${i}].heading`, s.heading]);
    s.paragraphs.forEach((t, j) => fields.push([`${label}.sections[${i}].paragraphs[${j}]`, t]));
  });

  for (const [where, value] of fields) {
    landingScanned++;
    if (BANNED_DASH.test(value)) landingOffenders.push(`${where} → "${value.trim()}"`);
  }
}

check('D · no hyphen or dash in static landing page copy',
  landingOffenders.length === 0, landingOffenders.join(' | '));

// Same reach assertion as PART C, for the same reason: a registry reshape that made the
// loop above iterate nothing would turn this into a green line that checked no copy at
// all, which is worse than no gate because it looks like one.
check('D · the landing page scan actually reached the copy', landingScanned >= 100,
  `${landingScanned} field(s)`);

// ── PART E — MARKETING SITE CONTENT ──────────────────────────────────────────
// One surface further out again, and the one with the least protection of all.
//
// The marketing site (apps/marketing) has no t.* dictionary, so PART A cannot see it, and
// its copy is not JSX, so PART B cannot either. Worse than the landing pages: most of this
// copy will eventually be typed by whoever is AUTHORING, through a browser CMS that gives
// no hint the standard exists. A rule enforced only where developers type is not enforced
// where most of the words come from.
//
// Two sources, scanned differently because they fail differently:
//   • src/copy/*.ts   — per language prose modules. String literals only, and only the
//                       ones that are prose: an icon name (`tabler:map-pin`) and a CSS
//                       class (`text-accent`) both contain hyphens and both are exempt
//                       under the standard's existing carve out for class names.
//   • src/data/post/* — Markdown. Frontmatter PROSE fields plus the body. A hyphen that is
//                       Markdown SYNTAX is not copy: a list marker, a thematic break and a
//                       setext underline all render as structure, not as a dash in a
//                       sentence. Code fences and inline code are exempt for exactly the
//                       reason code comments already are.
//
// Slugs, tags, urls and filenames are NOT scanned: the standard exempts file paths, and a
// url safe slug is required to use hyphens by the schema that validates it.
const MARKETING_COPY_DIR = join(ROOT, 'apps', 'marketing', 'src', 'copy');
const MARKETING_POST_DIR = join(ROOT, 'apps', 'marketing', 'src', 'data', 'post');

const marketingOffenders: string[] = [];
let marketingScanned = 0;

/** True for a literal that is an identifier rather than something a reader reads. */
function isNotProse(literal: string): boolean {
  return (
    /^tabler:/.test(literal) ||               // icon name
    /^https?:/.test(literal) ||               // url
    /^\//.test(literal) ||                    // path
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(literal) || // slug or single css class
    /^[a-z-]+(\s+[a-z0-9:_-]+)+$/.test(literal) || // css class list
    !/[A-Za-z֐-׿]/.test(literal)    // no letters at all
  );
}

if (existsSync(MARKETING_COPY_DIR)) {
  for (const file of readdirSync(MARKETING_COPY_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(MARKETING_COPY_DIR, file), 'utf8');
    source.split(/\r?\n/).forEach((line, i) => {
      // Comments are exempt, exactly as they are everywhere else in this standard.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const [, literal] of line.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
        if (isNotProse(literal)) continue;
        // Markup inside prose is not prose. A headline may wrap a word in
        // <span class="text-accent"> to highlight it, and that class name is
        // already exempt under the standard's carve out for class names; leaving
        // the tag in would report the author for the framework's punctuation.
        const prose = literal.replace(/<[^>]*>/g, ' ');
        marketingScanned++;
        if (BANNED_DASH.test(prose)) {
          marketingOffenders.push(`${file}:${i + 1} → "${prose.trim().slice(0, 70)}"`);
        }
      }
    });
  }
}

if (existsSync(MARKETING_POST_DIR)) {
  for (const file of readdirSync(MARKETING_POST_DIR).filter((f) => /\.mdx?$/.test(f))) {
    const raw = readFileSync(join(MARKETING_POST_DIR, file), 'utf8').replace(/\r\n/g, '\n');
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const frontmatter = fm ? fm[1] : '';
    const body = fm ? fm[2] : raw;
    // Body line numbers must be reported as FILE line numbers. Reporting the
    // offset within the body sends the reader to the wrong line, which turns a
    // precise failure into a hunt.
    const bodyStartLine = fm ? frontmatter.split('\n').length + 2 : 0;

    // Frontmatter: prose fields only. slug, tags, image, video and pairedSubject are
    // identifiers and are required to contain hyphens.
    for (const key of ['title', 'excerpt']) {
      const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      if (!m) continue;
      marketingScanned++;
      if (BANNED_DASH.test(m[1])) {
        marketingOffenders.push(`${file} frontmatter.${key} → "${m[1].trim().slice(0, 70)}"`);
      }
    }

    // Body, with Markdown syntax and code removed rather than tolerated: stripping them
    // means a real dash inside a sentence on the SAME line is still caught.
    let inFence = false;
    body.split('\n').forEach((line, i) => {
      if (/^\s*```/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) return;   // thematic break
      if (/^\s*(-|={2,})+\s*$/.test(line)) return;             // setext underline

      const text = line
        .replace(/^\s*[-*+]\s+/, '')          // list marker
        .replace(/`[^`]*`/g, ' ')             // inline code
        .replace(/\]\([^)]*\)/g, '] ')        // link target
        .replace(/^\s*\d+\.\s+/, '');         // ordered list marker

      if (!/[A-Za-z֐-׿]/.test(text)) return;
      marketingScanned++;
      if (BANNED_DASH.test(text)) {
        marketingOffenders.push(`${file}:${bodyStartLine + i + 1} → "${text.trim().slice(0, 70)}"`);
      }
    });
  }
}

// The PAGE content files. The standing pages moved out of `src/copy/*.ts` into
// JSON (change: editable-pages-and-media), and this part was left scanning the
// directory they came from. The reach assertion below is what caught it: the
// field count fell from 226 to 95 while every offender check stayed green,
// because there was almost nothing left to find.
const MARKETING_PAGES_DIR = join(ROOT, 'apps', 'marketing', 'src', 'data', 'pages');

if (existsSync(MARKETING_PAGES_DIR)) {
  // Identifiers, not prose: media paths, icon names and the media discriminator
  // are Latin by necessity in both languages, and the standard already exempts
  // file paths.
  const NOT_PROSE_KEY = /(^|\.)(src|poster|icon|kind)$/;

  const leavesOf = (value: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> => {
    if (typeof value === 'string') {
      out.push([path, value]);
      return out;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => leavesOf(v, `${path}[${i}]`, out));
      return out;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) leavesOf(v, path ? `${path}.${k}` : k, out);
    }
    return out;
  };

  for (const file of readdirSync(MARKETING_PAGES_DIR).filter((f) => f.endsWith('.json'))) {
    const parsed: unknown = JSON.parse(readFileSync(join(MARKETING_PAGES_DIR, file), 'utf8'));
    for (const [path, text] of leavesOf(parsed, '', [])) {
      if (NOT_PROSE_KEY.test(path)) continue;
      if (!/[A-Za-z֐-׿]/.test(text)) continue;
      marketingScanned++;
      // Markup inside prose is not prose, same as the copy modules above.
      const prose = text.replace(/<[^>]*>/g, ' ');
      if (BANNED_DASH.test(prose)) {
        marketingOffenders.push(`${file} ${path} → "${prose.trim().slice(0, 60)}"`);
      }
    }
  }
}

check('E · no hyphen or dash in marketing site content',
  marketingOffenders.length === 0, marketingOffenders.slice(0, 6).join(' | '));

// The reach assertion, same reason as C and D: this whole part is a set of absences, and
// an empty input set satisfies every one of them.
check('E · the marketing content scan actually reached the copy', marketingScanned >= 100,
  `${marketingScanned} field(s)`);

// ── PART F — NO COLON IN A SHIPPED PAGE TITLE ────────────────────────────────
// A different rule from the dash standard above, deliberately much narrower, and the
// narrowness is the whole design. A colon INSIDE A SENTENCE is ordinary punctuation and
// this product's descriptions and paragraphs use it correctly in a dozen places; banning
// it everywhere would either fail correct copy or collect exemptions until it meant
// nothing. What is actually wrong is a colon in a NAME.
//
// Every title we shipped read `RushPoint: build your own real world field game`. In a
// search result that spends the first eleven characters, the ones a reader scans hardest,
// on the brand, and pushes the words they were actually searching for to the right of a
// piece of punctuation doing the work of a sentence. The house pattern was already decided
// and written down for the marketing site (apps/marketing/src/config.yaml: "A COMMA, not
// an em dash", applied as `%s, RushPoint`); the applications and the landing pages simply
// predate it.
//
// VALUES ONLY, never whole tags. `<meta property="og:title" ...>` carries a colon in its
// KEY on every page ever written, so a rule applied to tag text would fail universally and
// be deleted within the day. Same reason URLs, times and codes are not scanned: a colon is
// only a defect where a human reads a name.
const BANNED_TITLE_SEPARATOR = /:/;
/** The metadata whose value Google prints AS the link. Not descriptions. */
const HTML_TITLE_META = new Set(['og:title', 'twitter:title']);
const MANIFEST_TITLE_KEYS = new Set(['name', 'short_name']);

const titleOffenders: string[] = [];
let titlesScanned = 0;

for (const app of ['creator-web', 'play-web']) {
  const htmlRel = `apps/${app}/index.html`;
  const html = stripComments(readFileSync(join(ROOT, htmlRel), 'utf8'));

  const title = /<title>([\s\S]*?)<\/title>/.exec(html);
  if (title) {
    titlesScanned++;
    if (BANNED_TITLE_SEPARATOR.test(title[1])) {
      titleOffenders.push(`${htmlRel} <title> → "${title[1].trim()}"`);
    }
  }

  const metaRe = /<meta\s+(?:name|property)=["']([^"']+)["']\s+content=["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html))) {
    const [, key, value] = m;
    // `key` is matched against the set and then DISCARDED. Only `value` is tested, which is
    // what keeps `og:title` from reporting itself.
    if (!HTML_TITLE_META.has(key)) continue;
    titlesScanned++;
    if (BANNED_TITLE_SEPARATOR.test(value)) {
      titleOffenders.push(`${htmlRel} ${key} → "${value.trim()}"`);
    }
  }

  const manRel = `apps/${app}/public/manifest.webmanifest`;
  const manifest = JSON.parse(readFileSync(join(ROOT, manRel), 'utf8')) as Record<string, unknown>;
  for (const key of MANIFEST_TITLE_KEYS) {
    const v = manifest[key];
    if (typeof v !== 'string') continue;
    titlesScanned++;
    if (BANNED_TITLE_SEPARATOR.test(v)) titleOffenders.push(`${manRel} ${key} → "${v}"`);
  }
}

for (const page of LANDING_PAGES) {
  titlesScanned++;
  if (BANNED_TITLE_SEPARATOR.test(page.title)) {
    titleOffenders.push(`${page.language}/${page.subject}.title → "${page.title}"`);
  }
}

// The MARKETING site's titles. PART F was written for the two applications and the
// landing pages, and skipped the apex entirely — which is the surface the rule was
// actually about. `%s, RushPoint` is declared in apps/marketing/src/config.yaml with a
// comment saying "A COMMA, not an em dash", but a comment is not a gate: the template,
// the default title, every standing page's title and every post's title are all free to
// grow a colon, and the apex title is the single most read line this product publishes.
const MARKETING_ROOT = join(ROOT, 'apps', 'marketing');
const MARKETING_CONFIG = join(MARKETING_ROOT, 'src', 'config.yaml');

if (existsSync(MARKETING_CONFIG)) {
  const yaml = readFileSync(MARKETING_CONFIG, 'utf8');
  // The two title fields under `metadata.title`, read by their own keys rather than by
  // parsing the document: a dependency free regex cannot go stale against a YAML parser
  // version, and a key that is renamed away simply stops contributing — which the reach
  // assertion below then catches.
  for (const key of ['default', 'template']) {
    const m = new RegExp(`^\\s{4}${key}:\\s*(.+)$`, 'm').exec(yaml);
    if (!m) continue;
    const value = m[1].trim().replace(/^['"]|['"]$/g, '');
    titlesScanned++;
    if (BANNED_TITLE_SEPARATOR.test(value)) {
      titleOffenders.push(`marketing config.yaml metadata.title.${key} → "${value}"`);
    }
  }
}

// Every standing page, both languages. `title` is what the template wraps and what
// Google prints as the link.
if (existsSync(MARKETING_PAGES_DIR)) {
  for (const file of readdirSync(MARKETING_PAGES_DIR).filter((f) => f.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(MARKETING_PAGES_DIR, file), 'utf8')) as Record<string, unknown>;
    const title = parsed.title;
    if (typeof title !== 'string') continue;
    titlesScanned++;
    if (BANNED_TITLE_SEPARATOR.test(title)) {
      titleOffenders.push(`marketing ${file} title → "${title}"`);
    }
  }
}

// Blog posts. Only the frontmatter `title`, for the same reason as everywhere else in
// this part: a colon inside the body is ordinary punctuation and is not scanned.
if (existsSync(MARKETING_POST_DIR)) {
  for (const file of readdirSync(MARKETING_POST_DIR).filter((f) => /\.mdx?$/.test(f))) {
    const raw = readFileSync(join(MARKETING_POST_DIR, file), 'utf8').replace(/\r\n/g, '\n');
    const fm = /^---\n([\s\S]*?)\n---/.exec(raw);
    if (!fm) continue;
    const m = /^title:\s*(.+)$/m.exec(fm[1]);
    if (!m) continue;
    const value = m[1].trim().replace(/^['"]|['"]$/g, '');
    titlesScanned++;
    if (BANNED_TITLE_SEPARATOR.test(value)) {
      titleOffenders.push(`marketing ${file} frontmatter.title → "${value}"`);
    }
  }
}

check('F · no colon in a shipped page title', titleOffenders.length === 0, titleOffenders.join(' | '));

// The same reach assertion PARTS C, D and E carry, for the same reason: this part is a set
// of absences, and an empty input set satisfies every one of them. Two apps contribute a
// title, two title meta fields and two manifest keys each, plus twelve landing pages,
// plus the marketing site's two config fields and six standing page titles.
check('F · the title scan actually reached the titles', titlesScanned >= 28, `${titlesScanned} title(s)`);

console.log(`\n${failures === 0 ? 'ALL NO-DASHES TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
