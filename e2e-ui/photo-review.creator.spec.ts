// Creator run console: the live photo approval queue (wave-e task 13).
//
// This is the layer the other gates cannot reach. `npm run e2e` proves the
// SERVER path (submit → pending → review → score → slot release) and the pure
// lane proves the queue ORDERING, but neither can tell whether the manager
// actually SEES a pending photo: the panel reads Firestore directly through an
// onSnapshot on the run's team docs, so a rules denial, a wrong path or a
// mis-shaped listener would render an empty console while every backend test
// stays green. That was the reported bug ("photos never appear in the console"),
// so it deserves a browser-level assertion.
//
// Self-provisions its own creator account + fixture run through the emulator
// REST/callable APIs and SKIPS (never fails) when the emulator is not running,
// so the no-emulator render-smoke configuration of `npm run test:ui` stays green.
//
// Named *.creator.spec.ts so the existing `creator` project picks it up.
import { test, expect, assertNoCrash } from './fixtures';

const AUTH = 'http://127.0.0.1:9099';
const FN = 'http://127.0.0.1:5001/rushpoint-pwa-7daaa/us-central1';
const EMAIL = 'photo-review@rushpoint.dev';
const PASSWORD = 'test1234';
const BUCKET = 'rushpoint-pwa-7daaa.appspot.com';

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

const KEY = '?key=fake-api-key';

/** Sign in, creating the account on first run (the emulator export may not carry it). */
async function creatorToken(): Promise<{ token: string; uid: string }> {
  const signIn = await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword${KEY}`,
    { email: EMAIL, password: PASSWORD, returnSecureToken: true });
  const res = signIn.status === 200
    ? signIn
    : await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp${KEY}`,
      { email: EMAIL, password: PASSWORD, returnSecureToken: true });
  return { token: res.json.idToken as unknown as string, uid: res.json.localId as unknown as string };
}

async function anonToken(): Promise<{ token: string; uid: string }> {
  const res = await post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp${KEY}`, { returnSecureToken: true });
  return { token: res.json.idToken as unknown as string, uid: res.json.localId as unknown as string };
}

const photoTask = (id: string, title: string, i: number) => ({
  id, title, type: 'photo',
  coordinates: { lat: 31.7767 + i * 0.002, lng: 35.2345 + i * 0.002 },
  difficulty: 2, estimatedMinutes: 3, pointValue: 40, maxConcurrentTeams: 3,
  // autoApprove OFF: the submission must land in the review queue, not self-approve.
  smart: { enabled: true, verificationType: 'photo_upload', autoApprove: false },
});

/** A 1x1 PNG uploaded to the Storage emulator so the panel renders a real <img>. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4nGP8//8/AzZgYmLCFmJiYmJgYWBgYPj//z8DAwMDAwMAHhkGAV0i0h0AAAAASUVORK5CYII=';

async function uploadProof(token: string, runId: string, uid: string, name: string): Promise<string> {
  const objectPath = `runs/${runId}/teams/${uid}/${name}`;
  const url = `http://127.0.0.1:9199/v0/b/${BUCKET}/o?name=${encodeURIComponent(objectPath)}`;
  const bytes = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` },
    body: bytes,
  });
  const meta = (await res.json()) as { downloadTokens?: string };
  const q = meta.downloadTokens ? `&token=${meta.downloadTokens}` : '';
  return `http://127.0.0.1:9199/v0/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media${q}`;
}

interface Fixture { gameId: string; runId: string }

