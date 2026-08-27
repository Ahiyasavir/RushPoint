/**
 * The marketing site wears the product's colours (change: marketing-site).
 *
 * This is a DRIFT check, not a taste check. It has no opinion about which orange
 * is right; it only asserts that whatever the two apps call the brand, the site
 * calls it too. The failure it exists to catch is a one sided change: someone
 * adjusts an accent in the apps, every gate stays green, and the public face of
 * the product quietly becomes a slightly different product.
 *
 * It is also how the template's own palette is kept out. AstroWind shipped a blue
 * primary, a purple accent and a `lavender` selection colour. None of that is
 * wrong on its own, which is exactly why it survived several passes: a coherent
 * palette from somebody else looks finished.
 *
 * The values are read from the apps' real configuration rather than restated
 * here. A test carrying its own copy of the answer is a test that agrees with
 * itself while both sides drift.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const THEME = join(ROOT, 'apps', 'marketing', 'src', 'components', 'CustomStyles.astro');
const CREATOR_TW = join(ROOT, 'apps', 'creator-web', 'tailwind.config.js');
const PLAY_TW = join(ROOT, 'apps', 'play-web', 'tailwind.config.js');
const CREATOR_CSS = join(ROOT, 'apps', 'creator-web', 'src', 'index.css');

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
}

// Comments are stripped first. The file's own comments NAME the template colours
// it is refusing to use, and a checker that cannot tell "we replaced this" from
// "we use this" is a checker that forces the explanation to be deleted. Both
// comment forms appear here: the component's frontmatter is JS, the palette is
// CSS.
const theme = readFileSync(THEME, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
  .toLowerCase();
const creatorTw = readFileSync(CREATOR_TW, 'utf8');
const playTw = readFileSync(PLAY_TW, 'utf8');
const creatorCss = readFileSync(CREATOR_CSS, 'utf8');

// ── A. Read the brand out of the apps, not out of this file ──────────────────

/** `'rp-fire':   '#FF5722',` → `#ff5722` */
function tailwindToken(source: string, token: string): string | null {
  const m = source.match(new RegExp(`['"]${token}['"]\\s*:\\s*['"](#[0-9a-fA-F]{3,8})['"]`));
  return m ? m[1].toLowerCase() : null;
}

/** `--ink-1: #0A0C1A;` → `#0a0c1a` */
function cssToken(source: string, token: string): string | null {
  const m = source.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
  return m ? m[1].toLowerCase() : null;
}

const fire = tailwindToken(creatorTw, 'rp-fire');
const plasma = tailwindToken(creatorTw, 'rp-plasma');
// The darkened variant brand-coloured TEXT is drawn in. play-web introduced this
// scale with the rule beside it: fills, borders, rings and gradients keep the
// brand orange, and text uses this, because #FF5722 is 3.16:1 on a light surface.
// Read from the app rather than restated, for the same reason as everything else
// here: a second copy is a second opinion waiting to disagree.
const inkFire = tailwindToken(playTw, 'ink-fire');
const ink1 = cssToken(creatorCss, '--ink-1');
const ink3 = cssToken(creatorCss, '--ink-3');
const warmBg = tailwindToken(playTw, 'app-bg');

// The reach assertion. Every comparison below is "the site equals X", and if X
// could not be read, X is null and the comparison is meaningless rather than
// merely false. This must fail loudly if the apps are restructured, because the
// alternative is a suite that stops checking and says nothing.
check(
  'A · the brand was read out of the apps themselves',
  Boolean(fire && plasma && ink1 && ink3 && warmBg && inkFire),
  JSON.stringify({ fire, plasma, ink1, ink3, warmBg, inkFire }),
);

