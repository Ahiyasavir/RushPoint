## Context

`apps/creator-web` authenticates against real Firebase Auth in production and against the Auth
Emulator in every emulator build (`firebase.ts:56`, `isEmulatorBuild`). Settings today reads a single
boolean, `hasPasswordProvider()` (`firebase.ts:206-208`), and branches the Email card
(`SettingsPage.tsx:153`) and the Password card (`SettingsPage.tsx:199`) on it. Sensitive operations
already go through `reauthWithPassword()` (`firebase.ts:211-217`), which only a password account can
satisfy, so a Google account currently has no re-auth path at all.

Installed SDK is **firebase 10.14.1**. Verified present in
`node_modules/@firebase/auth/dist/auth-public.d.ts`: `linkWithCredential` (:1667), `linkWithPopup`
(:1708), `reauthenticateWithPopup` (:2792), `unlink` (:3639), `getAdditionalUserInfo` (:1270).

### Relationship to `unify-email-google-login`

That change is about **sign-in time** and it stays exactly as it is. `signInWithGoogle()`
(`firebase.ts:154-176`) opens the real Google chooser on the non-emulated `googleApp` instance and
bridges the identity into the emulated `auth` with
`signInWithCredential(auth, GoogleAuthProvider.credential(claims))`, which makes the Auth Emulator
link `google.com` onto an existing password account with the same email. That is **implicit**
unification: the creator never asked for it and never sees it, it needs the emulator (or a Console
setting in production), and it only fires in one direction (Google sign-in onto a password account).

This change is the **explicit** counterpart: the creator asks for it, from Settings, in both
directions, in both environments, with a hard same-email guard and a visible result. The two do not
overlap in code: `signInWithGoogle()` is not modified, and the new functions are only reachable from
Settings while already signed in. They agree on the invariant (**one email address, one RushPoint
account**); this change is the one that states it to the creator and enforces it in the open.

## Goals / Non-Goals

**Goals**
- Settings truthfully reports which sign-in methods the account has.
- Add password to a Google account; link Google to a password account.
- A Google link is refused unless the chosen Google identity's email equals the account email, and a
  refusal leaves the account exactly as it was.
- Every Firebase error code becomes a translated sentence; `requires-recent-login` becomes a flow.

**Non-Goals**
- Unlinking a provider (see proposal Non-goals). Because nothing can be removed, no
  "last remaining method" lockout is reachable and no such guard is implemented. Adding unlink later
  requires that guard as its first task.
- Any change to `signInWithGoogle()`, `AuthGate.tsx`, sign-up, or password reset.
- Any callable, Firestore rule, index, env var, or shared type. **None is required**: every operation
  acts on `auth.currentUser` through client SDK APIs that Firebase authorizes against the caller's
  own ID token.

## Decisions

### Decision 1: All decisions live in a pure module, `apps/creator-web/src/lib/signInMethods.ts`

The module imports **nothing** from `firebase/*` (a `ProviderRef = { providerId: string; email?: string | null }`
structural type is enough, and `User['providerData']` is assignable to `ProviderRef[]`). That keeps
it runnable under `tsx` in the node lane with no DOM, no Vite env, and no SDK, exactly like
`services/authClaims.ts` does for `unify-email-google-login`.

Exports:
- `SIGN_IN_PROVIDERS`, `PASSWORD_PROVIDER_ID = 'password'`, `GOOGLE_PROVIDER_ID = 'google.com'`
- `activeSignInMethods(providers): { password: boolean; google: boolean }`
- `availableSignInActions(providers): { canAddPassword: boolean; canLinkGoogle: boolean }`
- `normalizeEmail(value): string` (trim + lowercase, `''` for null/undefined)
- `checkGoogleLinkEmail(accountEmail, googleEmail): GoogleLinkVerdict`
- `googleEmailFromLink(providersAfterLink, additionalProfileEmail?): string`
- `needsRollback(hadGoogleBefore, verdict): boolean`
- `authErrorKey(error): AuthErrorKey`
- `reauthMethod(providers): 'password' | 'google' | 'none'`

