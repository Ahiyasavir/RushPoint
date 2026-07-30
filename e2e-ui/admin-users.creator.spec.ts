// Admin platform-users dashboard: does /admin/users actually RENDER
// (change: admin-user-activity-dashboard).
//
// Everything else about this feature is already covered by a cheaper lane: the
// aggregation rule by `packages/shared/src/adminUserActivity.test.ts`, the paging bounds
// by `functions/src/admin/authRoster.test.ts`, the claim gate by
// `apps/creator-web/src/lib/adminGate.test.ts`, and the callable + its authz denials by
// `scripts/e2e-verify.mjs`. NONE of those can see the one failure mode this page is most
// exposed to: a React render crash. The page is a brand-new route with conditional
// early returns around a `useEffect` and a claims read — precisely the shape that
// produced the "Rendered fewer hooks than expected" white screen recorded in CLAUDE.md.
//
// Two states are worth proving, because they are the two a human will ever see:
//   • a signed-in NON-admin gets the access-denied state and NO table
//   • a signed-in admin gets the table (headers + its own row)
//
// The admin state needs a real `admin` custom claim, which only the Auth emulator can
// mint here, so this spec SKIPS (never fails) without the emulator — the same contract
// as run-console-rail.creator.spec.ts, keeping the no-emulator `npm run test:ui` green.
//
// Named *.creator.spec.ts so the existing `creator` project's testMatch picks it up.
import { test, expect, assertNoCrash } from './fixtures';

const AUTH = 'http://127.0.0.1:9099';
const FN = 'http://127.0.0.1:5001/rushpoint-pwa-7daaa/us-central1';
const KEY = '?key=fake-api-key';
const PROJECT = 'rushpoint-pwa-7daaa';

// Two distinct fixture accounts: the whole point is the DIFFERENCE between them, so
// they must never be the same uid.
const ADMIN_EMAIL = 'admin-users-admin@rushpoint.dev';
const PLAIN_EMAIL = 'admin-users-plain@rushpoint.dev';
const PASSWORD = 'test1234';

// Hebrew is creator-web's default language, so these are the strings a human sees.
const TITLE = 'משתמשי הפלטפורמה';          // adminUsers.title
const DENIED = 'הדף הזה מוגבל למנהלי הפלטפורמה'; // adminUsers.deniedTitle
const COL_GAMES = 'משחקים שנוצרו';           // adminUsers.colGames
const NAV_ADMIN = 'משתמשי הפלטפורמה';        // nav.admin (same words as the page title)

async function post(url: string, body: unknown, token?: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, never> };
}

async function emulatorUp(): Promise<boolean> {
  try {
    await fetch(FN, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** Sign in, creating the account on first run (the emulator export may not carry it). */
async function accountUid(email: string): Promise<string> {
  const signIn = await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword${KEY}`,
    { email, password: PASSWORD, returnSecureToken: true });
  const res = signIn.status === 200
    ? signIn
    : await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp${KEY}`,
      { email, password: PASSWORD, returnSecureToken: true });
  return res.json.localId as unknown as string;
}

/**
 * Grant `admin: true` on an emulator account. The Auth emulator exposes the same
 * `accounts:update` endpoint the Admin SDK uses, and accepts an Owner bearer token, so
 * the claim is a REAL custom claim on a real token — the page's `getIdTokenResult()`
 * gate and the callable's `assertAdmin` both run exactly as they do in production.
 */
async function grantAdmin(uid: string): Promise<void> {
  const res = await post(
    `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`,
    { localId: uid, customAttributes: JSON.stringify({ admin: true }) },
    'owner',
  );
  expect(res.status, 'granting the admin custom claim must succeed').toBe(200);
}

async function signInThroughUi(page: import('@playwright/test').Page, email: string) {
  await page.goto('/');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'כניסה →' }).click();
  // The sign-in form leaving the DOM is the app's own signal that AuthGate handed over.
  await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 20_000 });
}

