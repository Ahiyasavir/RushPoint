## 1. RED — encode every decision as a failing pure test

- [x] 1.1 Write `scripts/test-signin-methods.ts` importing from the not-yet-existing
  `apps/creator-web/src/lib/signInMethods.ts`, covering: `activeSignInMethods` /
  `availableSignInActions` (empty, password-only, google-only, both, reversed order, unknown provider
  id mixed in); `normalizeEmail` (padding, case, `null`, `undefined`, `''`); `checkGoogleLinkEmail`
  (exact, case-different, whitespace-padded, different address carrying **both** addresses in the
  verdict, missing/empty Google email, missing/empty account email); `googleEmailFromLink`
  (provider-data entry preferred, profile-email fallback, `''` when neither); `needsRollback` (all
  four `hadGoogleBefore` × verdict combinations); `authErrorKey` (the twelve spec'd codes, with and
  without the `auth/` prefix, unknown code, error with no code, non-Error value, `null`);
  `reauthMethod` per provider set.
- [x] 1.2 Run `npx tsx scripts/test-signin-methods.ts` and confirm it fails **for the right reason**
  (module not found / exports missing), not on a typo in the test.

## 2. GREEN — the pure decision module

- [x] 2.1 Create `apps/creator-web/src/lib/signInMethods.ts` with the minimum implementation to
  satisfy 1.1. No import from `firebase/*`; providers typed structurally as
  `{ providerId: string; email?: string | null }`.
- [x] 2.2 Run `npx tsx scripts/test-signin-methods.ts` and confirm every assertion passes.
- [x] 2.3 Run `npm test` and confirm the aggregator discovered the new file and the whole pure lane
  is green.

## 3. Translated copy (both dictionaries, before any component reads it)

- [x] 3.1 Add the new `settings` keys to **both** `HE` and `EN` in `apps/creator-web/src/i18n.ts`:
  card title and description; per-method labels and active/inactive status; "add password" and
  "link Google" actions with their busy and success states; the same-email requirement note; the
  mismatch message taking both addresses; the rollback-failed message; the re-auth prompt; and one
  message per `AuthErrorKey`. Hebrew must be real Hebrew, English real English, and no copy may use
  an em-dash, en-dash, or spaced hyphen as a separator (INSTRUCTIONS.md §3.C).
- [x] 3.2 Run `npm run i18n:check` and confirm PART A is clean.

## 4. GREEN — thin SDK wrappers

- [x] 4.1 In `apps/creator-web/src/services/firebase.ts` add `listSignInProviders()`,
  `addPasswordToAccount(newPassword)` (`linkWithCredential` + `EmailAuthProvider.credential(user.email, …)`),
  `reauthWithGoogle()`, and `reauthWithCurrentPassword(pw)`. Leave `signInWithGoogle()` untouched.
- [x] 4.2 Add `linkGoogleToAccount()` implementing Decision 2: emulator build pre-validates through
  the existing `googleAuth` bridge before `linkWithCredential`; production uses
  `linkWithPopup` with `login_hint`, then `googleEmailFromLink` + `checkGoogleLinkEmail`, then
  `unlink` when `needsRollback` is true, then `user.reload()`. Every verdict and error decision is
  delegated to `lib/signInMethods.ts`; this file contains no policy of its own.
- [x] 4.3 Run `npm run typecheck` and confirm it passes.

## 5. GREEN — the Settings card

- [x] 5.1 Add `SignInMethodsCard` to `apps/creator-web/src/pages/SettingsPage.tsx`, mounted between
  the Password card and the Data card. It renders the method list from `activeSignInMethods`, offers
  only the actions from `availableSignInActions`, and reads every string from `t.settings.*`.
  Tailwind: static class strings only, logical `ms-`/`text-start` spacing.
- [x] 5.2 Wire the `requires-recent-login` flow: on that key, reveal the inline current-password
  field (`reauthMethod === 'password'`) or run the Google re-auth popup (`'google'`), then retry the
  original operation exactly once.
- [x] 5.3 Point the existing Email and Password cards at `activeSignInMethods` so all four cards agree
  on one source of truth, and refresh the provider list after a successful link so the card updates
  without a reload.
- [x] 5.4 Run `npm run lint` and confirm 0 errors.

## 6. REFACTOR

- [x] 6.1 Fold the legacy `hasPasswordProvider()` onto `activeSignInMethods` (or remove it if it has
  no remaining caller) so there is exactly one provider-inspection path in the app.
- [x] 6.2 Replace `SettingsPage.tsx`'s local `authErr()` fallthrough to raw
  `e.message.replace(/^Firebase: /, '')` with `authErrorKey`, so no card can leak Firebase English
  into the Hebrew UI.
- [x] 6.3 Re-run `npx tsx scripts/test-signin-methods.ts` and confirm the refactor kept it green.

## 7. Gates

- [ ] 7.1 Run and record verbatim: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run i18n:check`, `npm run i18n:check:strict`, `npm run creator:build`, `npm run play:build`.
  All must be green, and `i18n:check:strict` must add **zero** new hardcoded-string findings against
  the pre-change baseline.
- [ ] 7.2 `npm run e2e` is **not applicable and must not be run** for this change: it needs the
  emulator, and this change adds no callable and no server behavior. Record it as not applicable
  rather than as passing.

## 8. Human verification (not automatable here)

- [ ] 8.1 In a browser, as a Google-only creator: add a password, sign out, sign in with email and
  password, confirm the same account and games.
- [ ] 8.2 In a browser, as a password creator: link Google with the **matching** account, sign out,
  sign in with one tap, confirm the same account.
- [ ] 8.3 In a browser, as a password creator: choose a **different** Google account in the popup,
  confirm the refusal names both addresses, then reload Settings and confirm Google is still listed
  as not active (the rollback held) and the session is still the same creator.
- [ ] 8.4 Confirm the whole card renders in Hebrew with the console in Hebrew, including the mismatch
  message.
