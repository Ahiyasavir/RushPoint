/**
 * RushPoint brand tokens. THE single source for fonts and colours.
 *
 * Everything visual reads from here: both Tailwind configs, the marketing site's
 * Astro font config and its stylesheet, and the drift tests. Before this existed
 * the values were restated in five places and the "shared" palette was really
 * four copies that happened to agree.
 *
 * Plain .mjs on purpose, with NO build step. A tailwind.config.js is loaded by
 * Tailwind directly and an astro.config.ts by Astro, neither of which waits for
 * `packages/shared` to compile; pointing them at built output would make the
 * palette depend on build ORDER, and the one thing this file must never do is be
 * unavailable. Zero dependencies for the same reason.
 *
 * Change: brand-design-system.
 */

// ── Typography ───────────────────────────────────────────────────────────────
//
// The previous pairing was Inter for body and Space Grotesk for headings, both
// loaded LATIN ONLY. Space Grotesk has no Hebrew glyphs at all. On a Hebrew
// first product that meant every Hebrew character in the product fell through to
// the browser's default face, which on Windows is Arial. The brand font was
// real on the English half of the interface and absent from the Hebrew half,
// which is the half most people see.
//
// Rubik and Assistant both ship genuine Hebrew AND Latin in one family, so the
// two languages are set in the same typeface instead of only looking that way to
// whoever is reading English.
export const FONTS = {
  /** Headings and anything that carries the brand's voice. */
  display: {
    family: 'Rubik',
    /** Fontsource package id, for the variable (single file, all weights) build. */
    package: '@fontsource-variable/rubik',
    /** Filename stem inside that package's files/ directory. */
    fileBase: 'rubik',
    cssVariable: '--rp-font-display',
    weights: ['300 900'],
    /** Hebrew is not optional here. Dropping it is the bug this replaced. */
    subsets: ['latin', 'hebrew'],
    stack: ['Rubik', 'system-ui', 'sans-serif'],
  },
  /** Body copy: long form reading, in both languages. */
  body: {
    family: 'Assistant',
    package: '@fontsource-variable/assistant',
    fileBase: 'assistant',
    cssVariable: '--rp-font-body',
    weights: ['200 800'],
    subsets: ['latin', 'hebrew'],
    stack: ['Assistant', 'system-ui', 'sans-serif'],
  },
  /** Codes and numbers that must not be mistaken for each other. */
  mono: {
    family: 'JetBrains Mono',
    package: '@fontsource-variable/jetbrains-mono',
    fileBase: 'jetbrains-mono',
    cssVariable: '--rp-font-mono',
    weights: ['100 800'],
    subsets: ['latin'],
    stack: ['JetBrains Mono', 'ui-monospace', 'monospace'],
  },
};

// ── Type scale ───────────────────────────────────────────────────────────────
//
// Tailwind's stock scale (xs 12px, sm 14px) was never overridden, and `xs`/`sm`
// are by far the two most reached-for sizes in both apps — a plain count across
// creator-web found ~700 combined uses of xs/sm/arbitrary-10-11px against just
// 14 uses of `base` (16px, the size actually meant for reading). That is not a
// handful of small labels; it is most of the interface's text sitting at or
// under 14px, which is why the product reads as "everything got tiny" even
// though no single component looks wrong in isolation — the smallness is
// systemic, not local, so the fix has to be too.
//
// Bumped rather than replaced: `xs`/`sm` still mean "smaller than base", the
// hierarchy nothing in either app was rebuilt, only the floor moved up to
// where 13px+ and 15px+ stay comfortably readable (the 16px-for-body rule of
// thumb is for the reading size itself; a still-smaller UI label reads fine a
// couple of px under that, unlike the 10-12px this scale used to bottom out
// at). `base`/`lg`/`xl` are unchanged — they were never the problem.
export const FONT_SIZE = {
  xs: ['0.8125rem', { lineHeight: '1.125rem' }],  // 13px / 18px, was 12/16
  sm: ['0.9375rem', { lineHeight: '1.375rem' }],  // 15px / 22px, was 14/20
};

/** Tailwind `fontSize` override for `xs`/`sm`. `base` and up are Tailwind's own. */
export const tailwindFontSize = () => ({ ...FONT_SIZE });

