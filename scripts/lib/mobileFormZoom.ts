// Pure decisions behind the creator console's phone-input behaviour
// (change: creator-mobile-mechanics).
//
// Two defects live here, and neither is visible to any other gate: typecheck does
// not read class strings or stylesheets, eslint does not know the theme, and every
// build/bundle/i18n gate passed green for months while the console was genuinely
// unusable on an iPhone.
//
// ── 1. The input-zoom floor ──────────────────────────────────────────────────
// Mobile Safari zooms the page IN when a text field whose computed font-size is
// under 16px takes focus, and it does NOT zoom back out on blur. creator-web's
// form controls are `text-sm` (14px), and the mission editor's `dense` variant is
// 13px, so every tap on a field left the creator inside a magnified viewport
// scrolling a page that no longer fit. That is the whole of "the site keeps
// getting bigger and smaller".
//
// The floor has to be on the COMPUTED SIZE. The other way to stop the zoom is to
// forbid it in the viewport meta (`maximum-scale=1` / `user-scalable=no`), which
// also takes pinch zoom away from every person who needs it — so this module
// asserts the floor exists AND that the shortcut was not taken.
//
// ── 2. Scroll chaining ───────────────────────────────────────────────────────
// The Builder never scrolls the page; it nests four-plus scroll containers inside
// a fixed-height shell. Without `overscroll-behavior`, reaching the end of the
// mission editor hands the gesture to whatever is behind it, which on iOS reads as
// the sheet "sticking" and the page rubber-banding under it. Two gallery modals
// already carry `overscroll-contain`; the Builder's own containers never got it.
//
// The scroll scan is scoped to a DECLARED file list rather than the whole app: a
// declared list fails when a container loses its guard or a new unguarded one
// appears in a file that matters, instead of producing a wall of findings about
// desktop-only tables nobody scrolls with a thumb.

/** Below this, iOS Safari zooms on focus and never restores. */
export const MIN_MOBILE_FONT_PX = 16;

/**
 * Files whose scroll containers are reached by a thumb inside the Builder shell.
 * Declared, never inferred — see the module note.
 */
export const SCROLL_GUARDED_FILES: readonly string[] = [
  'apps/creator-web/src/components/TaskCanvas.tsx',
  'apps/creator-web/src/components/TaskWizard.tsx',
  'apps/creator-web/src/components/StageRail.tsx',
];

// ═══════════════════════════════════════════════════════════════════════════
// 1. Viewport meta
// ═══════════════════════════════════════════════════════════════════════════

