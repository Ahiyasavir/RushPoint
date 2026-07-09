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
});