async function seedPendingRun(token: string, ownerUid: string): Promise<Fixture> {
  const created = await post(`${FN}/createGame`, { data: { title: 'תור אישור תמונות', mode: 'individual' } }, token);
  const gameId = (created.json.result as unknown as { gameId: string }).gameId;
  await post(`${FN}/updateGame`, {
    data: {
      gameId, scoringPreset: 'fixed_points_speed',
      stages: [
        { id: 'pr-s1', order: 0, title: 'הוכחות', tasks: [photoTask('pr-a', 'סלפי במזרקה', 0), photoTask('pr-b', 'הדלת הכחולה', 1)] },
        { id: 'pr-s2', order: 1, title: 'סיום', isFinal: true, tasks: [photoTask('pr-c', 'הקבוצה בשער', 2)] },
      ],
    },
  }, token);
  const launched = await post(`${FN}/launchRun`, { data: { gameId } }, token);
  const { runId, accessCode } = launched.json.result as unknown as { runId: string; accessCode: string };

  // Two teams each submit one photo, so the queue has more than one row and the
  // FIFO order is observable.
  for (const [displayName, taskId, file] of [
    ['שועלים כחולים', 'pr-a', 'proof-a.png'],
    ['ינשופים אדומים', 'pr-b', 'proof-b.png'],
  ] as const) {
    const { token: pToken, uid } = await anonToken();
    await post(`${FN}/joinRun`, { data: { code: accessCode, displayName } }, pToken);
    await post(`${FN}/startTeams`, { data: { gameId, runId } }, token);
    const photoUrl = await uploadProof(pToken, runId, uid, file);
    await post(`${FN}/submitStationPhoto`, {
      data: { ownerUid, gameId, runId, teamId: uid, taskId, photoUrl },
    }, pToken);
  }
  return { gameId, runId };
}

test.describe('Run console photo approval queue', () => {
  let fixture: Fixture | null = null;

  test.beforeAll(async () => {
    test.skip(!(await emulatorUp()), 'Firebase emulator not running');
    const { token, uid } = await creatorToken();
    fixture = await seedPendingRun(token, uid);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!fixture, 'no fixture run');
    await page.goto('/');
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'כניסה →' }).click();
    await page.goto(`/run/${fixture!.gameId}/${fixture!.runId}`);
    await assertNoCrash(page);
  });

  // NOTE: the two tests share one fixture run and run serially (workers: 1), so the
  // second one still finds a pending row after the first approves one.
  test('pending photos stream into the console and Approve clears the row', async ({ page }) => {
    // The panel exists and is fed: both pending submissions are visible with their
    // team names — this is the assertion the reported bug would have failed.
    const panel = page.getByText('בדיקת תמונות');
    await expect(panel).toBeVisible();
    await expect(page.getByText('2 ממתינות')).toBeVisible();
    // Assert on the per-row task line, which is unique to this panel — the team
    // names also appear in the teams table and the announcement target select, so
    // a bare getByText on them is a strict-mode violation, not a stronger check.
    await expect(page.getByText('משימה pr-a')).toBeVisible();
    await expect(page.getByText('משימה pr-b')).toBeVisible();

    // The submitted photo really renders (Storage URL survives into the <img>).
    const shot = page.getByAltText('הגשה').first();
    await expect(shot).toBeVisible();

    // Approve the first row → it leaves the queue and lands in "recently reviewed".
    await page.getByRole('button', { name: 'אישור' }).first().click();
    await expect(page.getByText('1 ממתינות')).toBeVisible();
    await expect(page.getByText('נבדקו לאחרונה')).toBeVisible();
    await expect(page.getByText('אושר').first()).toBeVisible();
    await assertNoCrash(page);
  });

  test('an approved row cannot be rejected back and says why', async ({ page }) => {
    // Approve one row so the reviewed strip is populated for this test too.
    await page.getByRole('button', { name: 'אישור' }).first().click();
    await expect(page.getByText('נבדקו לאחרונה')).toBeVisible();
    // The server has no score clawback, so Reject on an approved row is DISABLED
    // and explains itself instead of silently doing nothing.
    const disabled = page.getByRole('button', { name: /כבר אושר/ }).first();
    await expect(disabled).toBeVisible();
    await expect(disabled).toBeDisabled();
    await assertNoCrash(page);
  });
});
