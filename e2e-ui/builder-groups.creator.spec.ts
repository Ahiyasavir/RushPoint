// Builder: exclusive-group UI (2A) + dnd-kit keyboard drag (2B).
// Change: builder-dnd-groups. This is the lane the pure tests deliberately cannot
// cover — dnd-kit measures real layout rects, so a jsdom "drag test" would pass
// while the feature is broken (see docs/wave-d/builder-dnd-groups-plan.md §3.2).
// Playwright drives REAL keys against a REAL layout, which makes the keyboard-drag
// assertion the actual evidence that shrinking the card's "move to stage" control
// to a ⋯ menu did not strand keyboard users.
//
// Needs the Firebase emulator suite (auth + functions). It self-provisions its
// creator account and its fixture game through the emulator REST/callable APIs, and
// SKIPS (rather than fails) when the emulator is not running, so `npm run test:ui`
// stays green in the no-emulator render-smoke configuration.
//
// File is named *.creator.spec.ts so it is picked up by the existing `creator`
// project's testMatch without touching playwright.config.ts.
import { test, expect, assertNoCrash } from './fixtures';

const AUTH = 'http://127.0.0.1:9099';
const FN = 'http://127.0.0.1:5001/rushpoint-pwa-7daaa/us-central1';
const EMAIL = 'builder-groups@rushpoint.dev';
const PASSWORD = 'test1234';

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
async function idToken(): Promise<string> {
  const key = '?key=fake-api-key';
  const signIn = await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword${key}`,
    { email: EMAIL, password: PASSWORD, returnSecureToken: true });
  if (signIn.status === 200) return signIn.json.idToken as unknown as string;
  const signUp = await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp${key}`,
    { email: EMAIL, password: PASSWORD, returnSecureToken: true });
  return signUp.json.idToken as unknown as string;
}

/** A stage of 6 tasks with two exclusive groups (3 + 2) and requiredTaskCount 3. */
async function seedGame(token: string): Promise<string> {
  const created = await post(`${FN}/createGame`, { data: { title: 'בדיקת קיבוץ משימות', mode: 'scavenger_hunt', tags: [] } }, token);
  const gameId = (created.json.result as unknown as { gameId: string }).gameId;
  const task = (i: number, title: string, type: string, extra: object = {}) => ({
    id: `task${i}`, title, type, difficulty: 3, estimatedMinutes: 4, pointValue: 30,
    coordinates: { lat: 31.77 + i / 1000, lng: 35.21 + i / 1000 }, ...extra,
  });
  const stages = [
    {
      id: 'stage1', order: 0, title: 'העיר העתיקה', requiredTaskCount: 3,
      tasks: [
        task(1, 'צילום במזרקה', 'photo'),
        task(2, 'שאלה על המזרקה', 'quiz', { answers: ['מזרקה'] }),
        task(3, 'קוד במזרקה', 'smart_station', { smart: { secretCode: '1234' } }),
        task(4, 'הגעה לשוק', 'field'),
        task(5, 'שאלה על השוק', 'quiz', { answers: ['שוק'] }),
        task(6, 'כמה דוכנים בשוק', 'numeric', { numericAnswer: 12, numericTolerance: 1 }),
      ],
      exclusiveGroups: [{ id: 'ga', taskIds: ['task1', 'task2', 'task3'] }, { id: 'gb', taskIds: ['task5', 'task6'] }],
    },
    { id: 'stage2', order: 1, title: 'הסיום', isFinal: true, tasks: [task(9, 'קו הסיום', 'field')] },
  ];
  await post(`${FN}/updateGame`, { data: { gameId, stages } }, token);
  return gameId;
}

