// Pure static scanners for the participant app's accessibility invariants
// (change: play-web-accessibility).
//
// play-web has no component test runner (CLAUDE.md: "UI → verify via the preview
// tools"), so the only durable protection for a11y markup is a SOURCE scan. These
// are the three regressions that are decidable from the token text alone, plus the
// one that is real arithmetic:
//
//   1. a physical-direction Tailwind class (Hebrew is the DEFAULT language here, so
//      `ml-2` is a mainline bug, not an edge case);
//   2. a <button> whose only content is an icon and which exposes no accessible
//      name (a screen reader announces "button" and nothing else);
//   3. an onClick on a non-interactive element (mouse/touch only, no keyboard);
//   4. contrastRatio — WCAG 2.1 relative luminance, used to assert that the theme's
//      ink colours still clear AA against the app's surfaces;
//   5. white text on a brand FILL (`text-white` + `bg-rp-alert`) — the mirror of 4,
//      and equally decidable: both colours are named in the same class string.
//
// Deliberately NOT here: tap-target size and contrast-in-context. Neither can be
// decided from a class string without a layout engine (a `min-h-[44px]` on a hidden
// element, a padded parent, a `<Button>` wrapper), and a guard that guesses becomes
// a guard people disable. See openspec/changes/play-web-accessibility/design.md.
//
// Every function is pure and total: it takes source text and returns findings. No
// filesystem access inside a scanner — the ONE fs helper (playWebTsxFiles) is kept
// separate so the scanners can be unit-tested against synthetic fixtures.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Finding {
  file: string;
  line: number;
  detail: string;
}

// ── 1. Physical-direction layout classes ─────────────────────────────────────
// Matched only in a class POSITION (inside a className string / template literal),
// which we approximate by requiring a class-token boundary on both sides: start of
// string, whitespace, a quote, a backtick, `{`, or a Tailwind variant colon.
//
// `rounded-lg`, `overflow-x-auto`, `grid-rows-2` and the English word "left" in a
// comment must never match, so the alternation is anchored to the exact utility
// prefixes and each requires its own separator.
// A WHOLE class token must match: optional negative sign, optional Tailwind
// variants (`sm:`, `hover:`), one of the physical utilities, and then either
// nothing or a `-value`. Anchoring both ends is what keeps the near-misses out:
// `rounded-lg` (the `g` does not start with `-`), `border-rp-alert/30`,
// `text-lefty`, `p-4`, `overflow-x-auto`, `ps-1`, `pe-1`, `ms-2`, `me-3`.
// Utilities that are meaningless without a value (`ml-2`, `left-0`). A bare
// `left` is not a Tailwind class at all — it is the JS identifier in
// `${left <= 5 ? … }`, so requiring the value is what keeps that out.
const PHYSICAL_VALUED = ['m[lr]', 'p[lr]', 'left', 'right'];
// Utilities that are valid on their own (`border-l`, `text-right`).
const PHYSICAL_BARE = ['border-[lr]', 'rounded-[lr]', 'text-left', 'text-right'];
const PHYSICAL_TOKEN_RE = new RegExp(
  '^-?(?:[a-z-]+:)*(?:'
  + `(?:${PHYSICAL_VALUED.join('|')})-[a-z0-9./\\[\\]%-]+`
  + `|(?:${PHYSICAL_BARE.join('|')})(?:-[a-z0-9./\\[\\]%-]+)?`
  + ')$',
);

// Tokens are read out of STRING LITERALS only (double, single, backtick). Prose in
// a JSX text node or a `// comment` is therefore never scanned, while a multi-line
// backtick class string (ui.tsx's Button variants) still is.
const STRING_LITERAL_RE = /"[^"\n]*"|'[^'\n]*'|`[\s\S]*?`/g;

// Symmetric idioms that render identically in RTL and LTR. `left-1/2` paired with
// `-translate-x-1/2` is the standard centring trick — flagging it would push people
// toward a worse workaround.
function isSymmetricCentring(cls: string, literal: string): boolean {
  return /^left-1\/2$/.test(cls) && literal.includes('-translate-x-1/2');
}

export function findPhysicalDirectionClasses(source: string, file = ''): Finding[] {
  const out: Finding[] = [];
  const src = String(source ?? '');
  for (const m of src.matchAll(STRING_LITERAL_RE)) {
    const literal = m[0];
    const startLine = src.slice(0, m.index ?? 0).split('\n').length;
    // Split on everything that cannot appear inside a Tailwind class token.
    literal.split(/[\s"'`{}()$,;]+/).forEach((tok) => {
      if (!tok || !PHYSICAL_TOKEN_RE.test(tok)) return;
      if (isSymmetricCentring(tok, literal)) return;
      out.push({ file, line: startLine, detail: `physical direction class "${tok}"` });
    });
  }
  return out;
}

// ── 2. Icon-only buttons with no accessible name ─────────────────────────────
// A lowercase <button> (a capitalised <Button> is a component, whose own
// implementation is checked elsewhere) whose text content contains no letter or
// digit in any script AND no JSX expression, and which carries none of
// aria-label / aria-labelledby / title.
const BUTTON_RE = /<button\b([^>]*?)(\/)?>([\s\S]*?)<\/button>/g;
const NAME_ATTR = /\b(aria-label|aria-labelledby|title)\s*=/;
// Any letter or digit in any script (Latin, Hebrew, Arabic, CJK, …).
const HAS_WORD = /[\p{L}\p{N}]/u;

