// creator-web render smoke — the logged-out AuthGate landing (needs no emulator: auth
// is lazy, the form renders pre-auth). Proves the console app mounts in a real browser,
// the sign-in controls are present, and the Hebrew-first UI actually renders Hebrew.
import { test, expect, assertNoCrash } from './fixtures';

test.describe('creator-web AuthGate', () => {
  test('landing renders with sign-in controls and no crash', async ({ page, pageErrors }) => {
    await page.goto('/');

    // The React tree mounted, not the crash boundary.
    await assertNoCrash(page);

    // Critical controls: email + password inputs and a Google button are the sign-in path.
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // Hebrew-first: the welcome header ("ברוך הבא") must render in Hebrew, catching the
    // recurring "English text while the app is in Hebrew" / broken-i18n-mount bug.
    await expect(page.getByText('ברוך הבא').first()).toBeVisible();

    // No uncaught exception tore the page down.
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  // Regression: "שכחת סיסמה?" appeared to do nothing because its success confirmation
  // uses dialog.alert, but DialogHost was only mounted in App.tsx (logged-in). On the
  // logged-out screen the dialog silently no-op'd. This drives the real button and
  // asserts the confirmation renders. Hermetic: we fulfill the reset request ourselves
  // so it needs no emulator.
  test('forgot-password shows a visible confirmation (dialog host on logged-out screen)', async ({ page }) => {
    // Make the Firebase password-reset request (accounts:sendOobCode) succeed offline.
    await page.route('**/accounts:sendOobCode**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"email":"creator@rushpoint.dev","kind":"identitytoolkit#GetOobConfirmationCodeResponse"}' }),
    );

    await page.goto('/');
    await page.locator('input[type="email"]').fill('creator@rushpoint.dev');
    await page.getByRole('button', { name: 'שכחת סיסמה?' }).click();

    // The resetSent confirmation must become visible (RED before DialogHost is mounted
    // on the auth screen, GREEN after).
    await expect(page.getByText(/שלחנו קישור לאיפוס סיסמה/)).toBeVisible();
  });
});
