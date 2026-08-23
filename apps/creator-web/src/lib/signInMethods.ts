// Sign-in method decisions for the creator account (change: creator-signin-methods).
//
// PURE by design: this module imports nothing from `firebase/*`, so it runs under tsx in the
// node test lane with no SDK, no DOM and no Vite env — exactly like services/authClaims.ts.
// Firebase's `User['providerData']` is structurally assignable to `ProviderRef[]`, so callers
// pass it straight in.
//
// Everything the "Sign in methods" card DECIDES lives here: which methods are active, which
// actions to offer, whether a chosen Google identity is allowed to be linked, whether a refused
// link has to be rolled back, how to re-confirm a stale login, and which translated message a
// Firebase error maps to. The UI renders these verdicts; it never re-derives them, so the guard
// and the message can't drift apart.

/** Minimal shape of one entry of Firebase's `user.providerData`. */
export interface ProviderRef {
  providerId: string;
  email?: string | null;
}

export const PASSWORD_PROVIDER_ID = 'password';
export const GOOGLE_PROVIDER_ID = 'google.com';

type Providers = readonly ProviderRef[] | null | undefined;

function list(providers: Providers): readonly ProviderRef[] {
  return Array.isArray(providers) ? providers : [];
}

function has(providers: Providers, providerId: string): boolean {
  return list(providers).some((p) => p?.providerId === providerId);
}

// ── Which methods are active ─────────────────────────────────────────────────

export interface ActiveSignInMethods {
  password: boolean;
  google: boolean;
}

/** The sign-in methods currently attached to the account. Unknown provider ids are ignored. */
export function activeSignInMethods(providers: Providers): ActiveSignInMethods {
  return {
    password: has(providers, PASSWORD_PROVIDER_ID),
    google: has(providers, GOOGLE_PROVIDER_ID),
  };
}

// ── Which actions to offer ───────────────────────────────────────────────────

export interface SignInActions {
  canAddPassword: boolean;
  canLinkGoogle: boolean;
}

/**
 * Offer only what actually applies: a method can be ADDED when it isn't there yet.
 * Nothing here can ever remove a method, so the "last remaining sign-in method" lockout
 * is unreachable by construction (see the change's Non-goals).
 */
export function availableSignInActions(providers: Providers): SignInActions {
  const active = activeSignInMethods(providers);
  return {
    canAddPassword: !active.password,
    canLinkGoogle: !active.google,
  };
}

// ── The same-email guard ─────────────────────────────────────────────────────

/** Trim + lowercase; null/undefined/blank all collapse to ''. */
export function normalizeEmail(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export type GoogleLinkRefusal = 'mismatch' | 'missing-account-email' | 'missing-google-email';

export type GoogleLinkVerdict =
  | { ok: true; email: string }
  | { ok: false; reason: GoogleLinkRefusal; accountEmail: string; googleEmail: string };

/**
 * The hard requirement: a Google identity may only be linked to the signed-in account when it
 * carries the SAME email address. Case and surrounding whitespace are ignored; a missing address
 * on either side is a refusal, never a silent pass. The refusal carries BOTH addresses so the
 * message can name them ("that Google account is a@x, sign in to Google as b@y").
 */
export function checkGoogleLinkEmail(
  accountEmail: string | null | undefined,
  googleEmail: string | null | undefined,
): GoogleLinkVerdict {
  const account = normalizeEmail(accountEmail);
  const google = normalizeEmail(googleEmail);
  if (!account) return { ok: false, reason: 'missing-account-email', accountEmail: account, googleEmail: google };
  if (!google) return { ok: false, reason: 'missing-google-email', accountEmail: account, googleEmail: google };
  if (account !== google) return { ok: false, reason: 'mismatch', accountEmail: account, googleEmail: google };
  return { ok: true, email: account };
}

/**
 * The email of the Google identity that was just linked. `linkWithPopup` resolves AFTER the link
 * is applied, so this reads the result: the google.com entry of the updated provider data first,
 * falling back to the additional-user-info profile email. '' when neither source has one, which
 * checkGoogleLinkEmail then refuses.
 */
export function googleEmailFromLink(
  providersAfterLink: Providers,
  profileEmail?: string | null,
): string {
  const entry = list(providersAfterLink).find((p) => p?.providerId === GOOGLE_PROVIDER_ID);
  return normalizeEmail(entry?.email) || normalizeEmail(profileEmail);
}

/**
 * Whether a refused link has to be undone. Only true when the link was actually applied by this
 * attempt: if the account already carried a google.com provider beforehand, that provider is not
 * ours to remove.
 */
export function needsRollback(hadGoogleBefore: boolean, verdict: GoogleLinkVerdict): boolean {
  return !verdict.ok && !hadGoogleBefore;
}

// ── Re-confirming a stale login ──────────────────────────────────────────────

export type ReauthMethod = 'password' | 'google' | 'none';

/**
 * How to satisfy `auth/requires-recent-login` with a method the account actually has.
 * A password is preferred when present: it re-confirms inline, without a popup.
 */
export function reauthMethod(providers: Providers): ReauthMethod {
  const active = activeSignInMethods(providers);
  if (active.password) return 'password';
  if (active.google) return 'google';
  return 'none';
}

// ── Firebase error code → translated message key ─────────────────────────────

export type AuthErrorKey =
  | 'credentialAlreadyInUse'
  | 'emailAlreadyInUse'
  | 'providerAlreadyLinked'
  | 'popupCancelled'
  | 'popupBlocked'
  | 'requiresRecentLogin'
  | 'weakPassword'
  | 'network'
  | 'wrongPassword'
  | 'tooManyRequests'
  | 'generic';

// Ordered: the first matching fragment wins, so `credential-already-in-use` is tested before the
// looser `invalid-credential`.
const ERROR_CODE_MAP: ReadonlyArray<readonly [string, AuthErrorKey]> = [
  ['credential-already-in-use', 'credentialAlreadyInUse'],
  ['email-already-in-use', 'emailAlreadyInUse'],
  ['provider-already-linked', 'providerAlreadyLinked'],
  ['popup-closed-by-user', 'popupCancelled'],
  ['cancelled-popup-request', 'popupCancelled'],
  ['user-cancelled', 'popupCancelled'],
  ['popup-blocked', 'popupBlocked'],
  ['requires-recent-login', 'requiresRecentLogin'],
  ['weak-password', 'weakPassword'],
  ['network-request-failed', 'network'],
  ['wrong-password', 'wrongPassword'],
  ['invalid-login-credentials', 'wrongPassword'],
  ['invalid-credential', 'wrongPassword'],
  ['too-many-requests', 'tooManyRequests'],
];

/**
 * Map any thrown value to a stable message key. Never throws, never echoes Firebase's own English
 * text — the caller looks the key up in i18n, so a Hebrew console stays Hebrew.
 */
export function authErrorKey(error: unknown): AuthErrorKey {
  const raw = (error as { code?: unknown } | null | undefined)?.code;
  const code = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (!code) return 'generic';
  for (const [fragment, key] of ERROR_CODE_MAP) {
    if (code.includes(fragment)) return key;
  }
  return 'generic';
}
