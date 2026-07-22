// Pure-logic tests for the "no silent failures" change (change: play-no-silent-failures).
//
// Three decisions repeat across ten-odd UI sites, so they live as pure functions
// instead of inside .tsx (play-web has no component test runner):
//   1. is a task-card message an ERROR or PROGRESS?          → taskMessageClass
//   2. what does a rejection mean to a staff volunteer?      → classifyStaffError
//   3. what does a rejection mean to a paying creator?       → classifyBillingError
// Plus the announcement payload rule (a Hebrew-only broadcast must still reach
// English-language participants) and the routing retry-reveal state machine.
//
// The LEAK GUARD assertions matter most: a classifier must read `e.code` ONLY,
// never free-form message text, so an untranslated server string can never be
// echoed to a user.
//
//   npx tsx scripts/test-failure-visibility.ts
import {
  taskMessageClass, classifyStaffError, announcementPayload, shouldOfferRetry,
} from '../apps/play-web/src/lib/failureCopy';
import { translations as playT } from '../apps/play-web/src/i18n';
import { classifyBillingError, classifyCallError } from '../apps/creator-web/src/lib/callErrors';
import { translations as creatorT } from '../apps/creator-web/src/i18n';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── 1. taskMessageClass — an error must LOOK like an error ────────────────────
check('error tone uses the alert colour', taskMessageClass('error').includes('text-rp-alert'));
check('progress tone does not use the alert colour', !taskMessageClass('progress').includes('text-rp-alert'));
check('progress tone is neutral zinc', taskMessageClass('progress').includes('text-zinc-'));
// Tailwind only sees STATIC class strings (CLAUDE.md: no bg-${x}).
check('error class string is static', !taskMessageClass('error').includes('${'));
check('progress class string is static', !taskMessageClass('progress').includes('${'));
check('the two tones are visually distinct', taskMessageClass('error') !== taskMessageClass('progress'));

// ── 2. classifyStaffError — code-only, and every key has copy ─────────────────
check('permission-denied is an expired session',
  classifyStaffError({ code: 'permission-denied' }).key === 'sessionExpired'
  && classifyStaffError({ code: 'permission-denied' }).sessionExpired === true);
check('unauthenticated is an expired session',
  classifyStaffError({ code: 'unauthenticated' }).sessionExpired === true);
check('the functions/ prefix is stripped',
  classifyStaffError({ code: 'functions/unauthenticated' }).key === 'sessionExpired');
check('not-found maps to notFound and is NOT an expired session',
  classifyStaffError({ code: 'not-found' }).key === 'notFound'
  && classifyStaffError({ code: 'not-found' }).sessionExpired === false);
check('resource-exhausted maps to rateLimited',
  classifyStaffError({ code: 'resource-exhausted' }).key === 'rateLimited');
check('unavailable maps to offline',
  classifyStaffError({ code: 'unavailable' }).key === 'offline');
check('deadline-exceeded maps to offline',
  classifyStaffError({ code: 'deadline-exceeded' }).key === 'offline');

// LEAK GUARD: message text is never classified, so it can never be echoed.
check('a raw English message with NO code is generic (never classified by text)',
  classifyStaffError(new Error('Missing or insufficient permissions')).key === 'generic');
check('a raw message with no code never claims an expired session',
  classifyStaffError(new Error('Missing or insufficient permissions')).sessionExpired === false);

// Total function: never throws on junk.
for (const junk of [undefined, null, 'a string', {}, 0, [], { code: 42 }]) {
  let key = '';
  try { key = classifyStaffError(junk).key; } catch { key = '<threw>'; }
  check(`junk input ${JSON.stringify(junk) ?? 'undefined'} is generic, no throw`, key === 'generic');
}

// Copy parity: a mapper key with no dictionary entry would render blank.
const staffKeys = ['sessionExpired', 'notFound', 'rateLimited', 'offline', 'generic'] as const;
for (const k of staffKeys) {
  check(`t.staff.${k} exists in HE`, typeof playT.he.staff[k] === 'string' && playT.he.staff[k].length > 0);
  check(`t.staff.${k} exists in EN`, typeof playT.en.staff[k] === 'string' && playT.en.staff[k].length > 0);
}
check('t.staff.backToSignIn exists in both', !!playT.he.staff.backToSignIn && !!playT.en.staff.backToSignIn);
check('t.staff.broadcastFailed exists in both', !!playT.he.staff.broadcastFailed && !!playT.en.staff.broadcastFailed);