if (!(fire && plasma && ink1 && ink3 && warmBg && inkFire)) {
  console.log('');
  console.log(`MARKETING THEME TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}

// Both apps must agree the accents ARE the brand. If they ever disagree, there is
// no single answer for the site to match and the choice stops being mechanical.
check(
  'A · both apps declare the same brand accent',
  tailwindToken(playTw, 'rp-fire') === fire,
  `${tailwindToken(playTw, 'rp-fire')} vs ${fire}`,
);

// ── B. The site uses those values ────────────────────────────────────────────

const EXPECTED: Array<[string, string, string]> = [
  ['--aw-color-primary', fire, 'the primary accent is the brand orange'],
  ['--aw-color-accent', plasma, 'the secondary accent is the brand cyan'],
  ['--aw-color-text-heading', ink1, 'headings use the ink scale'],
  ['--aw-color-text-default', ink1, 'body text uses the ink scale'],
  ['--aw-color-text-muted', ink3, 'muted text uses the ink scale'],
  ['--aw-color-bg-page', warmBg, "the page surface is the app's own"],
  ['--aw-color-secondary', inkFire, "brand coloured text uses play-web's ink-fire, not a new shade"],
];

for (const [token, expected, label] of EXPECTED) {
  const m = theme.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-f]{3,8})\\s*;`));
  check(`B · ${label}`, m?.[1] === expected, `${token}: ${m?.[1] ?? '(not set)'} expected ${expected}`);
}

