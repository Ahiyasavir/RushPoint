// The one contrast trap that is specific to creator-web, as a source scan.
// (change: creator-contrast-guard)
//
// `apps/creator-web/tailwind.config.js` REVERSES the zinc scale — a leftover from
// the app's original dark theme:
//
//     zinc-100 → #1c1917   zinc-500 → #78716c   zinc-800 → #e7e5e4
//     zinc-200 → #292524   zinc-600 → #a8a29e   zinc-900 → #f5f5f4
//     zinc-300 → #44403c   zinc-700 → #d6d3d1
//
// So `text-zinc-800` is NEAR-WHITE and `text-zinc-100` is NEAR-BLACK — the exact
// opposite of what the class name says. Two different failures follow, and both
// shipped:
//
//   * On a LIGHT surface, anything from `text-zinc-600` up is washed out. The
//     logged-out landing page's phone mockup rendered its two bold labels at
//     ~1.1:1 — invisible — and that page is the first thing a prospective creator
//     ever sees.
//   * On a THEMED surface, the low numbers fail in the other direction. `useDarkMode`
//     (apps/creator-web/src/App.tsx) seeds itself from `prefers-color-scheme`, so
//     dark mode is the DEFAULT for any creator whose OS is dark — no opt-in. There,
//     `bg-[--surface-0]` is #07080F and `text-zinc-200` (#292524) is near-black on
//     near-black. Every confirm/alert dialog's message body was unreadable.
//
// Neither is decidable by a colour calculation alone: the class name lies about
// the colour, and the surface usually lives on an ancestor element. What IS
// decidable is the rule the codebase settled on — **don't use `text-zinc-*` in
// creator-web at all**; use the `--ink-*` tokens on themed surfaces, or literal
// hex where the surface is deliberately theme-independent.
//
// So the scan is a ban with two escapes, both declared rather than inferred:
//
//   1. the SAME class literal also names a non-flipping legacy surface
//      (`bg-app-*` / `bg-glass-*`, which are static Tailwind colours and stay
//      light in both themes) — a map/photo overlay that paints its own chip;
//   2. the file is in `ALLOWED_FILES`, for the handful where that surface sits on
//      a parent element. That list is meant to SHRINK; adding to it is a decision,
//      not a default.
//
// Pure and total: source text in, findings out. No fs, no throw.

export interface ContrastFinding {
  file: string;
  line: number;
  detail: string;
}

/**
 * Files still permitted to use `text-zinc-*` because their surface is a
 * non-flipping legacy colour declared on a PARENT element. Each entry names the
 * ancestor that makes it safe. Shrink this list; do not grow it.
 */
export const ALLOWED_FILES: Record<string, string> = {
  'components/ErrorBoundary.tsx': 'crash card is bg-app-surface/80 (static light) in both themes',
  'components/ShareSheet.tsx': 'sheet body is bg-app-card (static light) in both themes',
  'components/MapModeToggle.tsx': 'pill sits on bg-app-card/90 (static light) over the map',
};

/**
 * Background utilities that do NOT follow the theme: they resolve through
 * `tailwind.config.js`'s static "Warm Trail" colours, not through a CSS variable,
 * so they stay light under `html.dark`. A `/80`-style opacity suffix is allowed.
 */
const STATIC_LIGHT_BG_RE = /\bbg-(app|glass)-[a-z0-9-]+(?:\/\d{1,3})?\b/;

/** A `text-zinc-<n>` class token, with optional Tailwind variants (`hover:`). */
const ZINC_TEXT_RE = /\b(?:[a-z-]+:)*text-zinc-\d{2,3}\b/g;

/**
 * Only look inside string literals — a `text-zinc-700` written in a COMMENT (the
 * comments explaining this very trap say it many times) must not be a finding.
 */
const STRING_LITERAL_RE = /(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g;

/**
 * Strip `//` line comments and block comments, so prose that mentions the class
 * never reaches the literal scan. Crude but safe in one direction: it can only
 * remove text, never invent a finding.
 */
function stripComments(source: string): string {
  return String(source ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/[^\n]/g, ' '));
}

