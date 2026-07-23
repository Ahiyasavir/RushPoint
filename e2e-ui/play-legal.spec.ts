// play-web LEGAL documents render smoke — `/terms` and `/privacy` on the participant
// origin (change: ui-smoke-coverage).
//
// These are the two routes with the worst failure mode in the app and the least
// coverage. `LegalScreen` is a LAZY chunk (`lazyWithRetry('legal', …)` in App.tsx)
// behind a Suspense fallback, so a chunk that fails to resolve is a permanently
// blank page; and before the route existed both paths fell through play-web's
// query-param routing and rendered the GAME instead of the document. Both are
// invisible to every other gate: the pure lane proves `resolveLegalPath()` maps the
// path, not that the page then renders 60 KB of policy prose.
//
// Needs NO emulator and NO backend — the documents are static shared content and
// the screen never calls a callable — so unlike the console/Builder specs this one
// runs for real on every PR.
import { test, expect, assertNoCrash } from './fixtures';

/** The Join screen's access-code field: if this is on a legal path, the route lost. */
const PLAYER_CODE_FIELD = 'הקוד שלכם';

/**
 * Assertions common to both documents. The heading FLOOR is what makes this smoke
 * un-passable on an empty page: a blank render, a stuck Suspense fallback and a
 * truncated document all fail it, while ordinary copy edits do not.
 */
async function assertDocumentRendered(
  page: import('@playwright/test').Page,
  opts: { title: string; firstSection: string },
) {
  await assertNoCrash(page);

  // The document's own title, as its <h1> — not a generic app shell.
  await expect(page.getByRole('heading', { level: 1, name: opts.title })).toBeVisible();
  // The "last updated" line: proves the metadata line rendered next to the title.
  await expect(page.getByText(/עודכן לאחרונה/)).toBeVisible();
  // Section 1 of the real text, parsed out of the markdown body into an <h2>.
  await expect(page.getByRole('heading', { name: opts.firstSection })).toBeVisible();
  // …and the body is genuinely the whole document, not one stub heading.
  expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThanOrEqual(5);

  // THE reported bug: these paths used to render the player screen. The access-code
  // entry is the JoinScreen's anchor (play.spec.ts asserts it positively) — here it
  // must be absent, which is what distinguishes "the legal route won" from "some
  // page rendered".
  await expect(page.getByPlaceholder(PLAYER_CODE_FIELD)).toHaveCount(0);
}

test.describe('play-web legal documents', () => {
  test('/terms renders the Terms of Service, not the player screen', async ({ page, pageErrors }) => {
    await page.goto('/terms');
    await assertDocumentRendered(page, { title: 'תנאי שימוש', firstSection: '1. כללי וקבלת התנאים' });
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('/privacy renders the Privacy Policy, not the player screen', async ({ page, pageErrors }) => {
    await page.goto('/privacy');
    await assertDocumentRendered(page, { title: 'מדיניות פרטיות', firstSection: '1. מבוא ותחולה' });
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  // The only interactive behavior the screen has, and the cheapest proof that BOTH
  // language bodies made it into the lazy chunk (they are separate entries of
  // LEGAL_DOCS, so a mis-scoped deep import would ship only one).
  test('the language switch swaps the document to English', async ({ page, pageErrors }) => {
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 1, name: 'תנאי שימוש' })).toBeVisible();

    await page.getByRole('button', { name: 'English' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '1. Acceptance of Terms' })).toBeVisible();
    await assertNoCrash(page);
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
