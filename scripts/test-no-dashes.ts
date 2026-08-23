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
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { translations as creatorT } from '../apps/creator-web/src/i18n';
import { translations as playT } from '../apps/play-web/src/i18n';

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

console.log(`\n${failures === 0 ? 'ALL NO-DASHES TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