// ── C. None of the template's palette survives ───────────────────────────────
//
// Named individually rather than as "no other colour", because the site legitimately
// defines a dark mode the product has no equivalent for, and a blanket rule would
// have to be relaxed for it until it meant nothing.
const TEMPLATE_COLOURS: Array<[string, RegExp]> = [
  ["the template's blue primary", /rgb\(1\s+97\s+239\)|#0161ef/],
  ["the template's darker blue", /rgb\(1\s+84\s+207\)|#0154cf/],
  ["the template's purple accent", /rgb\(109\s+40\s+217\)|#6d28d9/],
  ['a lavender selection colour', /\blavender\b/],
  ["the template's navy page background", /rgb\(3\s+6\s+32\)|#030620/],
];

for (const [what, pattern] of TEMPLATE_COLOURS) {
  check(`C · ${what} is gone`, !pattern.test(theme), what);
}

// ── D. The typefaces are the product's ───────────────────────────────────────
// Inter for text, Space Grotesk for headings, matching `font-brand` /
// `--rp-font-display`. A heading face declared but never loaded silently falls
// back, so the declaration and the load are both asserted.
check('D · body text uses the product body face', /--aw-font-sans:\s*var\(--font-inter\)/.test(theme), 'Inter');
check(
  'D · headings use the product display face',
  /--aw-font-heading:[^;]*--font-space-grotesk/.test(theme),
  'Space Grotesk',
);
check(
  'D · the display face is declared in the apps too',
  /space grotesk/i.test(creatorTw) && /space grotesk/i.test(creatorCss),
  'font-brand / --rp-font-display',
);

const astroConfig = readFileSync(join(ROOT, 'apps', 'marketing', 'astro.config.ts'), 'utf8');
const layout = readFileSync(join(ROOT, 'apps', 'marketing', 'src', 'layouts', 'Layout.astro'), 'utf8');
check(
  'D · the display face is actually loaded, not just named',
  /--font-space-grotesk/.test(astroConfig) && /--font-space-grotesk/.test(layout),
  'astro.config fonts + <Font /> in the layout',
);

// ── E. The neutral and accent SCALES are remapped, not just the tokens ───────
//
// The template writes `slate`, `gray` and `blue` directly in dozens of class
// strings, most of them under `dark:`. Repointing only the semantic tokens fixed
// the palette exactly where a token happened to be used and left everything else
// on the template's cool navy, which is why dark mode looked like a different
// site than light mode did. The scales themselves are therefore redefined in
// `tailwind.css`, and that is what this asserts: not the specific ramp values,
// but that the redefinition is present and that 500 is really the brand.
const css = readFileSync(join(ROOT, 'apps', 'marketing', 'src', 'assets', 'styles', 'tailwind.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .toLowerCase();

for (const scale of ['slate', 'gray', 'blue']) {
  // Character classes are spelled out rather than escaped. A backslash escape
  // inside a template literal is consumed by the literal before RegExp ever sees
  // it, so `\d` here silently becomes the letter `d` and the pattern matches
  // nothing while reporting zero rather than erroring.
  const steps = [...css.matchAll(new RegExp(`--color-${scale}-([0-9]+)[ ]*:`, 'g'))].length;
  check(`E · the ${scale} scale is redefined rather than left to Tailwind`, steps >= 10, `${steps} steps`);
}

// The load bearing one. `blue` was the template's ACCENT, so anything still
// written as blue must land on the brand rather than merely on "some other blue".
check(
  'E · blue 500 is the brand accent',
  new RegExp(`--color-blue-500[ ]*:[ ]*${fire}[ ]*;`).test(css),
  fire,
);

// A cool neutral anywhere in the ramp means a step was missed, and one missed
// step is a cool line or a cool caption sitting in an otherwise warm page.
const ramp = [...css.matchAll(/--color-(?:slate|gray)-\d+\s*:\s*#([0-9a-f]{6})\s*;/g)];
const cool = ramp
  .map((m) => m[1])
  .filter((hex) => parseInt(hex.slice(4, 6), 16) > parseInt(hex.slice(0, 2), 16) + 8);
check('E · no step of the neutral ramp is cool', cool.length === 0, cool.join(', ') || 'none');
check('E · the neutral ramp was actually read', ramp.length >= 20, `${ramp.length} steps`);

// ── F. The declared palette is actually readable ─────────────────────────────
//
// Matching the applications settles which colours the site uses. It does not
// settle whether a given PAIR of them can be read, and that question has an
// arithmetic answer, so it is answered here rather than by eye.
//
// Source level on purpose: a rendered page can only be measured in a browser,
// which was done and found four real failures, but the DECISION about which
// colour sits on which surface lives in the palette, so that is where it is
// pinned. What a browser catches and this cannot is a pairing nobody declared,
// so both passes earn their place.

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function paletteToken(name: string): string | null {
  const m = theme.match(new RegExp(`${name}[ ]*:[ ]*(#[0-9a-f]{6})[ ]*;`));
  return m ? m[1] : null;
}

const pageBg = paletteToken('--aw-color-bg-page');
const inkDefault = paletteToken('--aw-color-text-default');
const inkMuted = paletteToken('--aw-color-text-muted');
const brandDeep = paletteToken('--aw-color-secondary');
const brand = paletteToken('--aw-color-primary');

check(
  'F · the palette could be read out of the theme',
  Boolean(pageBg && inkDefault && inkMuted && brandDeep && brand),
  JSON.stringify({ pageBg, inkDefault, inkMuted, brandDeep, brand }),
);

if (pageBg && inkDefault && inkMuted && brandDeep && brand) {
  const PAIRS: Array<[string, string, string, number]> = [
    ['body text on the page', inkDefault, pageBg, 4.5],
    ['muted text on the page', inkMuted, pageBg, 4.5],
    // The deeper brand shade exists precisely so brand coloured TEXT is legible.
    // The lighter one is 3.09:1 at body size, which is why every link uses this.
    ['brand coloured body text and links', brandDeep, pageBg, 4.5],
    // The lighter brand shade is for large text, icons and fills, where 3:1 is
    // the requirement and it clears it.
    ['the brand accent as large text or an icon', brand, pageBg, 3],
  ];

  for (const [label, fg, bg, min] of PAIRS) {
    const ratio = contrast(fg, bg);
    check(`F · ${label} meets ${min}:1`, ratio >= min, `${ratio.toFixed(2)}:1 (${fg} on ${bg})`);
  }

  // ── The one pairing that does NOT meet AA, reported rather than hidden ──────
  //
  // White on the brand accent measures 3.16:1, and body sized button text needs
  // 4.5:1. It is deliberately NOT asserted, because it is not a mistake made
  // here: it is the applications' own primary button pairing, and the
  // instruction this palette follows is to match them. Fixing it properly means
  // changing the product's primary button in creator-web and play-web too, which
  // is a brand decision rather than a site one.
  //
  // Printed on every run so it stays visible. The alternatives were a
  // permanently red gate that people learn to scroll past, or silence.
  const ctaRatio = contrast('#ffffff', brand);
  console.log('');
  console.log(`NOTE  white on the brand accent is ${ctaRatio.toFixed(2)}:1; body sized button text needs 4.50:1.`);
  console.log('NOTE  This is the apps own primary button pairing, so it is a product wide brand decision.');
  console.log(`NOTE  Options: play-web's ink-fire as the fill (white on #b03a0b is ${contrast('#ffffff', '#b03a0b').toFixed(2)}:1), or`);
  console.log(`NOTE  dark text on the existing fill (${inkDefault} on ${brand} is ${contrast(inkDefault, brand).toFixed(2)}:1).`);
  console.log('');
}

console.log('');
if (failures > 0) {
  console.log(`MARKETING THEME TESTS FAILED :: ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`ALL MARKETING THEME TESTS PASSED :: ${checks} checks`);
