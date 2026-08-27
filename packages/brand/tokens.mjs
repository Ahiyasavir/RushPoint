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
