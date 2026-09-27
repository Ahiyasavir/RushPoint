// Turn a Firebase Auth rejection into something a creator can read and act on
// (change: friendly-auth-errors).
//
// The login card used to render `e.message.replace('Firebase: ', '')` inline in
// red — so a creator who mistyped their password read
// "Error (auth/invalid-credential)." or, when the deployed bundle carries a bad
// API key, "Error (auth/api-key-not-valid. Please pass a valid API key.)". Both
// are useless to the person reading them, and the first one — "there is no
// account with these details" — has an obvious next step (sign up) that the raw
// string never offers.
//
// This is a pure, DOM-free mapping: unit-tested by scripts/test-auth-error.ts,
// no emulator. It decides NOTHING about auth — the Firebase SDK stays the only
// authority on whether a credential is valid; this only translates the verdict.

export type AuthErrorKey =
  | 'wrongCredentials' // email/password did not match any account
  | 'emailInUse'       // sign-up: an account with this email already exists
  | 'invalidEmail'     // malformed email address
  | 'weakPassword'     // sign-up: password rejected as too weak
  | 'tooManyRequests'  // throttled after repeated failures
  | 'network'          // request never reached Firebase
  | 'userDisabled'     // the account exists but is disabled
  | 'methodDisabled'   // email/password sign-in is switched off for the project
  | 'config'           // bad API key / project misconfiguration — our problem, not theirs
  | 'unknown';         // anything else — never a raw server sentence

export interface AuthErrorInfo {
  key: AuthErrorKey;
  /** The Google popup was closed or blocked by the user — show nothing at all. */
  silent: boolean;
  /** Offer a popup that switches the card to sign-up (no matching account). */
  suggestSignUp: boolean;
  /** Offer a popup that switches the card to sign-in (email already registered). */
  suggestSignIn: boolean;
}

/** Pull the bare `invalid-credential` slug out of a code, a message, or nothing. */
function extractCode(e: unknown): string {
  const raw =
    e && typeof e === 'object' && 'code' in e ? (e as { code?: unknown }).code : undefined;
  if (typeof raw === 'string' && raw) return raw.replace(/^auth\//, '').toLowerCase();

  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const m = msg.match(/auth\/([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : '';
}

const WRONG_CREDENTIALS = new Set([
  'invalid-credential',
  'invalid-login-credentials',
  'wrong-password',
  'user-not-found',
  'user-mismatch',
]);

const SILENT_POPUP = new Set([
  'popup-closed-by-user',
  'cancelled-popup-request',
  'popup-blocked',
  'user-cancelled',
]);

const CONFIG = new Set([
  'api-key-not-valid',
  'invalid-api-key',
  'app-deleted',
  'app-not-authorized',
  'unauthorized-domain',
  'internal-error',
  'invalid-app-credential',
  'invalid-app-id',
]);

/**
 * `operation-not-allowed` is deliberately NOT in CONFIG. It has a specific,
 * survivable meaning — the Email/Password provider is switched off in the
 * Firebase console — and a specific way out: the Google button, which is a
 * different provider and keeps working. Folding it into the generic "temporary
 * problem" message would hide a door that is standing open. Observed live on
 * 2026-08-27 (PASSWORD_LOGIN_DISABLED / OPERATION_NOT_ALLOWED on the project).
 */
const METHOD_DISABLED = 'operation-not-allowed';

const NETWORK = new Set(['network-request-failed', 'timeout', 'web-storage-unsupported']);

/**
 * Map any thrown value to an {@link AuthErrorInfo}. Total: an Error with a code,
 * an Error with only a message, a bare string, `null` and `undefined` all yield
 * a value and never throw.
 */
export function authErrorInfo(e: unknown): AuthErrorInfo {
  const code = extractCode(e);
  const base: AuthErrorInfo = { key: 'unknown', silent: false, suggestSignUp: false, suggestSignIn: false };

  if (SILENT_POPUP.has(code)) return { ...base, silent: true };
  if (WRONG_CREDENTIALS.has(code)) return { ...base, key: 'wrongCredentials', suggestSignUp: true };
  if (code === 'email-already-in-use') return { ...base, key: 'emailInUse', suggestSignIn: true };
  if (code === 'invalid-email') return { ...base, key: 'invalidEmail' };
  if (code === 'weak-password') return { ...base, key: 'weakPassword' };
  if (code === 'too-many-requests') return { ...base, key: 'tooManyRequests' };
  if (code === 'user-disabled') return { ...base, key: 'userDisabled' };
  if (code === METHOD_DISABLED) return { ...base, key: 'methodDisabled' };
  if (NETWORK.has(code)) return { ...base, key: 'network' };
  if (CONFIG.has(code)) return { ...base, key: 'config' };
  return base;
}
