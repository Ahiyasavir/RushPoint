// Pure-logic tests for the creator "sign in methods" card (change: creator-signin-methods).
//
// Everything the feature DECIDES lives in apps/creator-web/src/lib/signInMethods.ts and is
// imported here directly: which actions to offer for a given provider set, whether a Google
// identity is allowed to be linked (the same-email guard), whether a mismatch needs an unlink
// rollback, how to re-confirm identity, and how a Firebase error code becomes a translated
// message key. No Firebase SDK, no DOM, no emulator.
//
//   npx tsx scripts/test-signin-methods.ts
import {
  PASSWORD_PROVIDER_ID,
  GOOGLE_PROVIDER_ID,
  activeSignInMethods,
  availableSignInActions,
  normalizeEmail,
  checkGoogleLinkEmail,
  googleEmailFromLink,
  needsRollback,
  authErrorKey,
  reauthMethod,
} from '../apps/creator-web/src/lib/signInMethods';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const pw = { providerId: PASSWORD_PROVIDER_ID };
const goo = (email?: string | null) => ({ providerId: GOOGLE_PROVIDER_ID, email });
const other = { providerId: 'apple.com' };

// ── Provider ids are the Firebase constants, not invented strings ─────────────
check('PASSWORD_PROVIDER_ID is "password"', PASSWORD_PROVIDER_ID === 'password');
check('GOOGLE_PROVIDER_ID is "google.com"', GOOGLE_PROVIDER_ID === 'google.com');

// ── activeSignInMethods ───────────────────────────────────────────────────────
{
  const none = activeSignInMethods([]);
  check('no providers: neither active', none.password === false && none.google === false);

  const onlyPw = activeSignInMethods([pw]);
  check('password only: password active, google not', onlyPw.password === true && onlyPw.google === false);

  const onlyGoo = activeSignInMethods([goo('a@b.com')]);
  check('google only: google active, password not', onlyGoo.google === true && onlyGoo.password === false);

  const both = activeSignInMethods([pw, goo('a@b.com')]);
  check('both providers: both active', both.password === true && both.google === true);

  const reversed = activeSignInMethods([goo('a@b.com'), pw]);
  check('provider order is irrelevant', reversed.password === true && reversed.google === true);

  const withUnknown = activeSignInMethods([other, pw, other]);
  check('unknown provider ids are ignored', withUnknown.password === true && withUnknown.google === false);

  const unknownOnly = activeSignInMethods([other]);
  check('unknown provider alone activates nothing',
    unknownOnly.password === false && unknownOnly.google === false);

  check('null/undefined provider list is treated as empty',
    activeSignInMethods(null).password === false
    && activeSignInMethods(undefined).google === false);
}

// ── availableSignInActions — only offer what actually applies ─────────────────
{
  const forGoogle = availableSignInActions([goo('a@b.com')]);
  check('google-only account is offered "add password"', forGoogle.canAddPassword === true);
  check('google-only account is NOT offered "link google"', forGoogle.canLinkGoogle === false);

  const forPassword = availableSignInActions([pw]);
  check('password-only account is offered "link google"', forPassword.canLinkGoogle === true);
  check('password-only account is NOT offered "add password"', forPassword.canAddPassword === false);

  const forBoth = availableSignInActions([pw, goo('a@b.com')]);
  check('fully linked account is offered neither action',
    forBoth.canAddPassword === false && forBoth.canLinkGoogle === false);

  const forNone = availableSignInActions([]);
  check('account with no known provider is offered both',
    forNone.canAddPassword === true && forNone.canLinkGoogle === true);
}

// ── normalizeEmail ────────────────────────────────────────────────────────────
check('normalizeEmail trims', normalizeEmail('  a@b.com  ') === 'a@b.com');
check('normalizeEmail lowercases', normalizeEmail('A@B.CoM') === 'a@b.com');
check('normalizeEmail trims + lowercases', normalizeEmail(' Creator@Example.COM ') === 'creator@example.com');
check('normalizeEmail(null) is empty', normalizeEmail(null) === '');
check('normalizeEmail(undefined) is empty', normalizeEmail(undefined) === '');
check('normalizeEmail("   ") is empty', normalizeEmail('   ') === '');

