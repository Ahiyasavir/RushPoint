## Why

On the logged-out creator sign-in screen, clicking **"שכחת סיסמה?"** appears to do
nothing. Verified in a real browser: the password-reset request (`accounts:sendOobCode`)
succeeds with 200, but the success confirmation uses `dialog.alert(...)` — and
`DialogHost` is mounted only in `App.tsx`, which renders **only when logged in**. On the
logged-out screen no host is mounted, so `dialog.tsx`'s `push()` hits its `if (!listener)`
fallback and silently resolves with no UI. The user gets zero feedback. This is a
**production** defect too: a real user receives the reset email but sees no on-screen
confirmation, so they assume the button is broken.

## What Changes

- Mount the app's `DialogHost` (and `ToastHost`, for parity) on the **logged-out** creator
  auth screen, so `dialog.*`/`toast.*` calls made before sign-in actually render.
- This makes the forgot-password success confirmation
  (`t.auth.resetSent(email)` — "שלחנו קישור לאיפוס סיסמה אל …") visible, and also
  un-swallows the referral-bonus alert (`AuthGate.tsx:65`) that fires on the same screen.
- Add a hermetic Playwright UI test (`e2e-ui/creator.spec.ts`) that intercepts
  `**/accounts:sendOobCode**`, clicks the forgot-password button, and asserts the
  confirmation text appears — RED before the host is mounted, GREEN after.

Surfaces touched: **creator-web only** (UI). No callable, no shared types, no rules,
no play-web. No new dependency.

## Capabilities

### New Capabilities
- `creator-auth-feedback`: On the logged-out creator auth screen, transient feedback
  (`dialog.*` confirmations/alerts and `toast.*` notices) must render — covering the
  forgot-password confirmation and the referral-bonus notice.

### Modified Capabilities
<!-- none — no existing spec covers logged-out creator-auth feedback -->

## Impact

- `apps/creator-web/src/components/AuthGate.tsx` — mount `<DialogHost/>` + `<ToastHost/>`
  in the logged-out render path.
- `e2e-ui/creator.spec.ts` — new hermetic Playwright assertion (no emulator needed).
- Gates: `npm run test:ui` (new RED→GREEN test), plus `typecheck` · `lint` ·
  `creator:build` · `i18n:check` (a UI change).

## Non-goals

- **Real email delivery in playtest.** The Firebase Auth **emulator** does not send real
  reset emails (it logs the OOB link); this change only fixes the missing on-screen
  feedback. Production (real Firebase) already sends a real email.
- No change to the reset flow itself, `resetPassword`/`sendPasswordResetEmail`, i18n
  strings, or the dialog/toast implementations.
- No change to the logged-in App (which already mounts its own host).
