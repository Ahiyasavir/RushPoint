// Pure-logic tests for the i18n leak detectors (change: i18n-placeholder-detection).
//
// WHY THIS EXISTS: `npm run i18n:check` PART A is a HARD gate — A3 "no English in
// a Hebrew leaf", A4 "no Hebrew in an English leaf". Its predicates decide whether
// the whole repo ships, and until now nothing tested them: they were exercised
// only indirectly, through whatever copy happened to be in the dictionaries.
//
// That is exactly how the defect this change retrofits got in AND how its fix went
// out unverified. Multi-letter `{placeholder}` tokens inside genuine Hebrew copy
// (`'{launched} קבוצות התחילו. {held} קבוצות ממתינות…'`) were read as English words
// and turned the gate red on correct copy. Single-letter `{n}` had only ever passed
// because the rule needs 2+ consecutive Latin letters — luck, not intent.
//
// THE RISK THE FIX CARRIES is the opposite failure: a detector that has been
// blinded rather than corrected. A gate that never fires is worse than one that
// fires wrongly, because nobody notices. So every "not flagged" case below is
// paired with a "still flagged" case, and the anti-blinding section asserts that
// real English sitting NEXT TO a placeholder is still caught.
//
// The predicates are imported from scripts/lib/i18nLeak.ts — the single definition
// both scripts/check-i18n.ts and scripts/test-i18n-parity.ts use. This file
// deliberately does NOT re-implement the regexes: a test that restates the rule
// proves only that the author can copy/paste.
//
// No emulator.  npx tsx scripts/test-i18n-leak.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hasEnglishWord,
  hasHebrew,
  stripPlaceholders,
  LATIN_WHITELIST,
  HEBREW_WHITELIST,
} from './lib/i18nLeak';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

/** A3: this Hebrew leaf is clean — the detector must NOT flag it. */
function clean(label: string, s: string): void {
  check(`clean: ${label}`, hasEnglishWord(s) === false, JSON.stringify(s));
}
/** A3: this leaf really does leak English — the detector MUST flag it. */
function leaks(label: string, s: string): void {
  check(`leaks: ${label}`, hasEnglishWord(s) === true, JSON.stringify(s));
}

// ── The incident: multi-letter placeholders in real Hebrew copy ───────────────
console.log('\n── placeholders in Hebrew copy are NOT an English leak ──');

// The verbatim string that turned the hard gate red (creator-web runConsole
// heldForConsent, as it stood at commit 8729464).
clean(
  'the exact string that broke the gate',
  '{launched} קבוצות התחילו. {held} קבוצות ממתינות לאישור אפוטרופוס ולא יוכלו להתחיל בלעדיו.',
);
clean('single multi-letter placeholder', 'נותרו {max} ניסיונות');
clean('placeholder as the whole latin content', 'הקבוצה {team} סיימה');
clean('several placeholders in one string', '{launched} מתוך {max} עבור {team}');
clean('placeholder with an underscore', 'שלום {team_name}, ברוכים הבאים');
clean('single-letter placeholder (passed before the fix, by luck)', 'נותרו {n} דקות');
clean('alphanumeric placeholder', 'המשימה {a1} הושלמה');
clean('a placeholder-only string', '{launched}');

// ── Anti-blinding: the detector was corrected, not switched off ───────────────
console.log('\n── real English is STILL flagged ──');

leaks('plain English word inside Hebrew', 'הניקוד updated בהצלחה');
leaks('English word AND a placeholder in the same string', 'הניקוד updated עבור {team}');
leaks('placeholder first, English after', '{launched} teams started');
leaks('English between two placeholders', '{launched} teams of {max}');
leaks('an English sentence', 'Teams are waiting for guardian approval.');
leaks('a bare two-letter English word', 'שלום ok');
// The placeholder NAME is an English word; stripping it must not also strip the
// identical word when it appears as actual copy.
leaks('same word as placeholder AND as copy', '{launched} כבר launched');

console.log('\n── genuinely clean Hebrew ──');
clean('pure Hebrew', 'הניקוד עודכן בהצלחה');
clean('Hebrew with digits and punctuation', 'נותרו 5 דקות, מהרו!');
clean('a single stray Latin letter is not a word', 'שלום a');

// ── Placeholder edge cases ───────────────────────────────────────────────────
console.log('\n── placeholder edge cases ──');

check('stripPlaceholders removes the canonical form',
  stripPlaceholders('a {launched} b') === 'a  b',
  JSON.stringify(stripPlaceholders('a {launched} b')));
check('stripPlaceholders leaves non-placeholder text alone',
  stripPlaceholders('launched') === 'launched');