/**
 * @param file  path used in findings AND matched against `ALLOWED_FILES` — pass a
 *              path containing the repo-relative suffix (separator-agnostic).
 */
export function findReversedZincText(source: string, file = ''): ContrastFinding[] {
  const normalized = String(file ?? '').replace(/\\/g, '/');
  if (Object.keys(ALLOWED_FILES).some((allowed) => normalized.endsWith(allowed))) return [];

  const out: ContrastFinding[] = [];
  const src = stripComments(source);
  for (const m of src.matchAll(STRING_LITERAL_RE)) {
    const literal = m[0];
    const hits = literal.match(ZINC_TEXT_RE);
    if (!hits) continue;
    // Escape 1: this literal paints its own static-light background.
    if (STATIC_LIGHT_BG_RE.test(literal)) continue;
    const line = src.slice(0, m.index ?? 0).split('\n').length;
    for (const hit of hits) {
      out.push({
        file,
        line,
        detail:
          `"${hit}" — creator-web reverses the zinc scale, so this is not the colour it names. `
          + 'Use --ink-* on a themed surface, or a literal hex on a deliberately light one.',
      });
    }
  }
  return out;
}

// ── Escape-to-dismiss for overlays ───────────────────────────────────────────
// A dismissible overlay in this app is a full-screen backdrop `<div>` carrying an
// `onClick` that closes it. That is a MOUSE affordance: it leaves a keyboard user
// with only whatever ✕ happens to sit in the panel, and with nothing at all where
// there isn't one. Ten overlays existed; four had a hand-rolled Escape listener
// and six did not, including the delete-game confirms on two different pages.
//
// The rule: a file that renders such a backdrop must also handle Escape. It is
// satisfied by the shared `useModalDismiss` hook or by a literal `'Escape'` key
// check, so a component with its own reason to hand-roll it is not forced to
// convert. Decidable from the token text, which is the bar every scanner here
// holds to.
// `absolute` as well as `fixed`: BuilderSpotlight's scrim is an `absolute inset-0`
// child of a `fixed inset-0` parent, and a `fixed`-only pattern silently missed
// it — the scanner reported 0 findings for a file that genuinely had one. An
// `inset-0` element carrying its own `onClick` is a scrim in either case;
// decorative `absolute inset-0` layers (gradients, map canvases) have no handler
// and so never match.
const BACKDROP_RE = /className="(?:fixed|absolute) inset-0[^"]*"[\s\n]*(?:[a-zA-Z-]+=\{[^}]*\}[\s\n]*)*onClick=/;
const ESCAPE_RE = /useModalDismiss|['"]Escape['"]/;

/** Files that render a fixed-inset overlay but legitimately need no Escape. */
export const NO_ESCAPE_NEEDED: Record<string, string> = {
  // The menu closes on blur/outside-click AND on Escape via its own roving-focus
  // handler; it is a menu, not a modal, and never traps.
  'components/OverflowMenu.tsx': 'menu, not a modal — has its own Escape in the roving-focus handler',
};

export function findOverlayWithoutEscape(source: string, file = ''): ContrastFinding[] {
  const normalized = String(file ?? '').replace(/\\/g, '/');
  if (Object.keys(NO_ESCAPE_NEEDED).some((a) => normalized.endsWith(a))) return [];
  const src = stripComments(source);
  if (!BACKDROP_RE.test(src)) return [];
  if (ESCAPE_RE.test(src)) return [];
  const line = src.slice(0, src.search(BACKDROP_RE)).split('\n').length;
  return [{
    file,
    line,
    detail:
      'renders a dismissible full-screen overlay but never handles Escape — '
      + 'the backdrop click is mouse-only. Use the useModalDismiss hook.',
  }];
}

// ── Theme tokens ─────────────────────────────────────────────────────────────
// creator-web declares its ink and surface colours as CSS custom properties in
// `src/index.css`, split across a `:root` block (light) and an `html.dark` block.
// play-web's a11y scan asserts AA over the tokens in its TAILWIND CONFIG, and
// nothing read these — so they drifted, badly and invisibly:
//
//   --ink-3, the token carrying nearly all secondary copy in the product (help
//   lines, hints, metadata, empty-state bodies), sat at 3.79:1 in light and
//   2.42:1 in DARK — and dark is the default for anyone whose OS is dark.
//
// This parses the two blocks so the numbers are checked against the stylesheet
// that actually ships, not against a copy kept in a test.

export interface ThemeTokens { light: Record<string, string>; dark: Record<string, string> }

const VAR_RE = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;

/**
 * Split `index.css` into its light and dark token maps. The dark block starts at
 * `html.dark {` and runs to the end of that rule; everything before it that sits
 * in `:root` is light. Only `#rrggbb` values are collected — an `rgba()` token
 * (e.g. `--rp-border` in dark) is skipped rather than guessed at.
 */
export function parseThemeTokens(css: string): ThemeTokens {
  const src = String(css ?? '');
  // The real rule opener, not the bare substring: a comment that happens to
  // MENTION "html.dark" (documenting the very split this does) matches
  // `indexOf('html.dark')` just as well as the actual block does, and whichever
  // one comes first silently wins — which is exactly how this broke once
  // already (a doc comment above the light block that used the phrase in
  // backticks moved the split point up into the middle of :root). Requiring
  // the brace is what a comment can't accidentally contain.
  const darkStart = src.search(/html\.dark\s*\{/);
  const lightSrc = darkStart >= 0 ? src.slice(0, darkStart) : src;
  const darkSrc = darkStart >= 0 ? src.slice(darkStart) : '';
  const collect = (text: string) => {
    const out: Record<string, string> = {};
    for (const m of text.matchAll(VAR_RE)) if (!(m[1] in out)) out[m[1]] = m[2];
    return out;
  };
  return { light: collect(lightSrc), dark: collect(darkSrc) };
}

/**
 * The surfaces each ink token is actually painted on. `--rp-card` is included
 * because panels use it and it is the darkest light-mode surface, i.e. the worst
 * case; if an ink clears it, it clears the rest.
 */
export const CHECKED_SURFACES = ['--surface-0', '--surface-1', '--surface-2', '--rp-card'];

/**
 * Minimum ratio per ink token. `--ink-4` is held to the 3:1 NON-TEXT bar on
 * purpose — see the contract note beside it in index.css. Every other ink carries
 * prose and must clear AA.
 */
export const INK_MINIMUMS: Record<string, number> = {
  '--ink-1': 4.5,
  '--ink-2': 4.5,
  '--ink-3': 4.5,
  '--ink-4': 3,
  // The brand-accent ink scale (change: brand-design-system): darkened-for-text
  // variants of --rp-fire/warm/amber/alert/go/plasma/signal, values in
  // index.css (light-mode from packages/brand/tokens.mjs INK; dark-mode is its
  // own per-token choice — see the comment beside the dark block). All carry
  // real text (labels, stats, links), so all hold the 4.5 AA bar; none of these
  // is a bare glyph the way --ink-4 is.
  '--rp-ink-fire': 4.5,
  '--rp-ink-warm': 4.5,
  '--rp-ink-amber': 4.5,
  '--rp-ink-alert': 4.5,
  '--rp-ink-go': 4.5,
  '--rp-ink-plasma': 4.5,
  '--rp-ink-signal': 4.5,
};

// ── The blocking dialog must outrank every other overlay ─────────────────────
// `dialog.tsx` renders the app's alert/confirm/prompt. It sat at `z-50` while the
// launch liftoff sat at `z-[100]`, and BuilderPage raises an alert from inside
// the liftoff's own try/finally — so a failed launch drew its error dialog
// UNDERNEATH the "preparing your run…" overlay. The creator saw an eternal
// spinner on a launch that had already failed, waiting on a click they could not
// aim. The app was not hung; it only looked it.
//
// A blocking dialog is the most urgent thing on screen by definition, so this
// asserts the ordering rather than trusting a number nobody re-checks.

/** Pull every `z-<n>` / `z-[<n>]` used on a full-screen overlay, per file. */
export function overlayZIndexes(source: string): number[] {
  const out: number[] = [];
  for (const m of String(source ?? '').matchAll(/fixed inset-0[^"'`]*?\bz-\[?(\d+)\]?/g)) {
    out.push(Number(m[1]));
  }
  return out;
}
