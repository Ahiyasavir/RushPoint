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
  // ⚠ ORDER MATTERS: stripAll removes these in array order, so a multi-word name
  // must come BEFORE any shorter name it contains. 'RushPoint Live' listed after
  // 'RushPoint' would have its first word eaten and leave a bare "Live" behind,
  // which then reads as an English leak in Hebrew copy — a false failure on a
  // proper noun, reported against a page that is perfectly correct.
  //
  // 'RushPoint Live' is the flagship event's own name (change: rushpoint-live-signup),
  // the same class of thing as 'Creator Pro': a product name that is not translated
  // in either language, because it is what the event is CALLED.
  'RushPoint Live',
  // The social handles. A handle is a proper NOUN that is identical in both
  // languages by definition — it is an address, and translating it would point
  // at a profile that does not exist. The TikTok one carries digits, which the
  // digit-code rule would strip anyway; it is listed for the same reason the
  // Instagram one is, so a reader of this list sees the whole set.
  'ahiyasavir09', 'ahiyasavir',
  'RushPoint', 'Creator Pro', 'Pro', 'QR', 'SOS', 'GPS', 'Google', 'YouTube', 'PWA',
  // File format acronyms, same class as QR/GPS above: Hebrew speakers read and write
  // "CSV" and "JPG", and translating them would make the control LESS clear, not
  // more. WebP first, so the bare 'P' cases cannot eat half of it.
  'CSV', 'WebP', 'JPG', 'JPEG', 'PNG',
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