// ── checkGoogleLinkEmail — the hard requirement ───────────────────────────────
{
  const exact = checkGoogleLinkEmail('a@b.com', 'a@b.com');
  check('exact match is accepted', exact.ok === true);

  const cased = checkGoogleLinkEmail('Creator@Example.com', '  creator@example.com ');
  check('case + whitespace difference still matches', cased.ok === true);

  const mismatch = checkGoogleLinkEmail('a@x.com', 'b@y.com');
  check('different google account is refused', mismatch.ok === false);
  if (!mismatch.ok) {
    check('mismatch verdict reason is "mismatch"', mismatch.reason === 'mismatch');
    check('mismatch verdict names the account email', mismatch.accountEmail === 'a@x.com');
    check('mismatch verdict names the google email', mismatch.googleEmail === 'b@y.com');
  }

  const noGoogle = checkGoogleLinkEmail('a@x.com', null);
  check('missing google email is refused (never a silent pass)', noGoogle.ok === false);
  if (!noGoogle.ok) check('missing google email reason', noGoogle.reason === 'missing-google-email');

  const emptyGoogle = checkGoogleLinkEmail('a@x.com', '   ');
  check('blank google email is refused', emptyGoogle.ok === false);
  if (!emptyGoogle.ok) check('blank google email reason', emptyGoogle.reason === 'missing-google-email');

  const noAccount = checkGoogleLinkEmail(undefined, 'b@y.com');
  check('missing account email is refused', noAccount.ok === false);
  if (!noAccount.ok) check('missing account email reason', noAccount.reason === 'missing-account-email');

  const neither = checkGoogleLinkEmail('', '');
  check('both missing is refused', neither.ok === false);
  if (!neither.ok) check('both missing blames the account first', neither.reason === 'missing-account-email');
}

// ── googleEmailFromLink — where the linked identity's email is read from ──────
{
  check('prefers the google.com provider entry',
    googleEmailFromLink([pw, goo('g@x.com')], 'profile@x.com') === 'g@x.com');
  check('falls back to the additional-user-info profile email',
    googleEmailFromLink([pw, goo(null)], 'profile@x.com') === 'profile@x.com');
  check('falls back when there is no google entry at all',
    googleEmailFromLink([pw], 'profile@x.com') === 'profile@x.com');
  check('returns empty when neither source has an email',
    googleEmailFromLink([pw, goo(undefined)], undefined) === '');
  check('normalizes what it returns',
    googleEmailFromLink([goo(' G@X.com ')], undefined) === 'g@x.com');
}

// ── needsRollback — never unlink a provider that was already there ────────────
{
  const bad = checkGoogleLinkEmail('a@x.com', 'b@y.com');
  const good = checkGoogleLinkEmail('a@x.com', 'a@x.com');
  check('mismatch + google was NOT linked before => roll back', needsRollback(false, bad) === true);
  check('mismatch + google WAS linked before => do NOT unlink', needsRollback(true, bad) === false);
  check('accepted + not linked before => no rollback', needsRollback(false, good) === false);
  check('accepted + linked before => no rollback', needsRollback(true, good) === false);
}

// ── authErrorKey — every realistic code becomes a translated key ──────────────
{
  const cases: Array<[string, string]> = [
    ['auth/credential-already-in-use', 'credentialAlreadyInUse'],
    ['credential-already-in-use',      'credentialAlreadyInUse'],
    ['auth/email-already-in-use',      'emailAlreadyInUse'],
    ['email-already-in-use',           'emailAlreadyInUse'],
    ['auth/provider-already-linked',   'providerAlreadyLinked'],
    ['provider-already-linked',        'providerAlreadyLinked'],
    ['auth/popup-closed-by-user',      'popupCancelled'],
    ['auth/cancelled-popup-request',   'popupCancelled'],
    ['auth/user-cancelled',            'popupCancelled'],
    ['auth/popup-blocked',             'popupBlocked'],
    ['auth/requires-recent-login',     'requiresRecentLogin'],
    ['requires-recent-login',          'requiresRecentLogin'],
    ['auth/weak-password',             'weakPassword'],
    ['auth/network-request-failed',    'network'],
    ['auth/wrong-password',            'wrongPassword'],
    ['auth/invalid-credential',        'wrongPassword'],
    ['auth/invalid-login-credentials', 'wrongPassword'],
    ['auth/too-many-requests',         'tooManyRequests'],
  ];
  for (const [code, expected] of cases) {
    const got = authErrorKey({ code });
    check(`authErrorKey(${code}) => ${expected}`, got === expected, `got ${got}`);
  }

  check('unknown code falls back to generic', authErrorKey({ code: 'auth/moon-phase-wrong' }) === 'generic');
  check('error with no code falls back to generic', authErrorKey(new Error('Firebase: boom')) === 'generic');
  check('non-error value falls back to generic', authErrorKey('nope') === 'generic');
  check('null falls back to generic', authErrorKey(null) === 'generic');
  check('undefined falls back to generic', authErrorKey(undefined) === 'generic');
  check('non-string code falls back to generic', authErrorKey({ code: 42 }) === 'generic');
}

// ── reauthMethod — re-confirm with a method the account actually has ──────────
check('password account re-auths with its password', reauthMethod([pw]) === 'password');
check('account with both prefers the password re-auth', reauthMethod([pw, goo('a@b.com')]) === 'password');
check('google-only account re-auths with a google popup', reauthMethod([goo('a@b.com')]) === 'google');
check('no known provider has no re-auth method', reauthMethod([]) === 'none');
check('unknown-provider-only has no re-auth method', reauthMethod([other]) === 'none');

console.log(
  failures === 0
    ? '\n✅ ALL SIGN-IN-METHOD TESTS PASSED'
    : `\n❌ ${failures} SIGN-IN-METHOD TEST(S) FAILED`,
);
process.exitCode = failures === 0 ? 0 : 1;