`GoogleLinkVerdict` is `{ ok: true }` or
`{ ok: false; reason: 'mismatch' | 'missing-account-email' | 'missing-google-email'; accountEmail; googleEmail }`.
The UI renders the reason; the guard decides it. They cannot drift because there is one function.

### Decision 2: The mismatch guard is **post-link validate plus unlink rollback** in production, and **pre-validate** in emulator builds

This is the load-bearing decision, so both halves are stated.

`linkWithPopup(user, provider)` resolves **after** Firebase has already applied the link. There is no
API to learn which Google account the user will choose before choosing it, so in production a
pre-check is impossible. The chosen path is therefore:

1. Steer first: `provider.setCustomParameters({ prompt: 'select_account', login_hint: <accountEmail> })`.
   `login_hint` makes Google preselect the right account, so the mismatch case becomes rare rather
   than routine. It is a hint only and is never trusted as the guard.
2. `linkWithPopup(auth.currentUser, provider)`.
3. Read the linked Google email from the result: `googleEmailFromLink(result.user.providerData, getAdditionalUserInfo(result)?.profile?.email)`.
4. `checkGoogleLinkEmail(accountEmail, googleEmail)`.
5. On `ok: false`, and only if the account did **not** already have `google.com` before the attempt
   (`needsRollback`), call `unlink(user, 'google.com')`, then `await user.reload()`, then report the
   refusal. On `ok: true`, `await user.reload()` and report success.

Why rollback rather than a secondary-app pre-check: the alternative is to open the popup on the
non-emulated `googleApp` instance (as `signInWithGoogle()` does), read the identity, and only then
call `linkWithCredential` on the primary user, which would need no rollback. It was rejected for
production because it depends on an OAuth credential minted through one Firebase app instance being
accepted by `linkWithCredential` on another, which cannot be verified here without a browser and a
real Google project, and a wrong guess there breaks the feature outright. `linkWithPopup` + `unlink`
uses only first-class, documented APIs.

Why the account is genuinely unchanged after a rollback: `unlink` removes the provider entry;
linking a federated provider to an account that **already has** an email does not rewrite
`user.email` (the account keeps its own address), and neither `linkWithPopup` nor `unlink` changes
`auth.currentUser.uid` or issues a new session. The state that a mismatch can transiently create is
exactly one extra `providerData` entry, and that is exactly what the rollback removes.

Emulator builds take the pre-validate path instead, because they must: in an emulator build `auth` is
the emulated instance and `linkWithPopup` would show the emulator's fake widget rather than Google.
So the emulator path reuses the existing bridge, opening the real chooser on `googleAuth`, and
therefore **knows the identity before mutating anything**: it runs `checkGoogleLinkEmail` first and
only then calls `linkWithCredential(user, GoogleAuthProvider.credential(claims))` with
`buildEmulatorGoogleClaims`. In that path `needsRollback` is never reached, by construction.

`needsRollback(hadGoogleBefore, verdict)` is pure and tested for all four combinations, including the
case where the account already had Google linked (never unlink a pre-existing provider).

### Decision 3: Adding a password uses `linkWithCredential`, not `updatePassword`

`updatePassword` requires an existing password provider, so on a Google-only account it fails. The
correct call is `linkWithCredential(user, EmailAuthProvider.credential(user.email, newPassword))`.
The account email is used as the credential email (the creator is not allowed to invent a different
one here; changing the email address stays in the Email card). Length and confirmation are validated
locally before any SDK call, reusing the existing thresholds (8 chars, `passwordTooShort` /
`passwordMismatch` at `i18n.ts:283-284`).

### Decision 4: `requires-recent-login` is a flow with a bounded, single retry

`reauthMethod(providers)` decides how to re-confirm:
- `'password'` when the account has a password provider: the card reveals an inline current-password
  field (same shape as the Email card at `SettingsPage.tsx:158-160`), then
  `reauthenticateWithCredential` and **one** retry of the original operation.
- `'google'` when the account is Google only: `reauthenticateWithPopup(user, googleProvider)` in
  production, and the existing emulator bridge equivalent in emulator builds, then one retry.
- `'none'` is unreachable for a signed in creator; it maps to the generic translated message.

The retry is attempted once. A second `requires-recent-login` reports the translated
`requires-recent-login` message rather than looping.

### Decision 5: Error mapping returns a key, not a sentence