test.describe('Builder exclusive groups + drag and drop', () => {
  let gameId = '';

  test.beforeAll(async () => {
    test.skip(!(await emulatorUp()), 'Firebase emulator not running');
    gameId = await seedGame(await idToken());
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!gameId, 'no fixture game');
    await page.goto('/');
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'כניסה →' }).click();
    await page.goto(`/build/${gameId}`);
    await expect(page.getByText('העיר העתיקה').first()).toBeVisible();
    await assertNoCrash(page);
  });

  test('summary strip is one line, cards carry letter badges, no wide move select', async ({ page }) => {
    // Surface A: one summary chip per EFFECTIVE group, not one chip per task.
    await expect(page.getByRole('button', { name: 'קבוצת חלופות א, 3 משימות' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'קבוצת חלופות ב, 2 משימות' })).toBeVisible();

    // Surface B: the membership is readable on the cards themselves — 3 in א, 2 in ב.
    await expect(page.locator('[aria-label*="חלופה א מתוך 3"]')).toHaveCount(3);
    await expect(page.locator('[aria-label*="חלופה ב מתוך 2"]')).toHaveCount(2);

    // The move-to-stage control survives (a11y) but no longer eats the card face:
    // it is a ⋯ collapsed select, not the old 8rem labelled one.
    const move = page.locator('select[aria-label="העברה לשלב…"]').first();
    await expect(move).toHaveCount(1);
    expect((await move.boundingBox())!.width).toBeLessThan(48);

    // The page must never scroll sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });

  test('the modal assigns a task to a group, and the badge follows', async ({ page }) => {
    await page.getByRole('button', { name: 'קיבוץ משימות' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // One radiogroup per task ⇒ a task can be in at most one group by construction.
    await expect(dialog.getByRole('radiogroup')).toHaveCount(6);

    // Move the ungrouped "הגעה לשוק" into group ב.
    await dialog.getByRole('radiogroup', { name: 'הגעה לשוק' }).getByRole('radio').nth(2).click();
    await expect(page.locator('[aria-label*="חלופה ב מתוך 3"]')).toHaveCount(3);

    // The ceiling drops to 2 while requiredTaskCount is still 3 ⇒ the unwinnable
    // warning must be echoed in the footer while the creator is still editing.
    await expect(dialog.getByText(/מקסימום השלמות בשלב הזה: 2/)).toBeVisible();
    await expect(dialog.getByText(/מספר המשימות הנדרש להשלמה גבוה/)).toBeVisible();

    // Put it back and close.
    await dialog.getByRole('radiogroup', { name: 'הגעה לשוק' }).getByRole('radio').first().click();
    await dialog.getByRole('button', { name: 'סיום' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('no horizontal overflow and correct RTL on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByText('העיר העתיקה').first()).toBeVisible();
    // The Builder is Hebrew first: the document must actually be RTL, and neither
    // the new summary strip nor the badges may push the page sideways.
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await expect(page.getByRole('button', { name: 'קבוצת חלופות א, 3 משימות' })).toBeVisible();
    await expect(page.locator('[aria-label*="חלופה א מתוך 3"]').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

    // ...and the modal has to fit too.
    await page.getByRole('button', { name: 'קיבוץ משימות' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test('moving a grouped task to another stage strips it from the source groups', async ({ page }) => {
    // Groups are STAGE SCOPED. A task that leaves must leave its group, or the id
    // dangles: inert by contract, but it would silently shrink a real group to one
    // member with nothing on screen to say so. Driven through the ⋯ menu because
    // that path and the rail drop share `moveTaskBetweenStages`.
    await expect(page.locator('[aria-label*="חלופה א מתוך 3"]')).toHaveCount(3);
    const card = page.locator('[role="button"][aria-label="צילום במזרקה"]');
    await card.locator('select[aria-label="העברה לשלב…"]').selectOption({ label: 'הסיום' });

    // Group א is down to its 2 remaining members, and the moved task is gone.
    await expect(page.locator('[aria-label*="חלופה א מתוך 2"]')).toHaveCount(2);
    await expect(card).toHaveCount(0);

    // Its new stage did NOT inherit a group: the task arrives ungrouped.
    await page.getByText('הסיום').first().click();
    await expect(page.locator('[role="button"][aria-label="צילום במזרקה"]')).toBeVisible();
    await expect(page.locator('[aria-label*="חלופה"]')).toHaveCount(0);
  });

  // ONE pointer-drag happy path and no more: dnd-kit pointer drags need several
  // intermediate mouse moves and are timing sensitive, so a suite of them buys
  // flakiness rather than coverage. Cross-stage pointer drags onto the rail are
  // verified by hand; the logic they run is the same `moveTaskBetweenStages` the
  // ⋯ test above drives deterministically.
  test('pointer drag reorders a task', async ({ page }) => {
    test.setTimeout(60_000);
    const titles = () => page.locator('.grid > div .text-sm.font-semibold').allTextContents();
    const before = (await titles())[0];
    const handle = page.locator('span[role="button"][aria-label^="גררו כדי לשנות סדר"]').first();
    const from = (await handle.boundingBox())!;
    const to = (await page.locator('.grid > div').nth(2).boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // PointerSensor has an activation delay, so hold still before moving.
    await page.waitForTimeout(300);
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(to.x + to.width / 2, from.y + (to.y - from.y) * (i / 6), { steps: 2 });
    }
    await page.mouse.up();

    await expect.poll(async () => (await titles())[0]).not.toBe(before);
  });

  test('keyboard drag reorders a task without a pointer', async ({ page }) => {
    const titles = () => page.locator('.grid > div .text-sm.font-semibold').allTextContents();
    const before = (await titles())[0];

    // Space to lift, ArrowDown to move, Space to drop — the whole justification
    // for letting the labelled move select leave the card face.
    // The SPAN handle specifically — the card root is also role=button.
    const handle = page.locator('span[role="button"][aria-label^="גררו כדי לשנות סדר"]').first();
    await handle.focus();
    await page.keyboard.press('Space');
    // dnd-kit measures its droppables asynchronously after the lift; pressing an
    // arrow in the same tick finds no candidate rects and the move is a no-op.
    // A human is always slower than this; the wait is a test artefact, not a delay
    // the feature needs.
    await expect(page.getByRole('status')).toContainText(before);
    await page.waitForTimeout(250);
    await page.keyboard.press('ArrowDown');
    // Wait for the live region to confirm the move landed on a DIFFERENT task before
    // dropping. dnd-kit applies the arrow synchronously but React flushes the new
    // `over` on the next render, and Playwright can press Space inside that frame.
    await expect.poll(async () => (await page.getByRole('status').textContent()) ?? '')
      .not.toContain(`מעל ${before}`);
    await page.keyboard.press('Space');

    await expect.poll(async () => (await titles())[0]).not.toBe(before);
    // Lifting with Space must NOT also open the task editor behind the drag.
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
