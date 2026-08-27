// Pure-logic test for the creator login error mapping (change: friendly-auth-errors).
//
// The login card used to render the raw Firebase message inline in red, so a
// creator who mistyped a password read "Error (auth/invalid-credential)." and,
// when the deployed bundle carried a bad API key, "Error (auth/api-key-not-valid.
// Please pass a valid API key.)". `authErrorInfo` turns any thrown value into a
// key + whether to offer a jump to sign-up / sign-in; AuthGate renders it as a
// popup. No emulator.
//   npx tsx scripts/test-auth-error.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authErrorInfo, type AuthErrorKey } from '../apps/creator-web/src/lib/authError';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

function fbErr(code: string, message = 'server prose'): unknown {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

function expect(
  label: string,
  e: unknown,
  want: Partial<ReturnType<typeof authErrorInfo>> & { key: AuthErrorKey },
): void {
  const got = authErrorInfo(e);
  const ok = (Object.keys(want) as (keyof typeof want)[]).every((k) => got[k] === want[k]);
  check(label, ok, `got ${JSON.stringify(got)}`);
}

// ── no account with those details → offer sign-up ────────────────────────────
console.log('\n── wrong credentials ──');
for (const c of ['invalid-credential', 'invalid-login-credentials', 'wrong-password', 'user-not-found']) {
  expect(`auth/${c} → wrongCredentials + suggestSignUp`, fbErr(`auth/${c}`), {
    key: 'wrongCredentials', suggestSignUp: true, suggestSignIn: false, silent: false,
  });
}
// The message-only shape (some SDK builds don't set .code on the rejection).
expect('message-only invalid-credential still maps', new Error('Firebase: Error (auth/invalid-credential).'), {
  key: 'wrongCredentials', suggestSignUp: true,
});

// ── email already in use → offer sign-in ────────────────────────────────────
console.log('\n── email in use ──');
expect('auth/email-already-in-use → emailInUse + suggestSignIn', fbErr('auth/email-already-in-use'), {
  key: 'emailInUse', suggestSignIn: true, suggestSignUp: false,
});

// ── the screenshot: a bad API key in the deployed bundle ────────────────────
console.log('\n── config ──');
for (const c of ['api-key-not-valid', 'invalid-api-key', 'unauthorized-domain', 'internal-error']) {
  expect(`auth/${c} → config (not the user's fault, no sign-up nudge)`, fbErr(`auth/${c}`), {
    key: 'config', suggestSignUp: false, suggestSignIn: false, silent: false,
  });
}
expect('the exact screenshot string maps to config',
  new Error('Firebase: Error (auth/api-key-not-valid.-please-pass-a-valid-api-key.).'),
  { key: 'config' });

// ── silent: the user dismissed the Google popup ─────────────────────────────
console.log('\n── silent popup ──');
for (const c of ['popup-closed-by-user', 'cancelled-popup-request', 'popup-blocked']) {
  expect(`auth/${c} → silent`, fbErr(`auth/${c}`), { key: 'unknown', silent: true });
}

// ── the rest ───────────────────────────────────────────────────────────────
console.log('\n── other codes ──');
expect('auth/invalid-email → invalidEmail', fbErr('auth/invalid-email'), { key: 'invalidEmail' });
expect('auth/weak-password → weakPassword', fbErr('auth/weak-password'), { key: 'weakPassword' });
expect('auth/too-many-requests → tooManyRequests', fbErr('auth/too-many-requests'), { key: 'tooManyRequests' });
expect('auth/network-request-failed → network', fbErr('auth/network-request-failed'), { key: 'network' });
expect('auth/user-disabled → userDisabled', fbErr('auth/user-disabled'), { key: 'userDisabled' });

// operation-not-allowed is NOT config: the Email/Password provider being switched
// off in the Firebase console is survivable, and the Google button (a different
// provider) still works. Observed live 2026-08-27 — PASSWORD_LOGIN_DISABLED on
// sign-in and OPERATION_NOT_ALLOWED on sign-up, project-wide.
expect('auth/operation-not-allowed → methodDisabled, NOT config',
  fbErr('auth/operation-not-allowed'),
  { key: 'methodDisabled', suggestSignUp: false, suggestSignIn: false, silent: false });

// ── total function: never throws, always a key ─────────────────────────────
console.log('\n── totality ──');
for (const [label, e] of [
  ['null', null], ['undefined', undefined], ['bare string', 'boom'],
  ['plain object', {}], ['non-string code', { code: 42 }], ['unknown code', fbErr('auth/whatever')],
  ['Error, no code', new Error('boom')],
] as const) {
  const VALID: AuthErrorKey[] = ['wrongCredentials', 'emailInUse', 'invalidEmail', 'weakPassword',
    'tooManyRequests', 'network', 'userDisabled', 'methodDisabled', 'config', 'unknown'];
  const got = authErrorInfo(e);
  check(`${label} → a valid key, no throw`,
    VALID.includes(got.key) && typeof got.silent === 'boolean');
}

// ── wiring + copy guards ───────────────────────────────────────────────────
console.log('\n── AuthGate wiring ──');
const gate = readFileSync(join(process.cwd(), 'apps/creator-web/src/components/AuthGate.tsx'), 'utf8');
check('AuthGate imports authErrorInfo', /from '\.\.\/lib\/authError'/.test(gate));
check('AuthGate routes failures through handleAuthError', /handleAuthError\(e\)/.test(gate));
check('no raw Firebase message is shown inline any more',
  !/message\.replace\(\/\^Firebase: \//.test(gate));
check('the no-account case offers a sign-up jump', /switchMode\('up'\)/.test(gate) && /suggestSignUp/.test(gate));

console.log('\n── copy ──');
const i18n = readFileSync(join(process.cwd(), 'apps/creator-web/src/i18n.ts'), 'utf8');
const noMatch = i18n.match(/noMatchTitle: (['"])(?:(?!\1).)*\1/g) ?? [];
check('noMatchTitle exists in BOTH dictionaries', noMatch.length === 2, `${noMatch.length} found`);
check('the Hebrew noMatchTitle copy is Hebrew', /[֐-׿]/.test(noMatch[0] ?? ''));
const createCta = i18n.match(/createAccountCta: (['"])(?:(?!\1).)*\1/g) ?? [];
check('createAccountCta exists in BOTH dictionaries', createCta.length === 2, `${createCta.length} found`);

// Every copy key AuthGate can reach must exist in BOTH dictionaries. Without this,
// adding an AuthErrorKey and forgetting the copy renders `undefined` in the popup —
// the same silent payload-omission class as a field missing from a projection: the
// mapping is right, the render is right, and the user reads nothing useful.
// `wrongCredentials` is absent on purpose: it always carries suggestSignUp, so it is
// rendered through `noMatchTitle` and never through `ae[key]`.
const REACHABLE_COPY = [
  'noMatchTitle', 'createAccountCta', 'emailInUse', 'goToSignInCta',
  'invalidEmail', 'weakPassword', 'tooManyRequests', 'network',
  'userDisabled', 'methodDisabled', 'config', 'unknown',
];
let missingCopy = 0;
for (const k of REACHABLE_COPY) {
  const hits = i18n.match(new RegExp(`\\b${k}: (['"])(?:(?!\\1).)*\\1`, 'g')) ?? [];
  if (hits.length !== 2) { missingCopy++; console.log(`  ${k}: ${hits.length} definition(s), want 2`); }
}
check(`all ${REACHABLE_COPY.length} reachable copy keys are defined in BOTH dictionaries`,
  missingCopy === 0, `${missingCopy} incomplete`);

console.log(`\n${failures === 0 ? 'ALL AUTH-ERROR TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