test.describe('Admin platform-users dashboard', () => {
  let ready = false;

  test.beforeAll(async () => {
    test.skip(!(await emulatorUp()), 'Firebase emulator not running');
    const adminUid = await accountUid(ADMIN_EMAIL);
    await accountUid(PLAIN_EMAIL);   // exists, deliberately WITHOUT the claim
    await grantAdmin(adminUid);
    ready = true;
  });

  test.beforeEach(async () => {
    test.skip(!ready, 'fixtures not provisioned');
  });

  test('a non-admin creator sees the access-denied state and no table', async ({ page, pageErrors }) => {
    await signInThroughUi(page, PLAIN_EMAIL);
    await page.goto('/admin/users');
    await assertNoCrash(page);

    await expect(page.getByText(DENIED)).toBeVisible();
    // The spec says a non-admin must not even see the report: no table, no headers.
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.getByText(COL_GAMES)).toHaveCount(0);
    expect(pageErrors, 'no uncaught render errors').toEqual([]);
  });

  test('an admin sees the table, its columns and their own row', async ({ page, pageErrors }) => {
    await signInThroughUi(page, ADMIN_EMAIL);
    await page.goto('/admin/users');
    await assertNoCrash(page);

    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
    // The denied state must NOT be what an admin gets.
    await expect(page.getByText(DENIED)).toHaveCount(0);

    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 20_000 });
    // Scoped to the table's own header. A bare getByText would match ~125 nodes: the
    // phone card layout renders the same label as a <dt> per creator and is present in
    // the DOM at every width, merely hidden by CSS below md.
    await expect(table.getByRole('columnheader', { name: COL_GAMES })).toBeVisible();
    // The admin account is itself a real creator account, so it must be listed —
    // proving rows actually rendered rather than just the empty-state shell.
    await expect(table.getByText(ADMIN_EMAIL)).toBeVisible();
    expect(pageErrors, 'no uncaught render errors').toEqual([]);
  });

  test('the phone layout renders cards, tiles and a mailto link, not a table', async ({ page, pageErrors }) => {
    // The person reading this dashboard is usually on their phone, so the small screen
    // layout is the primary one, not a degraded fallback. A five column table at 375px
    // is a horizontal scroll nobody performs — assert the table is genuinely absent and
    // the card list is what renders.
    await page.setViewportSize({ width: 375, height: 812 });
    await signInThroughUi(page, ADMIN_EMAIL);
    await page.goto('/admin/users');
    await assertNoCrash(page);

    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
    // The desktop table is hidden below md.
    await expect(page.locator('table')).toBeHidden();
    // One card per creator. Scope to the card that actually carries this creator's
    // mailto link: the account email ALSO appears in the page header, which is itself
    // hidden on a phone, so a bare getByText(...).first() resolves to the wrong node
    // and reports "hidden" for a card that is in fact on screen.
    const card = page.locator('li').filter({ has: page.locator(`a[href="mailto:${ADMIN_EMAIL}"]`) });
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    // The quick outreach affordance: a real mailto link for that creator.
    await expect(card.locator(`a[href="mailto:${ADMIN_EMAIL}"]`)).toBeVisible();

    // And the page must not scroll sideways — the actual phone failure mode.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal overflow on a phone viewport').toBeLessThanOrEqual(1);

    expect(pageErrors, 'no uncaught render errors').toEqual([]);
  });

  test('the admin dashboard link is in the menu for an admin and absent for everyone else', async ({ page, pageErrors }) => {
    // Cosmetic only — the page and the callable both re-check the claim — but a menu that
    // offers a door which will not open is its own bug, and so is a menu that hides the
    // one destination this account exists to reach.
    await page.setViewportSize({ width: 375, height: 812 });

    await signInThroughUi(page, PLAIN_EMAIL);
    await page.getByRole('button', { name: /תפריט|☰/ }).click().catch(async () => {
      await page.locator('header button').first().click();
    });
    await page.waitForTimeout(500);
    await expect(page.getByRole('link', { name: NAV_ADMIN })).toHaveCount(0);
    expect(pageErrors, 'no uncaught render errors').toEqual([]);

    // Same viewport, same drawer, different account: now the entry must be there and must
    // actually navigate.
    await page.goto('/');
    await page.getByRole('button', { name: 'יציאה' }).click();
    await page.waitForTimeout(1500);
    await signInThroughUi(page, ADMIN_EMAIL);
    await page.getByRole('button', { name: /תפריט|☰/ }).click().catch(async () => {
      await page.locator('header button').first().click();
    });
    await page.waitForTimeout(800);
    const link = page.getByRole('link', { name: NAV_ADMIN });
    await expect(link).toHaveCount(1);
    await link.click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await assertNoCrash(page);
    expect(pageErrors, 'no uncaught render errors').toEqual([]);
  });
});
