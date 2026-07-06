// Shared fixture: capture uncaught page errors + a crash-ErrorBoundary trip on every
// spec, so a render crash fails LOUD instead of a spec passing on a white screen.
//
// `pageErrors` collects uncaught exceptions (page.on('pageerror')) — the strongest
// white-screen signal. `assertNoCrash(page)` additionally checks the app's crash
// ErrorBoundary copy ("Something went wrong" / "משהו השתבש") isn't on screen.
// Console errors are noisy in dev (emulator warnings, favicon 404s) so they are NOT
// hard-failed here — a real crash surfaces as a pageerror or the boundary text.
import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(errors);
  },
});

// The crash ErrorBoundary renders this bilingual copy (common.errorTitle). If it is
// visible, the React tree threw during render — a white-screen bug.
export async function assertNoCrash(page: Page): Promise<void> {
  const crash = page.getByText(/Something went wrong|משהו השתבש/);
  await expect(crash, 'app crash ErrorBoundary must not be visible').toHaveCount(0);
}

export { expect };