`authErrorKey(error)` is pure and returns a member of a closed union; `SettingsPage` maps that key to
`t.settings.<key>`. Pure code stays free of the translation maps, and the test asserts the mapping
without touching React. The i18n key parity typing (`EN: typeof HE`) then guarantees both dictionaries
carry every key. `authErrorKey` reads `error.code` defensively (`unknown` in, never throws) and
matches on the code substring so both `credential-already-in-use` and
`auth/credential-already-in-use` resolve.

## Files to touch

| File | Change |
|---|---|
| `apps/creator-web/src/lib/signInMethods.ts` | **new** — every decision above, pure, no SDK import |
| `scripts/test-signin-methods.ts` | **new** — RED first; auto-discovered by `scripts/run-unit-tests.mjs` |
| `apps/creator-web/src/services/firebase.ts` | **new exports** `listSignInProviders`, `addPasswordToAccount`, `linkGoogleToAccount`, `reauthWithGoogle`, `reauthWithCurrentPassword`; export the existing `reauthWithPassword` logic for reuse. `signInWithGoogle()` unchanged. |
| `apps/creator-web/src/pages/SettingsPage.tsx` | **new** `SignInMethodsCard`, mounted between the Password card and the Data card; existing cards keep working, but now read the provider list through `activeSignInMethods` instead of the standalone boolean |
| `apps/creator-web/src/i18n.ts` | new keys under `settings` in **both** `HE` and `EN` |

## Test strategy

**Pure lane (the TDD driver), `scripts/test-signin-methods.ts`, no emulator:**
- `activeSignInMethods` / `availableSignInActions` for `[]`, `['password']`, `['google.com']`,
  `['password','google.com']`, reversed order, and with an unknown provider id mixed in.
- `normalizeEmail` for padding, case, `null`, `undefined`, `''`.
- `checkGoogleLinkEmail`: exact match; case-different match; whitespace-padded match; different
  address (verdict carries **both** addresses so the message can name them); empty/missing Google
  email; empty/missing account email. Missing must be a refusal, not a pass.
- `googleEmailFromLink`: prefers the `google.com` entry in provider data, falls back to the
  additional-user-info profile email, returns `''` when neither exists.
- `needsRollback`: all four combinations of `hadGoogleBefore` × verdict, asserting no rollback when
  the provider pre-existed and no rollback on success.
- `authErrorKey`: each of the twelve codes named in the spec, with and without the `auth/` prefix, an
  unknown code, an error with no `code`, a non-Error value, `null`.
- `reauthMethod` for each provider set.

**i18n:** `npm run i18n:check` (PART A is the hard gate) and `npm run i18n:check:strict` must both stay
clean, and the strict run must show **zero** new hardcoded-string findings against the pre-change
baseline (which is clean).

**Render smoke:** `npm run test:ui` (Playwright) must stay green.

**Not automatable here, and not claimed as verified:** the popup itself. `linkWithPopup`,
`reauthenticateWithPopup`, the real Google chooser, and the actual `unlink` rollback need a browser
with a real Google session (or the Auth Emulator, which this change is forbidden to start). The
mismatch rollback path is therefore **specified and unit-tested at the decision layer, but its SDK
round trip is unverified**; `tasks.md` carries an explicit human verification task and the final
report must say so.

## Risks / Trade-offs

- **Transient linked state on mismatch.** Between step 2 and step 5 a wrong Google account is briefly
  linked. Mitigated by `login_hint` making it rare, by an immediate `unlink`, and by a distinct
  translated message if the `unlink` itself fails so the creator is never told "done" over a dirty
  state. Accepted because the alternative depends on unverifiable cross-app credential behavior.
- **Emulator and production take different code paths.** Same as the existing `signInWithGoogle()`
  split, and the shared decision functions are identical in both, so the guard cannot differ.
- **`credential-already-in-use` is a genuine dead end.** If the Google identity belongs to another
  RushPoint account, this change cannot merge them; it says so plainly. Account merging is out of
  scope.

## Migration Plan

Purely additive on the client. No data migration, no rules change, no deploy coupling. Rollback is
reverting the five files; accounts that already gained a second provider keep it and simply see the
old Settings again.
