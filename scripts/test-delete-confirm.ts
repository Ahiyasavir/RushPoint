// Pure-logic test for the type-to-confirm predicate on destructive game actions
// (bug: an untitled game could never be purged).
//
// `matchesGameDeleteConfirmation(typed, title)` gates the Trash PurgeDialog's
// destructive button. When the game has a title the creator must echo it back
// exactly (case-sensitive, whitespace forgiven). A title-less new-game draft has
// no title to echo, so it used to return false for ALL input — the confirm button
// was permanently disabled and the draft could never be purged. The blank-title
// case now falls back to the fixed uppercase token DELETE. No emulator.
//   npx tsx scripts/test-delete-confirm.ts
import {
  matchesGameDeleteConfirmation,
} from '../apps/creator-web/src/lib/deleteConfirm';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── titled game: exact case-sensitive match, whitespace forgiven ──────────────
console.log('\n── titled ──');
check('exact title confirms', matchesGameDeleteConfirmation('Old City Hunt', 'Old City Hunt'));
check('title with surrounding whitespace confirms',
  matchesGameDeleteConfirmation('  Old City Hunt  ', 'Old City Hunt'));
check('wrong text does NOT confirm',
  !matchesGameDeleteConfirmation('old city hunt', 'Old City Hunt'));
check('empty input does NOT confirm a titled game',
  !matchesGameDeleteConfirmation('', 'Old City Hunt'));
check('the DELETE token does NOT confirm a titled game',
  !matchesGameDeleteConfirmation('DELETE', 'Old City Hunt'));

// ── blank title: fall back to the DELETE token ───────────────────────────────
console.log('\n── blank title ──');
check('blank title accepts DELETE', matchesGameDeleteConfirmation('DELETE', ''));
check('blank title accepts DELETE with whitespace',
  matchesGameDeleteConfirmation('  DELETE  ', ''));
check('blank title rejects empty input', !matchesGameDeleteConfirmation('', ''));
check('blank title rejects other input', !matchesGameDeleteConfirmation('delete', ''));
check('blank title rejects arbitrary text',
  !matchesGameDeleteConfirmation('yes', ''));

// ── whitespace-only / nullish title treated as blank ─────────────────────────
console.log('\n── whitespace-only / nullish title ──');
check('whitespace-only title accepts DELETE',
  matchesGameDeleteConfirmation('DELETE', '   '));
check('whitespace-only title rejects empty input',
  !matchesGameDeleteConfirmation('', '   '));
check('null title accepts DELETE', matchesGameDeleteConfirmation('DELETE', null));
check('undefined title accepts DELETE', matchesGameDeleteConfirmation('DELETE', undefined));
check('nullish typed with blank title does NOT confirm',
  !matchesGameDeleteConfirmation(null, ''));

console.log(`\n${failures === 0 ? 'ALL DELETE-CONFIRM TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
