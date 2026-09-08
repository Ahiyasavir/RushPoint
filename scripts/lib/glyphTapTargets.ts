// Pure static scanner for GLYPH-BUTTON tap targets in the creator console.
//
// WHY THIS ONE IS DECIDABLE, when scripts/lib/playA11yScan.ts deliberately says
// tap-target size is not: that file rules out the general case, and it is right —
// a `min-h-[44px]` on a hidden element, a padded parent or a <Button> wrapper all
// make "how big is this control on screen?" a layout-engine question. This scanner
// answers a much narrower one. A lowercase <button> whose ENTIRE content is a
// glyph — ✕, ↑, ↓, ⋯ — has no text to give it width or height, so its rendered box
// is exactly what its own class string says: nothing else in the tree can make it
// bigger. That is the case that keeps regressing (CLAUDE.md: "a 44px tap-target
// fix applied to one control does not travel to its siblings"), and it is the case
// this scanner is scoped to. Anything with a word in it is skipped, not guessed
// at, because a guard that cries wolf gets disabled.
//
// The house sizes live in apps/creator-web/src/lib/interaction.ts and are passed
// in as `aliases`, so this file states no numbers of its own about them: shrinking
// TAP_TARGET to `w-6 h-6` fails the gate rather than moving the goalposts.
//
// Every function is pure and total: source text in, findings out. No filesystem.

export interface GlyphFinding {
  file: string;
  line: number;
  detail: string;
}

const BUTTON_RE = /<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g;
/** Any letter or digit in any script (Latin, Hebrew, Arabic, CJK, …). */
const HAS_WORD = /[\p{L}\p{N}]/u;
/** Opt out on the button itself, with a reason — same convention as `i18n-ignore`. */
const IGNORE_RE = /tap-target-ignore/;

// A height the control declares for itself. 36px (`h-9`) is the floor because that
// is TAP_CLUSTER's documented exception; everything below it — `h-6` (24px, the
// bare WCAG 2.2 AA minimum) and the no-class case (line-height, ~16-20px) — is
// what this gate exists to reject.
const HEIGHT_OK = [
  'h-9', 'h-10', 'h-11', 'h-12', 'h-14', 'h-full',
  'min-h-9', 'min-h-10', 'min-h-11', 'min-h-12',
  'min-h-[36px]', 'min-h-[40px]', 'min-h-[44px]', 'min-h-[48px]',
];
// A width the control declares for itself — either a box or real horizontal
// padding. A glyph is ~10px wide, so `px-3` (24px of padding) is the smallest
// padding that can carry one past the 36px floor.
const WIDTH_OK = [
  'w-9', 'w-10', 'w-11', 'w-12', 'w-14', 'w-full', 'w-auto',
  'min-w-9', 'min-w-10', 'min-w-11', 'min-w-12',
  'min-w-[36px]', 'min-w-[40px]', 'min-w-[44px]', 'min-w-[48px]',
  'px-3', 'px-3.5', 'px-4', 'px-5', 'px-6',
];

/** Whole-token match, so `h-9` never matches inside `h-96` and `w-9` never
 *  inside `w-96`. Tailwind variants (`sm:`, `hover:`) are allowed in front. */
function hasToken(classText: string, tokens: string[]): boolean {
  for (const raw of classText.split(/[\s"'`{}(),;]+/)) {
    if (!raw) continue;
    const token = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
    if (tokens.includes(token)) return true;
  }
  return false;
}

/**
 * Pull every className value out of a tag's attribute text: `className="…"`,
 * `className={'…'}` and `className={`…`}` alike. A tag can only carry one, but
 * returning them joined keeps the caller total if a file ever holds a malformed
 * one.
 */
export function classTextOf(attrs: string): string {
  const out: string[] = [];
  const re = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([\s\S]*?)`|\{\s*'([^']*)'|\{\s*"([^"]*)")/g;
  for (const m of String(attrs ?? '').matchAll(re)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '');
  }
  return out.join(' ');
}

/** Replace `${NAME}` with the class string NAME actually holds, so a template
 *  literal built from the house constants is judged on what it really renders. */
export function expandAliases(classText: string, aliases: Record<string, string>): string {
  let out = String(classText ?? '');
  for (const [name, value] of Object.entries(aliases ?? {})) {
    out = out.split('${' + name + '}').join(' ' + value + ' ');
  }
  return out;
}

/**
 * Findings for glyph-only <button>s that declare no usable box.
 *
 * Skipped on purpose, each because the answer is not in the text:
 *   • a body holding a JSX expression (`{open ? '✕' : '☰'}`) — undecidable here;
 *   • a body with any letter or digit — it is a text button, and text gives it size;
 *   • a `tap-target-ignore` marker — the documented opt-out, with its reason inline.
 */
export function findUndersizedGlyphButtons(
  source: string,
  file = '',
  aliases: Record<string, string> = {},
): GlyphFinding[] {
  const out: GlyphFinding[] = [];
  const src = String(source ?? '');
  for (const m of src.matchAll(BUTTON_RE)) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    if (IGNORE_RE.test(attrs)) continue;
    // Strip JSX comments and any wrapper spans (`<span aria-hidden>✕</span>`),
    // then judge what is left.
    const text = body
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/<\/?span\b[^>]*>/g, '')
      .trim();
    if (text.length === 0) continue;          // empty — a different scanner's job
    if (text.includes('{')) continue;         // dynamic content, undecidable
    if (HAS_WORD.test(text)) continue;        // real copy, sized by its own text

    const classText = expandAliases(classTextOf(attrs), aliases);
    const tall = hasToken(classText, HEIGHT_OK);
    const wide = hasToken(classText, WIDTH_OK);
    if (tall && wide) continue;

    const missing = !tall && !wide ? 'no width or height' : !tall ? 'no height' : 'no width';
    const line = src.slice(0, m.index ?? 0).split('\n').length;
    out.push({
      file,
      line,
      detail: `glyph-only <button> "${text.slice(0, 8)}" declares ${missing}`
        + ' — it renders at its line height (~16-20px). Use TAP_TARGET / TAP_INLINE'
        + ' / TAP_CLUSTER from src/lib/interaction.ts.',
    });
  }
  return out;
}
