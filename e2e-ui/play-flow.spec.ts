// play-web JOIN round-trip through a real browser + the real callable API. Unlike the
// render smokes this needs a running emulator with a seeded live run, so it is GATED on
// PLAY_CODE (the seeded access code, e.g. PLAY01). Without it the test is skipped, so the
// default `npm run test:ui` stays green with no emulator; `PLAY_CODE=PLAY01 npm run test:ui`
// (with the emulator up + seeded) exercises the full anonymous-auth → getJoinInfo →
// joinRun → leave-Join path in a real browser.
import { test, expect, assertNoCrash } from './fixtures';

const CODE = process.env.PLAY_CODE;

test.describe('play-web join round-trip (seeded run)', () => {
  test.skip(!CODE, 'set PLAY_CODE to a seeded access code (needs emulator + seed)');

  test('a participant can join a live run and leave the Join screen', async ({ page, pageErrors }) => {
    test.setTimeout(60_000); // real callable round-trips (anon auth + getJoinInfo + joinRun)
    // ?code= prefills the access code (evaluated at mount, JoinScreen P9).
    await page.goto(`/?code=${CODE}`);
    await assertNoCrash(page);

    // A prefilled ?code auto-runs getJoinInfo on mount (JoinScreen useEffect), advancing
    // to the registration step. The join CTA is the reliable step-2 marker; wait for it,
    // then fill the sole name textbox (its label isn't programmatically associated, so
    // match structurally rather than by accessible name) and join.
    const joinBtn = page.getByRole('button', { name: /הצטרפו למירוץ/ });
    await expect(joinBtn).toBeVisible({ timeout: 25_000 });
    await page.getByRole('textbox').first().fill('UI Smoke Team');
    await joinBtn.click(); // joinRun callable

    // Joined: the access-code entry is gone (we advanced past Join) and no crash. The
    // participant now sees the play/lobby screen (a run in lobby shows a waiting state).
    await expect(page.getByPlaceholder('הקוד שלכם')).toHaveCount(0, { timeout: 20_000 });
    await assertNoCrash(page);
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