export function findUnlabelledIconButtons(source: string, file = ''): Finding[] {
  const out: Finding[] = [];
  const src = String(source ?? '');
  for (const m of src.matchAll(BUTTON_RE)) {
    const attrs = m[1] ?? '';
    const body = m[3] ?? '';
    if (NAME_ATTR.test(attrs)) continue;
    // A JSX expression child ({t.play.foo}, {children}, {label}) supplies text we
    // cannot resolve statically — assume it is real copy and do not flag.
    if (body.includes('{')) continue;
    // Strip JSX comments before judging the body.
    const text = body.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim();
    if (text.length === 0 || !HAS_WORD.test(text)) {
      const line = src.slice(0, m.index ?? 0).split('\n').length;
      out.push({
        file,
        line,
        detail: `icon-only <button> with no accessible name: "${text.slice(0, 24) || '(empty)'}"`,
      });
    }
  }
  return out;
}

// ── 3. onClick on a non-interactive element ──────────────────────────────────
// Native interactive elements (button, a, input, select, textarea, label, summary)
// and capitalised components are exempt. A div that opts in fully — role="button"
// AND a tab stop AND a key handler — is exempt too, since that is the documented
// escape hatch.
const NON_INTERACTIVE = ['div', 'span', 'li', 'p', 'img', 'section', 'article', 'td', 'tr'];
const OPEN_TAG_RE = new RegExp(`<(${NON_INTERACTIVE.join('|')})\\b([^>]*)>`, 'g');

export function findClickableNonInteractive(source: string, file = ''): Finding[] {
  const out: Finding[] = [];
  const src = String(source ?? '');
  for (const m of src.matchAll(OPEN_TAG_RE)) {
    const tag = m[1];
    const attrs = m[2] ?? '';
    if (!/\bonClick\s*=/.test(attrs)) continue;
    const fullyOptedIn = /role\s*=\s*["'{]?button/.test(attrs)
      && /\btabIndex\s*=/.test(attrs)
      && /\bonKey(Down|Up|Press)\s*=/.test(attrs);
    if (fullyOptedIn) continue;
    const line = src.slice(0, m.index ?? 0).split('\n').length;
    out.push({ file, line, detail: `onClick on a non-interactive <${tag}>` });
  }
  return out;
}

// ── 4. WCAG 2.1 contrast ─────────────────────────────────────────────────────
function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const h = String(hex ?? '').trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return Number.NaN;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Symmetric WCAG contrast ratio, 1..21. NaN for an unparseable colour. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (!Number.isFinite(la) || !Number.isFinite(lb)) return Number.NaN;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ── 5. White text on a brand fill ────────────────────────────────────────────
// The ink-* tokens fixed COLOURED TEXT ON A SURFACE. The mirror case is the one
// the theme still got wrong: WHITE text on a saturated brand FILL. `text-white`
// + `bg-rp-alert` is 3.76:1 and `text-white` + `bg-accent` is 3.16:1 — both below
// AA, both on controls a participant taps while walking in sun.
//
// Unlike tap-target size, this IS decidable from the token text: both colours are
// named in the same class string and both resolve through the tailwind config. To
// stay a guard rather than a nag it is deliberately narrow:
//   • the literal must contain the bare token `text-white`;
//   • only a BARE, opaque `bg-<token>` counts — `bg-accent/15` (a translucent
//     tint, never a white-text surface) and `bg-gradient-to-r` (whose real colours
//     live in from-/to-) are both skipped;
//   • an unknown token is skipped, never guessed.
const WHITE = '#FFFFFF';
const BG_TOKEN_RE = /^bg-([a-z0-9-]+)$/;

export function findLowContrastWhiteOnFill(
  source: string,
  tokens: Record<string, string>,
  file = '',
  min = 4.5,
): Finding[] {
  const out: Finding[] = [];
  const src = String(source ?? '');
  const map = tokens ?? {};
  for (const m of src.matchAll(STRING_LITERAL_RE)) {
    const literal = m[0];
    const toks = literal.split(/[\s"'`{}()$,;]+/).filter(Boolean);
    if (!toks.includes('text-white')) continue;
    const startLine = src.slice(0, m.index ?? 0).split('\n').length;
    for (const tok of toks) {
      const name = BG_TOKEN_RE.exec(tok)?.[1];
      if (!name) continue;
      const hex = map[name];
      if (!hex) continue;
      const ratio = contrastRatio(hex, WHITE);
      if (!Number.isFinite(ratio) || ratio >= min) continue;
      out.push({
        file,
        line: startLine,
        detail: `white text on "${tok}" (${hex}) is ${ratio.toFixed(2)}:1, below AA ${min}`,
      });
    }
  }
  return out;
}

/** Pull `'token': '#RRGGBB'` pairs out of a tailwind config's source text. */
export function parseColorTokens(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of String(source ?? '').matchAll(/['"]([a-z0-9-]+)['"]\s*:\s*['"](#[0-9a-fA-F]{3,6})['"]/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

// ── fs helper (kept out of the scanners on purpose) ──────────────────────────
export function playWebTsxFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.tsx')) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}
