## 1. RED — failing tests

- [x] 1.1 Add `scripts/test-emulator-google-link.ts`: (a) pure test of `buildEmulatorGoogleClaims` (sub/email/email_verified always present, name/picture omitted when absent); (b) emulator integration test — via the Auth emulator REST API, create a password account for a fresh email, then `accounts:signInWithIdp` with a google.com token for the same email, and assert the returned `localId` equals the password account's uid (link, not duplicate/conflict). Skip the integration half gracefully if the emulator is not reachable.
- [x] 1.2 Run `npx tsx scripts/test-emulator-google-link.ts` and confirm RED — first run failed (missing `buildEmulatorGoogleClaims` module / transform error) before the helper existed.

## 2. GREEN — implement the bridge fix

- [x] 2.1 In `apps/creator-web/src/services/firebase.ts`, add `signInWithCredential` to the `firebase/auth` imports; `buildEmulatorGoogleClaims` lives in a dependency-free `services/authClaims.ts` (importable by the node test without the Firebase SDK).
- [x] 2.2 Rewrite the `signInWithGoogle()` DEV bridge to `signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify(buildEmulatorGoogleClaims(user))))`, removing the synthetic-password sign-in/create fallback.
- [x] 2.3 Re-run the test; pure + integration assertions PASS (12/12, exit 0).

## 3. REFACTOR & gates

- [x] 3.1 No now-unused imports in `firebase.ts` (createUserWithEmailAndPassword/signInWithEmailAndPassword/updateProfile still used by signUpWithEmail/signInWithEmail) — confirmed by clean typecheck + lint.
- [x] 3.2 Gates green via `npm run verify` (typecheck·lint·test·creator+play builds·i18n, exit 0); aggregator runs `test-emulator-google-link.ts` → 12/12.
- [x] 3.3 Behavior proven by the emulator integration test (Google-idp for an existing password email returns the SAME uid); the real-Google popup path itself was already verified live over the ngrok tunnel earlier this session. Manual live re-check available anytime.
