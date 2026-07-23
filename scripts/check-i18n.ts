// ─────────────────────────────────────────────────────────────────────────────
// i18n correctness gate — "Hebrew is really Hebrew, English is really English."
//
//   npm run i18n:check               # report + fail on dictionary errors (the gate)
//   npm run i18n:check:strict        # ALSO fail on hardcoded-string warnings
//
// WHY THIS EXISTS: users repeatedly saw English text in the UI while the app was
// set to Hebrew (especially in the task builder). Two root causes:
//   1. A Hebrew dictionary value was accidentally left in English (or vice-versa).
//   2. A component hardcoded a UI string instead of pulling it from `t.*`, so it
//      never switches language.
// This script catches both, for BOTH apps (creator-web + play-web), and prints
// the exact file/key location of every problem so it can be fixed immediately.
//
// ── Tiers ────────────────────────────────────────────────────────────────────
// ERRORS  (always fail, exit 1) — deterministic, zero false positives:
//   A1  HE and EN have identical key sets (no missing key → no silent fallback)
//   A2  Same key is a function in both langs, or a string in both (no type drift)
//   A3  Every HE leaf (string AND function output) contains NO English words
//   A4  Every EN leaf (string AND function output) contains NO Hebrew letters
//
// WARNINGS (printed always; fail only with --strict) — AST-based source scan:
//   B1  Hardcoded Hebrew in JSX text / text attribute / dialog|error call
//       (bypasses i18n → won't switch to English).
//   B2  Hardcoded English in the same positions (bypasses i18n → won't switch
//       to Hebrew).
// The scan parses each file with the TypeScript compiler, so generics like
// `Promise<void>` are never mistaken for UI text. Suppress a deliberate line
// with a trailing `// i18n-ignore` comment.
//
// No emulator needed.  Run: npx tsx scripts/check-i18n.ts
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { translations as creatorT } from '../apps/creator-web/src/i18n';
import { translations as playT } from '../apps/play-web/src/i18n';
// The A3/A4 leak predicates live in ONE place — scripts/lib/i18nLeak.ts — so this
// authoritative gate and scripts/test-i18n-parity.ts cannot drift apart (they used
// to be near-duplicate copies "kept in sync" by a comment, and both carried the
// same {placeholder} defect). Unit-tested by scripts/test-i18n-leak.ts.
import { HEBREW, hasEnglishWord, hasHebrew } from './lib/i18nLeak';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STRICT = process.argv.includes('--strict');

const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ── Universal sample arg ─────────────────────────────────────────────────────
// i18n function entries take either positional primitives — (n: number),
// (name: string), (terms, privacy) — or a single destructured object —
// ({ done, total }). One Proxy satisfies all of them: it coerces to a
// language-neutral token ('0' / 0) and answers any property access with 0.
function sampleArg(): unknown {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return (hint: string) => (hint === 'string' ? '0' : 0);
      if (prop === 'toString') return () => '0';
      if (prop === 'valueOf') return () => 0;
      if (prop === Symbol.iterator) return undefined;
      return 0;
    },
  });
}

type Leaf = { path: string; value: string };

function walkLeaves(obj: unknown, prefix = ''): Leaf[] {
  if (typeof obj === 'string') return [{ path: prefix, value: obj }];
  if (typeof obj === 'function') {
    try {
      const out = (obj as (...a: unknown[]) => unknown)(sampleArg(), sampleArg(), sampleArg());
      return typeof out === 'string' ? [{ path: prefix, value: out }] : [];
    } catch {
      return [{ path: prefix, value: '__UNEVALUATABLE_FN__' }];
    }
  }
  if (obj === null || typeof obj !== 'object') return [];
  const out: Leaf[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...walkLeaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

function keysDeep(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || typeof obj === 'function') return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.push(...keysDeep(v, prefix ? `${prefix}.${k}` : k));
  }
  return out.sort();
}

