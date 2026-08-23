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
    // It's a real <label>, not a placeholder — a placeholder shreds Hebrew text
    // under this field's dir="ltr" tracking-[0.5em] styling (see i18n.ts join.codeLabel).
    await expect(page.getByLabel('הקוד שלכם')).toBeVisible();
    // Hebrew-first subtitle renders (broken-i18n-mount guard).
    await expect(page.getByText(/קוד הגישה/)).toBeVisible();
    // The staff entry point is present. Renamed from "אני צוות" — that read as
    // "we are a team" and sent whole groups down the staff path (see i18n.ts join.staff).
    await expect(page.getByText('כניסת מארגנים')).toBeVisible();

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