// ── Colour ───────────────────────────────────────────────────────────────────
// Unchanged from what the apps already shipped: this file adopts the product's
// palette rather than inventing one.
export const COLORS = {
  fire: '#FF5722',
  amber: '#FFB300',
  plasma: '#06B6D4',
  signal: '#7C3AED',
  go: '#10B981',
  alert: '#EF4444',
  /**
   * A deepened fire, for brand coloured TEXT.
   *
   * #FF5722 on the warm page measures 3.09:1, which clears the 3:1 a large
   * heading or an icon needs and misses the 4.5:1 body text needs. So links and
   * small text use this (5.24:1) and icons and display headings keep `fire`.
   */
  fireText: '#C03D14',
};

/**
 * Darkened text-safe variants of the brand accents.
 *
 * `COLORS` (and the accent tokens both apps expose as `rp-*`) are tuned for
 * FILLS, borders and glows — full saturation reads correctly there because a
 * fill has area and weight behind it. As TEXT on a light surface the same
 * colours fail WCAG outright: `#FF5722` measures 3.16:1 on white, `#FFB300`
 * 1.79:1, `#10B981` 2.54:1 — all short of the 4.5:1 body text needs, on the
 * exact tokens carrying prices, statuses and CTAs across both apps.
 *
 * play-web found this first (participants read it outdoors, in direct sun,
 * where a failing contrast is not a technicality) and built this scale as the
 * fix: keep every fill/border/ring/gradient on the original brand colour, and
 * route only TEXT through a same-hue, darkened variant. This is that scale,
 * promoted from play-web's own tailwind config to here so creator-web can
 * finally use it too — it never adopted it, and carried ~150 raw accent-as-text
 * usages as a result (measured 2026-08-27).
 *
 * Every value clears 4.5:1 on the worst surface EITHER app puts it over
 * (white, and each app's own card/raised tone); `ink-go` is one shade darker
 * than play-web's original because creator-web's card (#E3E6F0) is lighter
 * than play-web's (#FFF0E6) and the original fell to 4.29:1 there. One shared
 * value, chosen to work everywhere, beats two per-app values that can drift.
 */
export const INK = {
  fire:   '#B03A0B', // replaces text-accent, text-rp-fire
  warm:   '#8A4B00', // replaces text-accent-warm (the #FF8A00 CTA accent)
  amber:  '#7A5200', // replaces text-rp-amber
  alert:  '#C21414', // replaces text-rp-alert
  go:     '#0A714F', // replaces text-rp-go
  plasma: '#046D7F', // replaces text-rp-plasma
  signal: '#5D2CB2', // replaces text-rp-signal
};

/** Tailwind `colors` for the ink (text-safe brand) scale, as `ink-<name>`. */
export const tailwindInkColors = () =>
  Object.fromEntries(Object.entries(INK).map(([name, hex]) => [`ink-${name}`, hex]));

export const SURFACES = {
  page: '#FBF7F0',
  surface: '#FFFFFF',
  raised: '#F3ECE0',
  ink: '#1c1917',
  inkMuted: '#57534e',
  line: 'rgba(90,70,45,0.14)',
};

/** Tailwind `fontFamily`, for both apps and the marketing site. */
export const tailwindFontFamily = () => ({
  sans: FONTS.body.stack,
  body: FONTS.body.stack,
  brand: FONTS.display.stack,
  display: FONTS.display.stack,
  mono: FONTS.mono.stack,
});

/** Tailwind `colors` for the brand accents, in the apps' existing token names. */
export const tailwindBrandColors = () => ({
  'rp-fire': COLORS.fire,
  'rp-fire-text': COLORS.fireText,
  'rp-amber': COLORS.amber,
  'rp-plasma': COLORS.plasma,
  'rp-signal': COLORS.signal,
  'rp-go': COLORS.go,
  'rp-alert': COLORS.alert,
});

/** Every font that must actually be loaded, in one list. */
export const ALL_FONTS = [FONTS.display, FONTS.body, FONTS.mono];

/**
 * The faces the WEB actually loads. Mono is excluded on purpose: nothing on the
 * marketing site sets code, so shipping a third family would be bytes for a
 * surface that does not exist.
 */
export const WEB_FONTS = [FONTS.display, FONTS.body];
