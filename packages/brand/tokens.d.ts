/**
 * Types for the brand tokens.
 *
 * Hand written because tokens.mjs is deliberately plain JavaScript with no build
 * step (see the comment at the top of it).
 *
 * Each font declares its css variable as its OWN literal rather than sharing one
 * union. Astro generates a literal union from whatever is in the font config, and
 * that config carries only the two web faces; a shared union including the mono
 * variable would therefore be rejected everywhere the display or body variable is
 * used. Exact literals also turn a typo in a variable name into a compile error
 * instead of a variable that quietly resolves to nothing.
 */

export interface FontToken<Variable extends string = string> {
  readonly family: string;
  /** Fontsource package id for the variable build. */
  readonly package: string;
  /** Filename stem inside that package's files/ directory. */
  readonly fileBase: string;
  readonly cssVariable: Variable;
  /** Non empty by construction: a face with no weights loads nothing. */
  readonly weights: [string, ...string[]];
  /** Non empty: dropping every subset is how the Hebrew went missing. */
  readonly subsets: [string, ...string[]];
  readonly stack: [string, ...string[]];
}

export type DisplayFont = FontToken<'--rp-font-display'>;
export type BodyFont = FontToken<'--rp-font-body'>;
export type MonoFont = FontToken<'--rp-font-mono'>;

export declare const FONTS: {
  readonly display: DisplayFont;
  readonly body: BodyFont;
  readonly mono: MonoFont;
};

export declare const COLORS: {
  readonly fire: string;
  readonly amber: string;
  readonly plasma: string;
  readonly signal: string;
  readonly go: string;
  readonly alert: string;
  readonly fireText: string;
};

export declare const INK: {
  readonly fire: string;
  readonly warm: string;
  readonly amber: string;
  readonly alert: string;
  readonly go: string;
  readonly plasma: string;
  readonly signal: string;
};

export declare function tailwindInkColors(): Record<string, string>;

export declare const SURFACES: {
  readonly page: string;
  readonly surface: string;
  readonly raised: string;
  readonly ink: string;
  readonly inkMuted: string;
  readonly line: string;
};

export declare const FONT_SIZE: {
  readonly xs: readonly [string, { readonly lineHeight: string }];
  readonly sm: readonly [string, { readonly lineHeight: string }];
};

export declare function tailwindFontFamily(): Record<string, string[]>;
export declare function tailwindFontSize(): typeof FONT_SIZE;
export declare function tailwindBrandColors(): Record<string, string>;

export declare const ALL_FONTS: readonly [DisplayFont, BodyFont, MonoFont];

/**
 * The faces the web loads. A tuple, not an array, so mapping it in the Astro
 * config produces exactly the two css variables Astro then expects to be given.
 */
export declare const WEB_FONTS: readonly [DisplayFont, BodyFont];
