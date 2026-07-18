## Context

`dialog.tsx` is a module-singleton dialog system: `dialog.alert/confirm/prompt` call
`push()`, which forwards to a module-level `listener` set by whichever `<DialogHost/>` is
mounted. If no host is mounted, `push()` deliberately resolves to a default so callers
never hang — meaning **the call silently no-ops with no UI**. `toast.tsx` works the same
way via `<ToastHost/>`.

Today `<DialogHost/>` and `<ToastHost/>` are mounted only in `App.tsx` (rendered by
`AuthGate` **after** sign-in). But `AuthGate` invokes `dialog.alert` from the logged-out
screen in two places:
- `forgotPassword()` → `dialog.alert(t.auth.resetSent(email))` (AuthGate.tsx:167)
- the referral-bonus effect → `dialog.alert('🎁 ' + t.common.referralBonusApplied)` (AuthGate.tsx:65)

Both no-op because no host is mounted pre-signin. Confirmed live: `accounts:sendOobCode`
returns 200, yet nothing appears → the button "does nothing".

## Goals / Non-Goals

**Goals:**
- Make `dialog.*`/`toast.*` render on the logged-out creator auth screen.
- Give the forgot-password action a visible success confirmation.
- Lock it in with a hermetic (no-emulator) Playwright RED→GREEN test.

**Non-Goals:**
- Changing the reset flow, `sendPasswordResetEmail`, i18n strings, or the dialog/toast
  implementations.
- Real reset-email delivery under the emulator (it logs the OOB link; production sends a
  real email). Out of scope — this fixes on-screen feedback only.

## Decisions

**Decision: Mount `<DialogHost/>` + `<ToastHost/>` on the logged-out screen (not an inline notice).**
The bug is a whole *class* — every `dialog.*`/`toast.*` call before sign-in silently fails,
not just forgot-password. Mounting the hosts fixes forgot-password AND the referral-bonus
alert AND any future pre-signin dialog, with a smaller, lower-risk diff than reworking each
call site to bespoke inline state.
- *Alternative — inline success `notice` state in `forgotPassword`:* rejected. It fixes
  only one call site, leaves the referral alert broken, and duplicates UI the dialog system
  already provides.
- *Placement:* mount the hosts in `AuthGate`'s logged-out render path (the `LoginScreen`/
  landing branch), so exactly one host set is live at a time — the logged-out branch renders
  the auth screen, the logged-in branch renders `App` (which keeps its own hosts). They never
  overlap, so the module-singleton `listener` is never double-owned.

**Decision: TDD via the existing hermetic Playwright lane (`e2e-ui/creator.spec.ts`).**
The repo has no component-test runner; `creator.spec.ts` already drives the logged-out
AuthGate with no emulator. The new test intercepts `**/accounts:sendOobCode**` and fulfills
200, so the success path fires deterministically offline. It asserts the `resetSent`
confirmation text is visible: fails now (no host) → passes after mounting the host.

## Risks / Trade-offs

- **Double host / listener conflict** → Mitigated: logged-out and logged-in branches are
  mutually exclusive renders, so only one host set is ever mounted. Verified by structure
  (AuthGate returns `<LoginScreen/>` OR `children`).
- **Playwright text-locator brittleness** (Hebrew, RTL) → Mitigated: assert on a stable
  substring of `resetSent` ("שלחנו קישור לאיפוס סיסמה") and target the forgot-password
  button by its accessible name via a role/text locator, per the repo's known locator
  gotchas.
- **i18n gate** → No new strings added (reuses `resetSent`), but a UI file changes, so run
  `npm run i18n:check`.

## Migration Plan

Pure additive UI change; no data or API migration. Rollback = revert the two edits.
