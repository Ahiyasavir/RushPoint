## Why

If a creator registers with email+password and later signs in with Google using the same
email, sign-in fails. Verified root cause: the DEV Google bridge fabricates a synthetic
password user (`__google_proxy_<uid>`) — for an already-registered email it can neither sign
in (wrong password) nor create (email-already-in-use), so the whole Google sign-in throws.
A user expects one identity per email: registering with a password should still let them
sign in with Google to the **same** account.

## What Changes

- Replace the synthetic-password bridge in `signInWithGoogle()` (DEV) with a real Google
  **credential** sign-in: `signInWithCredential(auth, GoogleAuthProvider.credential(<claims>))`.
  The Auth emulator links the `google.com` provider onto the existing account (same `localId`),
  or creates the account if none exists — one unified account per email.
- Verified empirically against the running emulator: `signInWithIdp` for an email that already
  has a password account returns **the same uid** (auto-link, no `needConfirmation`, no error).
- Extract a tiny pure helper `buildEmulatorGoogleClaims(identity)` that builds the token claims,
  so the bridge payload is unit-tested.

Surfaces touched: **creator-web only** (`services/firebase.ts`) + one shared/pure helper test.
No callable, no rules, no play-web. Production path (`signInWithPopup(auth, …)` on real
Firebase) is unchanged — see Non-goals for the console setting it depends on.

## Capabilities

### New Capabilities
- `email-google-account-unification`: Registering an email+password account and later signing
  in with Google using the same email SHALL resolve to the same single account.

### Modified Capabilities
<!-- none — no existing spec covers creator email/Google account unification -->

## Impact

- `apps/creator-web/src/services/firebase.ts` — `signInWithGoogle()` DEV bridge rewritten to
  `signInWithCredential`; add `signInWithCredential` import; add `buildEmulatorGoogleClaims`.
- `scripts/test-emulator-google-link.ts` (pure/int) — claims-builder unit test + an emulator
  integration assertion that Google-idp links to an existing password account (same uid).
- Gates: `npm test`, `npm run typecheck`, `npm run lint`, `npm run creator:build`,
  `npm run i18n:check`.

## Non-goals

- **Production project setting.** Real-Firebase unification also requires the project's
  "Link accounts that use the same email" setting (Console → Authentication → Settings →
  User account linking). This change fixes the DEV/emulator bridge (what playtest uses) and
  documents the console setting; it does not toggle a remote project setting.
- No change to email/password sign-up, sign-in, or password reset.
- Google-first-then-password (setting a password on a Google account) is unchanged (use reset).
