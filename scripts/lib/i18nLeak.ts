// ─────────────────────────────────────────────────────────────────────────────
// i18n leak predicates — the ONE definition of "this Hebrew string leaks English"
// and "this English string leaks Hebrew".
//
// WHY THIS FILE EXISTS: these two predicates used to live as near-duplicate
// copies in `scripts/check-i18n.ts` (`hasEnglishWord`) and
// `scripts/test-i18n-parity.ts` (`hasEnglish`), kept in sync by a comment. Both
// copies carried the same defect and both had to be patched in the same commit
// (8729464). A rule that decides a HARD gate must not exist twice, so it lives
// here and both checkers import it. There is nothing to drift.
//
// Pure string predicates, no I/O — tested by `scripts/test-i18n-leak.ts`.
// ─────────────────────────────────────────────────────────────────────────────

/** Hebrew block (U+0590–U+05FF). */
export const HEBREW = /[֐-׿]/;

/**
 * `{placeholder}` tokens in copy. A placeholder is STRUCTURE, not copy: it is
 * substituted at runtime and the token NAME is never shown to a user, so
 * `{launched}` inside Hebrew text is not an English leak.
 *
 * Deliberately narrow — only the canonical `{name}` form the dictionaries use
 * (ASCII letters/digits/underscore, no spaces, balanced braces). Anything looser
 * risks swallowing real copy that merely happens to sit between braces.
 */
export const PLACEHOLDER_RE = /\{[A-Za-z0-9_]+\}/g;

/**
 * Tokens containing a digit — sample codes / ids like `FOX42`, `ABC123`. Not
 * English copy, so they are stripped before the English-word test.
 */
export const DIGIT_CODE_RE = /[A-Za-z]*\d[A-Za-z\d]*/g;

/**
 * Brand names / units / acronyms that may legitimately stay Latin inside Hebrew
 * copy, the language-toggle label, and the structural direction values.
 */
export const LATIN_WHITELIST = [
  'RushPoint', 'Creator Pro', 'Pro', 'QR', 'SOS', 'GPS', 'Google', 'YouTube', 'PWA',
  'English', 'rtl', 'ltr', '₪',
];

/** Hebrew words allowed inside English copy (a language's own name in the toggle). */
export const HEBREW_WHITELIST = ['עברית'];

/** Remove every occurrence of each word in `words` from `s`. */
export function stripAll(s: string, words: string[]): string {
  let out = s;
  for (const w of words) out = out.split(w).join('');
  return out;
}

/** Remove canonical `{placeholder}` tokens (structure, not copy). */
export function stripPlaceholders(s: string): string {
  return s.replace(PLACEHOLDER_RE, '');
}

/**
 * A "Latin English word" = 2+ consecutive ASCII letters left after stripping
 * placeholders, the Latin whitelist, and digit-bearing codes.
 *
 * NOTE on the 2+ rule: single-letter `{n}` placeholders only ever passed this
 * test because one letter is not a word — luck, not intent. Multi-letter
 * placeholders like `{launched}`/`{held}` used to turn the hard PART A gate red
 * on correct Hebrew copy; `stripPlaceholders` is what makes both cases correct
 * for the same reason.
 */
export function hasEnglishWord(s: string): boolean {
  const noCodes = stripAll(stripPlaceholders(s), LATIN_WHITELIST).replace(DIGIT_CODE_RE, '');
  return /[A-Za-z]{2,}/.test(noCodes);
}

/** Any Hebrew letter left after the Hebrew whitelist (a language's own name). */
export function hasHebrew(s: string): boolean {
  return HEBREW.test(stripAll(s, HEBREW_WHITELIST));
}
