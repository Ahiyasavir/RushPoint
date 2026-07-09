## Context

In DEV, `auth` is wired to the Auth Emulator, so a real Google popup can't sign into it
directly. The current `signInWithGoogle()` opens a REAL Google popup on a separate
non-emulated `googleAuth`, then "bridges" the identity into the emulated `auth` by signing in
with a **synthetic password** (`__google_proxy_<uid>`). This breaks when a password account
already exists for that email: `signInWithEmailAndPassword` fails (wrong password) and the
fallback `createUserWithEmailAndPassword` fails (`email-already-in-use`), so the whole call
throws.

## Goals / Non-Goals

**Goals:**
- Google sign-in resolves to the same single account as an existing email+password account.
- Keep the real-Google chooser (already working over the authorized ngrok tunnel).

**Non-Goals:**
- Production project "same email" linking setting (documented, not toggled here).
- Any change to email/password sign-up/in/reset, or to the production `signInWithPopup` path.

## Decisions

**Decision: Bridge via `signInWithCredential(auth, GoogleAuthProvider.credential(claims))`.**
The Auth Emulator's `signInWithIdp` links a verified-email federated sign-in onto an existing
account and returns the same uid — empirically verified: a probe created a password account,
then `signInWithIdp` for the same email returned the identical `localId` with no
`needConfirmation`/error. Passing the Google identity as credential claims replaces the
fragile synthetic-password dance and unifies the account.
- *Alternative — keep synthetic password but sign in with the user's real password:* impossible,
  the bridge doesn't have it.
- *Alternative — catch `email-already-in-use` and link manually:* more code, needs re-auth we
  don't have; the credential path links natively.

**Decision: Extract `buildEmulatorGoogleClaims(identity)` (pure) for testability.**
The bridge's SDK/emulator calls aren't unit-testable, but the claims payload is. A pure helper
returns `{ sub, email, email_verified, name?, picture? }`; unit-tested in the pure lane, and an
emulator integration assertion locks the link-by-email behavior the fix relies on.

## Risks / Trade-offs

- **Emulator vs production linking differ** → Mitigated: production unification is a project
  console setting (documented in Non-goals); the code path is correct for the emulator that
  playtest uses, and the production `signInWithPopup` path is untouched.
- **Fake-token claims shape** → Mitigated: matches the emulator's `id_token=<JSON>` contract
  verified by the probe; covered by the pure claims test.

## Migration Plan

Additive/behavioral code change in one function + one helper. Rollback = revert `firebase.ts`.
No data migration. Existing synthetic-password `__google_proxy_*` users (if any) are harmless;
future Google sign-ins resolve by email to the real account.