// ── 3. announcementPayload — a Hebrew-only broadcast must still reach everyone ─
check('both empty means do not dispatch', announcementPayload('', '') === null);
check('whitespace only counts as empty', announcementPayload('   ', '\t\n') === null);

const enOnly = announcementPayload('Head to the fountain', '');
check('English only sends the English body', enOnly?.message === 'Head to the fountain');
check('English only sends no Hebrew body', enOnly?.messageHe === undefined);

// THE participant-visibility guard: LiveOps renders `messageHe` for he-lang
// players and `message` for everyone else. A Hebrew-only broadcast with an empty
// `message` would render an EMPTY bubble to every English-language participant.
const heOnly = announcementPayload('', 'התכנסו בכיכר');
check('Hebrew only fills the Hebrew body', heOnly?.messageHe === 'התכנסו בכיכר');
check('Hebrew only ALSO fills the default body (never an empty bubble)',
  heOnly?.message === 'התכנסו בכיכר');

const both = announcementPayload('Meet at the square', 'התכנסו בכיכר');
check('both fields are carried through',
  both?.message === 'Meet at the square' && both?.messageHe === 'התכנסו בכיכר');

check('input is trimmed', announcementPayload('  Go  ', '')?.message === 'Go');
for (const [en, he] of [['x', ''], ['', 'ש'], ['x', 'ש']] as const) {
  const p = announcementPayload(en, he);
  check(`a dispatched payload never has an empty message (${en}|${he})`,
    p !== null && typeof p.message === 'string' && p.message.length > 0);
}

// ── 4. shouldOfferRetry — the routing wait reveal ─────────────────────────────
check('11999ms on the first attempt hides the retry', shouldOfferRetry(11_999, 0) === false);
check('12000ms on the first attempt reveals the retry', shouldOfferRetry(12_000, 0) === true);
check('after one retry the option stays visible immediately', shouldOfferRetry(0, 1) === true);
check('NaN never reveals', shouldOfferRetry(Number.NaN, 0) === false);
check('a negative wait never reveals', shouldOfferRetry(-1, 0) === false);

// ── 5. classifyBillingError (creator-web) — money copy is never raw ───────────
check('failed-precondition is insufficient funds',
  classifyBillingError({ code: 'failed-precondition' }) === 'insufficientFunds');
check('resource-exhausted is rate limited',
  classifyBillingError({ code: 'resource-exhausted' }) === 'rateLimited');
check('unavailable is offline', classifyBillingError({ code: 'unavailable' }) === 'offline');
check('unimplemented is not configured',
  classifyBillingError({ code: 'unimplemented' }) === 'notConfigured');
check('the functions/ prefix is stripped here too',
  classifyBillingError({ code: 'functions/unavailable' }) === 'offline');
check('an unknown code is generic', classifyBillingError({ code: 'teapot' }) === 'generic');
check('a raw message with no code is generic (leak guard)',
  classifyBillingError(new Error('Not enough credits')) === 'generic');
for (const junk of [undefined, null, 'x', {}]) {
  let k = '';
  try { k = classifyBillingError(junk); } catch { k = '<threw>'; }
  check(`billing junk ${JSON.stringify(junk) ?? 'undefined'} is generic, no throw`, k === 'generic');
}
check('classifyCallError is total', classifyCallError(undefined) === 'generic');
check('classifyCallError strips the prefix',
  classifyCallError({ code: 'functions/unavailable' }) === 'offline');

const walletKeys = ['insufficientFunds', 'rateLimited', 'offline', 'notConfigured', 'generic'] as const;
for (const k of walletKeys) {
  check(`t.wallet.${k} exists in HE`, typeof creatorT.he.wallet[k] === 'string' && creatorT.he.wallet[k].length > 0);
  check(`t.wallet.${k} exists in EN`, typeof creatorT.en.wallet[k] === 'string' && creatorT.en.wallet[k].length > 0);
}

console.log(`\n${failures === 0 ? 'ALL FAILURE-VISIBILITY TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