/** The `content` of `<meta name="viewport">`, or null when there is none. */
export function parseViewportContent(html: string): string | null {
  if (typeof html !== 'string') return null;
  // Tag first, attribute second: attribute order inside the tag is arbitrary.
  const tags = html.match(/<meta[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!/name\s*=\s*["']viewport["']/i.test(tag)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    return content ? content[1] : '';
  }
  return null;
}

/** Directives parsed out of a viewport `content` string, lower-cased. */
function viewportDirectives(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of content.split(',')) {
    const [rawKey, rawValue] = part.split('=');
    if (rawKey === undefined || rawValue === undefined) continue;
    out.set(rawKey.trim().toLowerCase(), rawValue.trim().toLowerCase());
  }
  return out;
}

/**
 * Ways this viewport takes zoom away from the user.
 *
 * Returns one message per problem, empty when the meta lets a person zoom. A
 * `maximum-scale` under 2 is the practical bar: WCAG 1.4.4 asks for 200%.
 */
export function viewportZoomLockFindings(content: string | null): string[] {
  if (content === null) return ['no viewport meta at all'];
  const directives = viewportDirectives(content);
  const findings: string[] = [];

  const scalable = directives.get('user-scalable');
  if (scalable === 'no' || scalable === '0' || scalable === 'false') {
    findings.push(`user-scalable=${scalable} forbids pinch zoom`);
  }

  const max = Number.parseFloat(directives.get('maximum-scale') ?? '');
  if (Number.isFinite(max) && max < 2) {
    findings.push(`maximum-scale=${max} caps zoom below the 200% WCAG 1.4.4 bar`);
  }

  return findings;
}

/**
 * Does the viewport ask the browser to RESIZE the layout when the on-screen
 * keyboard opens, rather than float it over an unchanged viewport?
 *
 * Without it a bottom-anchored sheet keeps its pre-keyboard height and its footer
 * — the primary action — ends up underneath the keyboard.
 */
export function resizesForKeyboard(content: string | null): boolean {
  if (content === null) return false;
  return viewportDirectives(content).get('interactive-widget') === 'resizes-content';
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. The stylesheet floor
// ═══════════════════════════════════════════════════════════════════════════

/** A `@media` block lifted out of a stylesheet, prelude and body separated. */
interface MediaBlock { prelude: string; body: string }

/** Every top-level `@media` block, matched by counting braces (not by regex). */
export function mediaBlocks(css: string): MediaBlock[] {
  if (typeof css !== 'string') return [];
  const out: MediaBlock[] = [];
  const marker = /@media([^{]*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(css)) !== null) {
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    if (depth !== 0) break; // unbalanced stylesheet; report nothing rather than guess
    out.push({ prelude: match[1].trim(), body: css.slice(bodyStart, i - 1) });
    marker.lastIndex = i;
  }
  return out;
}

/** A font-size declaration in px, or null when it is absent or not convertible. */
function fontSizePx(declarations: string): number | null {
  const decl = declarations.match(/font-size\s*:\s*([^;}]+)/i);
  if (!decl) return null;
  const value = decl[1].trim();
  const px = value.match(/^([\d.]+)px/i);
  if (px) return Number.parseFloat(px[1]);
  const rem = value.match(/^([\d.]+)rem/i);
  if (rem) return Number.parseFloat(rem[1]) * 16;
  return null;
}

export interface FontFloorVerdict {
  ok: boolean;
  /** Why not, when `ok` is false. Empty string when it passes. */
  reason: string;
}

/**
 * Does this stylesheet put a >= 16px floor under form controls on phone widths?
 *
 * Every clause is load-bearing, and each corresponds to a way the rule can be
 * present and still do nothing:
 *
 *  • inside a `max-width` media query — a floor applied at every width would undo
 *    the deliberate density of the desktop console;
 *  • naming input AND textarea AND select — the mission editor uses all three;
 *  • `!important` — Tailwind's `.text-sm` is a class (0,1,0) and an element
 *    selector is (0,0,1), so without it the utility wins from any source
 *    position. A rule that loses to the very classes it exists to override would
 *    sit in the stylesheet looking correct and doing nothing.
 */
export function hasMobileFormFontFloor(css: string): FontFloorVerdict {
  const scoped = mediaBlocks(css).filter((m) => /max-width/i.test(m.prelude));
  if (scoped.length === 0) return { ok: false, reason: 'no max-width media block in the stylesheet' };

  const needed = ['input', 'textarea', 'select'];
  for (const block of scoped) {
    // Rules are `selector { declarations }`; media bodies here are one level deep.
    const rules = block.body.match(/([^{}]+)\{([^{}]*)\}/g) ?? [];
    const covered = new Set<string>();
    let sawSize = false;
    let sawImportant = false;
    for (const rule of rules) {
      const split = rule.match(/([^{}]+)\{([^{}]*)\}/);
      if (!split) continue;
      const [, selector, declarations] = split;
      const size = fontSizePx(declarations);
      if (size === null || size < MIN_MOBILE_FONT_PX) continue;
      sawSize = true;
      if (/!important/i.test(declarations)) sawImportant = true;
      for (const element of needed) {
        // Element name as its own selector token, so `select` is not matched by
        // a class called `.selected`.
        if (new RegExp(`(^|[\\s,>+~])${element}([\\s,:.\\[)]|$)`, 'i').test(selector)) covered.add(element);
      }
    }
    const missing = needed.filter((n) => !covered.has(n));
    if (missing.length > 0) continue;
    if (!sawSize) continue;
    if (!sawImportant) {
      return { ok: false, reason: 'the floor is declared without !important, so Tailwind text-sm still wins' };
    }
    return { ok: true, reason: '' };
  }
  return { ok: false, reason: `no max-width block sets font-size >= ${MIN_MOBILE_FONT_PX}px on input, textarea and select` };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Scroll chaining
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Does the shared ui kit animate `font-size` on its form controls?
 *
 * `transition-all` on an <input> includes font-size, and font-size on a text
 * field is not decoration — iOS Safari reads the COMPUTED value at the moment
 * focus lands to decide whether to zoom the page in. A value caught mid-
 * transition below 16px re-arms the exact bug the stylesheet floor removes.
 *
 * Scoped to the three control factories in ui.tsx, by name: `transition-all` on
 * a Card or a Button is fine and must not be reported.
 */
export function findFontSizeTransitions(source: string): string[] {
  if (typeof source !== 'string') return [];
  const findings: string[] = [];
  for (const control of ['Input', 'Textarea', 'Select']) {
    // The factory's body, from its `export function X(` to the next export.
    const start = source.search(new RegExp(`export function ${control}\\s*\\(`));
    if (start < 0) { findings.push(`ui.tsx no longer exports a ${control} factory`); continue; }
    const rest = source.slice(start + 1);
    const end = rest.search(/\nexport (function|const) /);
    const body = end < 0 ? rest : rest.slice(0, end);
    if (/\btransition-all\b/.test(body)) {
      findings.push(`${control} uses transition-all, which animates font-size`);
    }
  }
  return findings;
}

export interface ScrollFinding { file: string; line: number; snippet: string }

/**
 * className literals that scroll vertically without declaring an
 * `overscroll-behavior`.
 *
 * Matched per class-string, not per element: the two properties have to sit on
 * the SAME element for the containment to apply, so a sibling's guard is not this
 * element's guard.
 */
export function findScrollContainersMissingOverscroll(source: string, file: string): ScrollFinding[] {
  if (typeof source !== 'string') return [];
  const findings: ScrollFinding[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, i) => {
    // A line comment that merely NAMES the class is not a scroll container —
    // TaskWizard has one explaining why its map pane scrolls. Same carve-out
    // creatorContrastScan makes for the same reason.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    // Only a real vertical scroller: `overflow-x-auto` scrolls sideways and
    // chains nothing a thumb would notice in this shell.
    if (!/\boverflow-(y-)?auto\b/.test(line)) return;
    if (/\boverflow-x-auto\b/.test(line) && !/\boverflow-y-auto\b/.test(line) && !/\boverflow-auto\b/.test(line)) return;
    if (/\boverscroll-(contain|none)\b/.test(line)) return;
    findings.push({ file, line: i + 1, snippet: line.trim().slice(0, 120) });
  });
  return findings;
}
