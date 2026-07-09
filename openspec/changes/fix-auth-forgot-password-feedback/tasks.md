## 1. RED — failing UI test

- [x] 1.1 In `e2e-ui/creator.spec.ts`, add a test: on the logged-out creator screen, `page.route('**/accounts:sendOobCode**', …)` fulfilling `{ status: 200, body: '{"email":"creator@rushpoint.dev"}' }`; fill `input[type="email"]` with `creator@rushpoint.dev`; click the button named `שכחת סיסמה?`; then `await expect(page.getByText(/שלחנו קישור לאיפוס סיסמה/)).toBeVisible()`.
- [x] 1.2 Run `npm run test:ui -- --project=creator` and confirm the new test FAILS (no confirmation renders — the dialog no-ops without a host). Confirms the bug is real and the test encodes it. ✓ RED: "element(s) not found".

## 2. GREEN — mount the hosts on the logged-out screen

- [x] 2.1 In `apps/creator-web/src/components/AuthGate.tsx`, import `DialogHost` (from `./dialog`) and `ToastHost` (from `./toast`).
- [x] 2.2 Render `<DialogHost/>` and `<ToastHost/>` in the logged-out render path (the `LoginScreen`/`Landing` branch) so exactly one host set is mounted while signed out.
- [x] 2.3 Re-run `npm run test:ui -- --project=creator`; the new test now PASSES and the existing landing smoke stays green. ✓ GREEN: 2 passed.

## 3. REFACTOR & gates

- [ ] 3.1 Sanity-verify no double-host regression when signed in (logged-in still renders `App`'s own hosts; logged-out renders AuthGate's) — by code structure review.
- [ ] 3.2 Run the required gates: `npm run typecheck`, `npm run lint`, `npm run creator:build`, `npm run i18n:check` — all green.
- [ ] 3.3 Manually verify in the running playtest browser: enter an email, click "שכחת סיסמה?", confirm the "שלחנו קישור לאיפוס סיסמה אל …" confirmation now appears.