clean('empty braces', 'שלום {} עולם');
clean('braces around digits only', 'שלום {42} עולם');
clean('placeholder hugging punctuation', 'התחילו: {launched}, ממתינות: {held}. סה"כ {max}!');
clean('placeholder in parentheses', 'הקבוצה ({team}) סיימה');
clean('nested braces — the inner canonical token is stripped', 'שלום {{launched}} עולם');
clean('brace with no letters at all', 'שלום { עולם');
clean('spaced braces around a single letter (2+ rule covers it)', 'נותרו { n } דקות');

// KNOWN LIMITS — pinned deliberately, not accidents. The dictionaries use the
// canonical `{name}` form; anything looser would have to swallow arbitrary text
// between braces, which is how a leak detector goes blind. These assertions exist
// so that widening the rule is a conscious decision that breaks a test first.
console.log('\n── known limits (pinned on purpose) ──');
leaks('LIMIT: spaces inside the braces are not the canonical form', 'נותרו { launched } ניסיונות');
leaks('LIMIT: a hyphen is not part of the canonical form', 'הקבוצה {team-name} סיימה');
leaks('LIMIT: an unclosed brace is not a placeholder', 'שלום {launched עולם');
leaks('LIMIT: a bare `{` with English after it', 'שלום { launched');
leaks('LIMIT: a closing brace with no opener', 'שלום launched} עולם');

// ── Digit-code stripping (pre-existing behaviour, must survive) ───────────────
console.log('\n── digit-bearing sample codes ──');

clean('sample code FOX42 in Hebrew copy', 'הקוד שלכם הוא FOX42');
clean('sample code ABC123 in Hebrew copy', 'הזינו ABC123 כדי להצטרף');
clean('lower-case id with a digit', 'המזהה game7 נוצר');
clean('a code next to a placeholder', 'הקוד FOX42 עבור {team}');
leaks('the same token WITHOUT a digit is English again', 'הקוד שלכם הוא FOX');

// ── LATIN_WHITELIST (pre-existing behaviour, must survive) ───────────────────
console.log('\n── latin whitelist ──');

for (const w of LATIN_WHITELIST) {
  clean(`whitelisted "${w}" inside Hebrew copy`, `ברוכים הבאים ל ${w} היום`);
}
clean('whitelist entry beside a placeholder', 'סרקו QR עבור {team}');
leaks('a non-whitelisted brand-looking word is still flagged', 'ברוכים הבאים ל Foobar היום');

// ── A4: the opposite direction — Hebrew must not leak into English ───────────
console.log('\n── A4: Hebrew leaking into English leaves ──');

check('A4 flags Hebrew inside English copy',
  hasHebrew('Score updated שלום') === true);
check('A4 does not flag clean English',
  hasHebrew('Score updated successfully') === false);
check('A4 does not flag English carrying placeholders',
  hasHebrew('{launched} teams started, {held} waiting') === false);
check('A4 ignores the whitelisted language name on its own',
  hasHebrew(HEBREW_WHITELIST[0]) === false);
check('A4 still flags Hebrew next to the whitelisted language name',
  hasHebrew(`${HEBREW_WHITELIST[0]} שלום`) === true);
check('A4 flags a single Hebrew letter (no 2+ rule on this side)',
  hasHebrew('Score ש') === true);
// Placeholder stripping belongs to the English-word test only; it must not have
// been wired into the Hebrew test, where a `{name}` token is irrelevant.
check('A4 flags Hebrew even when it sits inside braces',
  hasHebrew('teams {שלום}') === true);

// ── Structural guard: the rule must exist exactly once ───────────────────────
// Both checkers previously held near-duplicate copies "kept in sync" by a comment,
// and both carried the same defect. If a copy ever reappears, this fails.
console.log('\n── single definition (no drift) ──');

const gate = readFileSync(join(process.cwd(), 'scripts/check-i18n.ts'), 'utf8');
const parity = readFileSync(join(process.cwd(), 'scripts/test-i18n-parity.ts'), 'utf8');

check('check-i18n.ts imports the shared predicates', /from '\.\/lib\/i18nLeak'/.test(gate));
check('test-i18n-parity.ts imports the shared predicates', /from '\.\/lib\/i18nLeak'/.test(parity));
check('check-i18n.ts does not redefine the placeholder regex',
  !/\\\{\[A-Za-z0-9_\]\+\\\}/.test(gate));
check('test-i18n-parity.ts does not redefine the placeholder regex',
  !/\\\{\[A-Za-z0-9_\]\+\\\}/.test(parity));
check('neither checker redefines the 2+ Latin-letter rule',
  !/\[A-Za-z\]\{2,\}/.test(gate) && !/\[A-Za-z\]\{2,\}/.test(parity));
check('neither checker redefines the whitelist array',
  !/'RushPoint'/.test(gate) && !/'RushPoint'/.test(parity));

console.log(`\n${failures === 0 ? 'ALL I18N-LEAK TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
