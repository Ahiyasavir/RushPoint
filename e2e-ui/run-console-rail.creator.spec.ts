// Creator run console: the SECTION RAIL (change: ui-smoke-coverage).
//
// The console's accordions were replaced by a Builder-style rail: a persistent
// list of sections of which exactly ONE renders, beside an always-on-screen pinned
// zone (`apps/creator-web/src/lib/runConsoleLayout.ts` → `buildRunConsoleSections`,
// `pinnedPanels`, `assignPanelColumns`; rendered by `RunConsolePage.tsx`).
//
// The pure lane proves the PLAN — which panel belongs to which section, and that a
// stale stored section degrades to the default. Nothing proves the page renders that
// plan: a rail that renders but never swaps the pane, a pinned panel swept into a
// section, or a console that throws on mount all keep every other gate green.
//
// The console reads a real run through authenticated Firestore listeners, so there
// is no honest way to reach it without the emulator. It therefore self-provisions
// its creator + run through the emulator REST/callable APIs and SKIPS (never fails)
// when the emulator is not running — the same contract as photo-review.creator.spec.ts,
// so the no-emulator configuration of `npm run test:ui` (and CI's `ui` job) stays
// green with this spec reported as skipped.
//
// Named *.creator.spec.ts so the existing `creator` project's testMatch picks it up
// without touching playwright.config.ts.
import { test, expect, assertNoCrash } from './fixtures';

const AUTH = 'http://127.0.0.1:9099';
const FN = 'http://127.0.0.1:5001/rushpoint-pwa-7daaa/us-central1';
const EMAIL = 'run-console-rail@rushpoint.dev';
const PASSWORD = 'test1234';
const KEY = '?key=fake-api-key';

// The rail's own header, which is also its nav's accessible name (rc.sectionsHeader).
const SECTIONS_NAV = 'מדורים';
// The pinned join card's QR image alt (rc.joinQrCode) — unique to the PINNED
// JoinShare panel, so it is a clean probe for "the pinned zone rendered".
const PINNED_JOIN_QR = 'קוד QR להצטרפות';

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
async function creatorToken(): Promise<string> {
  const signIn = await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword${KEY}`,
    { email: EMAIL, password: PASSWORD, returnSecureToken: true });
  const res = signIn.status === 200
    ? signIn
    : await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp${KEY}`,
      { email: EMAIL, password: PASSWORD, returnSecureToken: true });
  return res.json.idToken as unknown as string;
}

const task = (id: string, title: string, i: number) => ({
  id, title, type: 'field',
  coordinates: { lat: 31.7767 + i * 0.002, lng: 35.2345 + i * 0.002 },
  difficulty: 2, estimatedMinutes: 4, pointValue: 30,
});

interface Fixture { gameId: string; runId: string }

/** A minimal live run: no teams, no photos — the state a host sees right after launch. */
async function seedLiveRun(token: string): Promise<Fixture> {
  const created = await post(`${FN}/createGame`, { data: { title: 'מסילת מדורים', mode: 'team' } }, token);
  const gameId = (created.json.result as unknown as { gameId: string }).gameId;
  await post(`${FN}/updateGame`, {
    data: {
      gameId, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'rail-s1', order: 0, title: 'פתיחה', tasks: [task('rail-a', 'נקודת המפגש', 0)] },
        { id: 'rail-s2', order: 1, title: 'סיום', isFinal: true, tasks: [task('rail-b', 'קו הסיום', 1)] },
      ],
    },
  }, token);
  const launched = await post(`${FN}/launchRun`, { data: { gameId } }, token);
  const { runId } = launched.json.result as unknown as { runId: string };
  return { gameId, runId };
}

test.describe('Run console section rail', () => {
  let fixture: Fixture | null = null;

  test.beforeAll(async () => {
    test.skip(!(await emulatorUp()), 'Firebase emulator not running');
    fixture = await seedLiveRun(await creatorToken());
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!fixture, 'no fixture run');
    await page.goto('/');
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'כניסה →' }).click();
    // Wait for auth to actually resolve before navigating: the sign-in form leaving
    // the DOM is the app's own signal that the AuthGate handed over.
    await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 20_000 });
    await page.goto(`/run/${fixture!.gameId}/${fixture!.runId}`);
    await assertNoCrash(page);
  });

  test('the rail, the pinned zone and the active pane all render and agree', async ({ page, pageErrors }) => {
    const rail = page.getByRole('navigation', { name: SECTIONS_NAV });
    await expect(rail).toBeVisible();

    // A live run right after launch always yields at least `teamsAndScores` (the
    // teams panel renders its own empty state) and `shareAndScreens`.
    const entries = rail.getByRole('button');
    expect(await entries.count()).toBeGreaterThanOrEqual(2);

    // The PINNED zone is outside every section and must be on screen regardless of
    // which section is showing — a pinned panel swept into a section fails here.
    await expect(page.getByAltText(PINNED_JOIN_QR)).toBeVisible();

    // Exactly one destination is current, and the pane it opened is named after it:
    // the rail and the pane can never disagree (they read the same plan).
    const current = rail.locator('[aria-current="true"]');
    await expect(current).toHaveCount(1);
    const currentTitle = (await current.locator('div').first().innerText()).trim();
    const heading = page.getByRole('heading', { level: 2, name: currentTitle });
    await expect(heading).toBeVisible();

    await assertNoCrash(page);
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('activating another rail entry swaps the rendered pane', async ({ page, pageErrors }) => {
    const rail = page.getByRole('navigation', { name: SECTIONS_NAV });
    const current = rail.locator('[aria-current="true"]');
    await expect(current).toHaveCount(1);
    const before = (await current.locator('div').first().innerText()).trim();

    // The first destination that is NOT the current one. Read off the DOM rather
    // than hardcoded, so changing DEFAULT_SECTION cannot break this spec.
    const other = rail.getByRole('button').filter({ hasNotText: before }).first();
    const target = (await other.locator('div').first().innerText()).trim();
    expect(target).not.toBe(before);
    await other.click();

    // The pane really changed: the new section's heading is rendered, the old one is
    // gone, and the current marker moved with it. A dead click handler or a broken
    // `resolveSection` fails all three — and none of them can pass on an empty page.
    await expect(page.getByRole('heading', { level: 2, name: target })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: before })).toHaveCount(0);
    const nowCurrent = rail.locator('[aria-current="true"]');
    await expect(nowCurrent).toHaveCount(1);
    expect((await nowCurrent.locator('div').first().innerText()).trim()).toBe(target);

    // The pinned zone survives the navigation — the whole point of pinning it.
    await expect(page.getByAltText(PINNED_JOIN_QR)).toBeVisible();

    await assertNoCrash(page);
    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
