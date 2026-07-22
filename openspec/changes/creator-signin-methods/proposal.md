## Why

A RushPoint creator's account is permanently shaped by whichever button they happened to click on
the landing page. `hasPasswordProvider()` (`apps/creator-web/src/services/firebase.ts:206-208`) is
read once in `SettingsPage.tsx:31` and used as a binary switch: a Google creator is shown
`passwordGoogleNote` ("You signed in with Google, so there is no password to manage here.",
`i18n.ts:1136`) and `emailGoogleNote` (`i18n.ts:1124`) and is given **no** way to ever obtain a
password; an email+password creator is shown a password form and is given **no** way to ever get
one-tap Google sign-in. Settings never states which methods are actually active, it only implies it
by which form is hidden.

That is a real support and lockout surface for the launch audience. A creator who signed up with
Google on a laptop and later opens RushPoint on a device where they are signed into a different
Google profile has no second door. A creator who signed up with email and forgot which of their
addresses they used cannot fall back to the Google button, because pressing it in production creates
or resolves an account by email and they cannot tell from the UI whether that will be *their*
account.

Half of this problem was already solved, but only implicitly and only at sign-in time:
`unify-email-google-login` made `signInWithGoogle()` bridge through
`signInWithCredential(auth, GoogleAuthProvider.credential(claims))`
(`firebase.ts:166-175`) so that in the emulator a Google sign-in **silently links** onto an existing
password account with the same email. That is an accident-recovery mechanism, invisible to the
creator, unavailable in production (where it is a Firebase Console project setting), and it never
runs in the other direction. This change makes the same idea **explicit, deliberate, and creator
initiated**, from Settings, in both environments.

## What Changes

**Settings states the truth about the account.**
- A new "Sign in methods" card lists every sign-in method currently active on the account (email and
  password, Google) with its status, replacing inference-by-hidden-form.

**A Google creator can add a password.**
- The card offers "Add a password" when, and only when, the account has no `password` provider. The
  creator sets a password once (no current password is asked for, because there is none) and
  afterwards can sign in either way. The existing Password card's change flow takes over from then
  on.

**An email creator can link Google.**
- The card offers "Link Google" when, and only when, the account has no `google.com` provider. After
  linking, the landing page's "Continue with Google" resolves to the same account.

**Linking Google is refused unless it is the same person.**
- The Google account chosen in the popup must carry the **same email address** as the signed in
  RushPoint account. A different Google account is refused with a message that names both addresses
  ("that Google account is a@x, sign in to Google as b@y"), and the RushPoint account is left exactly
  as it was: no linked provider, no changed email, no changed session.
- Comparison is case insensitive and whitespace tolerant. A missing email on either side is a refusal,
  never a silent pass.

**Firebase error codes stop reaching the creator.**
- `credential-already-in-use`, `email-already-in-use`, `provider-already-linked`,
  `popup-closed-by-user`, `popup-blocked`, `requires-recent-login`, `weak-password`,
  `network-request-failed` and wrong password each map to a specific translated sentence.
  Today `SettingsPage.tsx:19-24` falls through to `e.message.replace(/^Firebase: /, '')`, i.e. raw
  English SDK text inside a Hebrew UI.
- `requires-recent-login` is a flow, not an error message: the creator is asked to confirm who they
  are (password field, or a Google re-consent popup) and the original action is retried.

## Non-goals

- **Unlinking / removing a sign-in method is out of scope.** Nothing in this change can remove a
  provider from an account, so the "never remove the last method" lockout can not occur. The only
  removal path remains full account deletion in the danger zone
  (`SettingsPage.tsx:280-327`). If unlinking is wanted later it needs its own change, with a
  last-method guard.
- **No change to sign-in itself.** `AuthGate.tsx`'s login screen, `signInWithGoogle()`'s existing
  emulator bridge, sign-up, and password reset are untouched. This change adds an explicit
  creator-initiated path *in addition to* the implicit sign-in-time unification from
  `unify-email-google-login`; it does not replace or contradict it (see `design.md`, "Relationship to
  unify-email-google-login").
- **No change to the account's primary email.** Linking Google never rewrites `user.email`, and the
  Email card's change-email flow is untouched.
- **No new provider.** Only `password` and `google.com`. No Apple, Facebook, phone, or magic link.
- **play-web is untouched.** Participants are anonymous and have no sign-in methods to manage.
- **No new callable, no Firestore rules change, no shared type.** Firebase Auth client APIs
  (`linkWithCredential`, `linkWithPopup`, `unlink`, `reauthenticateWithCredential`,
  `reauthenticateWithPopup`) cover the whole feature on the client, against the caller's own
  identity, which the rules already permit.

## Capabilities

### New Capabilities
- `creator-signin-methods`: A creator can see which sign-in methods are active on their RushPoint
  account and add the missing one from Settings. Adding a password to a Google account and linking
  Google to a password account are both available, are offered only when they apply, and a Google
  link is accepted only when the chosen Google identity carries the same email address as the signed
  in account. A refused link leaves the account byte-for-byte unchanged. Every Firebase failure the
  flow can produce reaches the creator as a translated sentence, and a stale login is resolved by
  re-confirming identity rather than by an error.

### Modified Capabilities
<!-- None. `unify-email-google-login` is an archived change, not a spec in openspec/specs/, and its
     sign-in-time behavior is preserved verbatim. No requirement in an existing spec changes. -->

## Impact

- **Surfaces touched:** `apps/creator-web` **only**. No callable, no `functions/`, no
  `firestore.rules`, no `packages/shared`, no `play-web`.
- **Files:**
  - new `apps/creator-web/src/lib/signInMethods.ts` (all decisions, pure, no SDK import)
  - new `scripts/test-signin-methods.ts` (picked up by the `npm test` aggregator)
  - `apps/creator-web/src/services/firebase.ts` (thin SDK wrappers: add password, link Google,
    re-auth)
  - `apps/creator-web/src/pages/SettingsPage.tsx` (the new card)
  - `apps/creator-web/src/i18n.ts` (new keys in **both** dictionaries)
- **Risk:** the popup returns after Firebase has already applied the link, so a mismatched Google
  account is, for an instant, linked. The rollback and the reason a rollback (rather than a
  pre-check) is the production path are specified in `design.md` and encoded as pure, tested
  decision functions so the guard and the UI can not drift.
- **Testing:** every decision (which actions to offer, the email-match verdict, the error-code
  mapping, whether a mismatch requires rollback) is a pure function in `src/lib/` covered by
  `scripts/test-signin-methods.ts` in the existing emulator-free `npm test` lane. `npm run test:ui`
  covers render smoke. The popup itself can only be exercised by a human in a browser; that
  verification step is named explicitly in `tasks.md` and is **not** claimed as automated.
