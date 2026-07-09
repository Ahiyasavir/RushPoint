// play-web render smoke — the participant Join screen + Staff console entry. JoinScreen
// renders even before anonymous auth resolves (App.tsx: "still render JoinScreen; the
// join flow re-attempts auth"), so these smokes stay green without an emulator. They
// catch the render-crash / missing-control / broken-Hebrew-mount class on the two
// entry points every participant and staffer hits first.
import { test, expect, assertNoCrash } from './fixtures';

test.describe('play-web Join', () => {
  test('join screen renders with code entry and no crash', async ({ page, pageErrors }) => {
    await page.goto('/');
    await assertNoCrash(page);

    // The access-code field is the one control every participant must see.
    await expect(page.getByPlaceholder('הקוד שלכם')).toBeVisible();
    // Hebrew-first subtitle renders (broken-i18n-mount guard).
    await expect(page.getByText(/קוד הגישה/)).toBeVisible();
    // The staff entry point is present.
    await expect(page.getByText('אני צוות')).toBeVisible();

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('staff mode (?staff) renders the staff sign-in without crash', async ({ page, pageErrors }) => {
    await page.goto('/?staff');
    await assertNoCrash(page);

    // Staff sign-in copy ("התחברו עם הקוד שקיבלתם מהמארגן") + a PIN field.
    await expect(page.getByText(/קוד שקיבלתם מהמארגן/)).toBeVisible();

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