function leafTypes(obj: unknown, prefix = '', acc: Record<string, string> = {}): Record<string, string> {
  if (obj === null || typeof obj !== 'object' || typeof obj === 'function') {
    acc[prefix] = typeof obj;
    return acc;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    leafTypes(v, prefix ? `${prefix}.${k}` : k, acc);
  }
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART A — dictionary integrity (hard errors)
// ─────────────────────────────────────────────────────────────────────────────
const errors: string[] = [];

const APPS = [
  ['creator-web', creatorT],
  ['play-web', playT],
] as const;

for (const [app, t] of APPS) {
  const heKeys = keysDeep(t.he);
  const enKeys = keysDeep(t.en);

  if (JSON.stringify(heKeys) !== JSON.stringify(enKeys)) {
    const heSet = new Set(heKeys);
    const enSet = new Set(enKeys);
    const missingInEn = heKeys.filter((k) => !enSet.has(k));
    const missingInHe = enKeys.filter((k) => !heSet.has(k));
    if (missingInEn.length) errors.push(`[${app}] A1 keys in HE but missing in EN: ${missingInEn.join(', ')}`);
    if (missingInHe.length) errors.push(`[${app}] A1 keys in EN but missing in HE: ${missingInHe.join(', ')}`);
  }

  const heTypes = leafTypes(t.he);
  const enTypes = leafTypes(t.en);
  for (const k of Object.keys(heTypes)) {
    if (k in enTypes && heTypes[k] !== enTypes[k]) {
      errors.push(`[${app}] A2 type drift at "${k}": HE is ${heTypes[k]}, EN is ${enTypes[k]}`);
    }
  }

  for (const { path, value } of walkLeaves(t.he)) {
    if (value === '__UNEVALUATABLE_FN__') { errors.push(`[${app}] could not evaluate HE function at "${path}"`); continue; }
    if (hasEnglishWord(value)) errors.push(`[${app}] A3 English leaked into HE at "${path}": "${value}"`);
  }
  for (const { path, value } of walkLeaves(t.en)) {
    if (value === '__UNEVALUATABLE_FN__') { errors.push(`[${app}] could not evaluate EN function at "${path}"`); continue; }
    if (hasHebrew(value)) errors.push(`[${app}] A4 Hebrew leaked into EN at "${path}": "${value}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PART B — hardcoded UI strings bypassing i18n (AST-based)
// ─────────────────────────────────────────────────────────────────────────────
const warnings: string[] = [];

// Files whose Hebrew/English literals are data, not switchable chrome.
const FILE_ALLOWLIST = new Set([
  'i18n.ts', 'i18nContext.tsx', 'templates.ts', 'taskTemplates.ts',
  'LegalPage.tsx', 'legalMarkdown.ts',
]);

// JSX attributes that carry visible text (so a literal there is real UI copy).
const TEXT_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label']);
// Call names whose string args are shown to the user.
const TEXT_CALL = /(alert|confirm|prompt|toast|Err|Error|message|Message)$/;

const SCAN_DIRS = [
  join(ROOT, 'apps', 'creator-web', 'src'),
  join(ROOT, 'apps', 'play-web', 'src'),
];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(ent.name) && !FILE_ALLOWLIST.has(ent.name)) out.push(full);
  }
  return out;
}

// Literal text from a string literal or a no-substitution / interpolated template.
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const span of node.templateSpans) s += span.literal.text;
    return s;
  }
  return null;
}

// Is this string/template literal in a position that renders as UI text?
function inUiTextPosition(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  // JSX attribute value: placeholder="…", title="…", aria-label="…"
  if (ts.isJsxAttribute(p) && TEXT_ATTRS.has(p.name.getText())) return true;
  // JSX expression container holding only this literal: <div>{'text'}</div> / aria-label={`…`}
  if (ts.isJsxExpression(p) && p.parent) {
    if (ts.isJsxAttribute(p.parent) && TEXT_ATTRS.has(p.parent.name.getText())) return true;
    if (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent)) return true;
  }
  // user-facing call: dialog.alert('…'), setSearchErr('…'), confirm(`…`)
  if (ts.isCallExpression(p) && p.arguments.includes(node as ts.Expression)) {
    const fn = ts.isPropertyAccessExpression(p.expression) ? p.expression.name.text : p.expression.getText();
    if (TEXT_CALL.test(fn)) return true;
  }
  return false;
}

for (const dir of SCAN_DIRS) {
  for (const file of listSourceFiles(dir)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const raw = readFileSync(file, 'utf8');
    const lines = raw.split('\n');
    const sf = ts.createSourceFile(basename(file), raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const report = (node: ts.Node, text: string, tier: 'B1' | 'B2', label: string) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const srcLine = lines[line] ?? '';
      const trimmed = text.trim();
      if (/^\S+@\S+\.\S+$/.test(trimmed) || /^https?:\/\//.test(trimmed)) return; // email/URL placeholder
      if (/\bi18n-ignore\b/.test(srcLine)) return;
      if (/\blang\s*[=!]==|\blang\s*\?/.test(srcLine)) return; // bilingual inline guard
      warnings.push(`${rel}:${line + 1}  ${tier} ${label} → ${c.dim(text.trim().replace(/\s+/g, ' ').slice(0, 80))}`);
    };

    const visit = (node: ts.Node) => {
      // Visible JSX text node: <div>Launch run</div>
      if (ts.isJsxText(node)) {
        const txt = node.text.trim();
        if (txt) {
          if (HEBREW.test(txt)) report(node, txt, 'B1', 'hardcoded Hebrew (use t.*)');
          else if (hasEnglishWord(txt)) report(node, txt, 'B2', 'hardcoded English (use t.*)');
        }
      } else {
        // String / template literal in a UI-text position
        const txt = literalText(node);
        if (txt && txt.trim() && inUiTextPosition(node)) {
          if (HEBREW.test(txt)) report(node, txt, 'B1', 'hardcoded Hebrew (use t.*)');
          else if (hasEnglishWord(txt)) report(node, txt, 'B2', 'hardcoded English (use t.*)');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

warnings.sort();

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────
console.log(c.bold('\n🌐 i18n correctness check — Hebrew↔English UI parity\n'));

if (errors.length === 0) {
  console.log(c.green('✓ PART A (dictionaries): keys parity-matched; HE is pure Hebrew, EN is pure English.'));
} else {
  console.log(c.red(`✗ PART A (dictionaries): ${errors.length} error(s)\n`));
  for (const e of errors) console.log('  ' + c.red(e));
}

console.log('');
if (warnings.length === 0) {
  console.log(c.green('✓ PART B (source scan): no hardcoded UI strings bypassing i18n.'));
} else {
  const tag = STRICT
    ? c.red(`✗ PART B (source scan): ${warnings.length} hardcoded string(s)`)
    : c.yellow(`⚠ PART B (source scan): ${warnings.length} hardcoded string(s) — fix, or mark the line // i18n-ignore`);
  console.log(tag + '\n');
  for (const w of warnings) console.log('  ' + w);
}

const failed = errors.length > 0 || (STRICT && warnings.length > 0);
console.log('');
if (failed) {
  console.log(c.red(c.bold('✗ i18n check FAILED — fix the locations above before shipping UI changes.')));
  process.exit(1);
}
if (warnings.length > 0) {
  console.log(c.yellow(c.bold(`✓ Dictionaries clean. ${warnings.length} hardcoded-string warning(s) to review (run :strict to enforce).`)));
} else {
  console.log(c.green(c.bold('✓ i18n check PASSED — Hebrew is Hebrew, English is English, nothing hardcoded.')));
}
process.exit(0);
