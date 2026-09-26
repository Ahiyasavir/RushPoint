// Pure-logic tests for the photo/audio upload resiliency layer
// (docs/wave-a/upload-resiliency.md). The retry/backoff/timeout logic used by
// uploadTaskPhoto / uploadTaskAudio / callable() lives in a DOM-free, Firebase-free
// module precisely so it can be tested here — no emulator, no real Storage.
//   npx tsx scripts/test-upload-resiliency.ts
import {
  uploadPercent,
  jitteredBackoffMs,
  isRetryableStorageError,
  runWithRetry,
  withTimeout,
  setUploadProgress,
  getUploadProgress,
  subscribeUploadProgress,
  attemptBudgetMs,
  ATTEMPT_BUDGET_CAP_MS,
  interruptibleSleep,
} from '../apps/play-web/src/lib/uploadResiliency';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── 1. uploadPercent ────────────────────────────────────────────────────────
check('uploadPercent half', uploadPercent(50, 100) === 50);
check('uploadPercent complete', uploadPercent(100, 100) === 100);
check('uploadPercent zero total → 0', uploadPercent(0, 0) === 0);
check('uploadPercent over total clamps', uploadPercent(500, 100) === 100);
check('uploadPercent negative clamps', uploadPercent(-5, 100) === 0);
for (const v of [uploadPercent(NaN, 100), uploadPercent(10, NaN), uploadPercent(Infinity, 100)]) {
  check('uploadPercent junk stays finite 0..100', Number.isFinite(v) && v >= 0 && v <= 100, String(v));
}

// ── 2. jitteredBackoffMs ────────────────────────────────────────────────────
check('backoff attempt 0 in range', jitteredBackoffMs(0, 0) === 150 && jitteredBackoffMs(0, 1) === 400);
check('backoff grows with attempt', jitteredBackoffMs(1, 0) > jitteredBackoffMs(0, 0));
check('backoff never negative', [0, 1, 2, 5].every((a) => jitteredBackoffMs(a, 0) >= 0));
check('backoff bounded', jitteredBackoffMs(2, 1) <= 1000, String(jitteredBackoffMs(2, 1)));

// ── 3. isRetryableStorageError ──────────────────────────────────────────────
const err = (code: string) => Object.assign(new Error(code), { code });
for (const c of [
  'storage/retry-limit-exceeded', 'storage/unknown', 'storage/server-file-wrong-size',
  'storage/canceled', 'storage/deadline-exceeded', 'storage/internal-error',
]) check(`retryable: ${c}`, isRetryableStorageError(err(c)));
for (const c of [
  'storage/unauthorized', 'storage/unauthenticated', 'storage/invalid-argument',
  'storage/quota-exceeded', 'storage/object-not-found', '',
]) check(`NOT retryable: ${c || '(no code)'}`, !isRetryableStorageError(err(c)));
check('non-error input is not retryable', !isRetryableStorageError(undefined));

// ── 4. runWithRetry ─────────────────────────────────────────────────────────
const noSleep = async () => {};

// (async sections live in main() — tsx compiles these scripts as CJS, where
// top-level await is unavailable.)
async function main() {
await (async () => {
  let calls = 0;
  const out = await runWithRetry(async () => { calls++; return 'ok'; },
    { attempts: 3, isRetryable: () => true, sleep: noSleep });
  check('runWithRetry success on first attempt', out === 'ok' && calls === 1, `calls=${calls}`);
})();

await (async () => {
  let calls = 0;
  const out = await runWithRetry(async () => {
    calls++;
    if (calls < 3) throw err('storage/unknown');
    return 'late-ok';
  }, { attempts: 3, isRetryable: isRetryableStorageError, sleep: noSleep });
  check('runWithRetry retries transient then succeeds', out === 'late-ok' && calls === 3, `calls=${calls}`);
})();

await (async () => {
  let calls = 0;
  let threw = '';
  try {
    await runWithRetry(async () => { calls++; throw err('storage/unauthorized'); },
      { attempts: 3, isRetryable: isRetryableStorageError, sleep: noSleep });
  } catch (e) { threw = String((e as { code?: string }).code); }
  check('runWithRetry stops on non-retryable', calls === 1 && threw === 'storage/unauthorized', `calls=${calls}`);
})();

await (async () => {
  let calls = 0;
  let threw = '';
  try {
    await runWithRetry(async () => { calls++; throw err('storage/unknown'); },
      { attempts: 3, isRetryable: isRetryableStorageError, sleep: noSleep });
  } catch (e) { threw = String((e as { code?: string }).code); }
  check('runWithRetry exhausts attempts and rethrows', calls === 3 && threw === 'storage/unknown', `calls=${calls}`);
})();

await (async () => {
  const seen: number[] = [];
  try {
    await runWithRetry(async () => { throw err('storage/unknown'); }, {
      attempts: 4, isRetryable: isRetryableStorageError,
      sleep: async (ms: number) => { seen.push(ms); }, rand: () => 0,
    });
  } catch { /* expected */ }
  check('runWithRetry sleeps between attempts only', seen.length === 3, JSON.stringify(seen));
  check('runWithRetry backoff increases', seen[0] < seen[1] && seen[1] < seen[2], JSON.stringify(seen));
})();

// ── 5. withTimeout ──────────────────────────────────────────────────────────
await (async () => {
  const fast = await withTimeout(Promise.resolve('quick'), 50, 'x/timeout');
  check('withTimeout passes a fast result through', fast === 'quick');
})();

await (async () => {
  let cancelled = 0;
  let code = '';
  const slow = new Promise((res) => setTimeout(() => res('too late'), 200));
  try {
    await withTimeout(slow, 20, 'storage/deadline-exceeded', () => { cancelled++; });
  } catch (e) { code = String((e as { code?: string }).code); }
  check('withTimeout rejects a slow promise with the given code', code === 'storage/deadline-exceeded', code);
  check('withTimeout invokes the cancel hook once', cancelled === 1, String(cancelled));
})();

// ── 6. upload progress store ────────────────────────────────────────────────
await (async () => {
  const seen: (number | null)[] = [];
  const unsub = subscribeUploadProgress((v) => seen.push(v));
  setUploadProgress(10);
  setUploadProgress(90);
  check('store publishes to subscribers', seen.length >= 2 && seen[seen.length - 1] === 90, JSON.stringify(seen));
  check('getUploadProgress reflects the last publish', getUploadProgress() === 90);
  unsub();
  setUploadProgress(null);
  check('unsubscribe stops delivery', seen[seen.length - 1] === 90, JSON.stringify(seen));
  check('store cleared', getUploadProgress() === null);
})();
// ── 7. per-attempt budget (change: media-upload-reliability, D2) ────────────
// Kill STALLS, not slowness: a big clip on a weak link that keeps moving must get the time it
// needs; only the 45 s no-progress detector declares an attempt dead.
{
  const MB = 1024 * 1024;
  check('0 bytes gets the 180 s floor', attemptBudgetMs(0) === 180_000, String(attemptBudgetMs(0)));
  check('1 MB gets the 180 s floor', attemptBudgetMs(1 * MB) === 180_000, String(attemptBudgetMs(1 * MB)));
  const six = attemptBudgetMs(6 * MB);
  // 6 MB / 12 KB/s = 512 s + 60 s = 572 s: above the floor, below the cap.
  check('6 MB scales with size', six === 572_000, String(six));
  check('6 MB is above the old flat 180 s cap', six > 180_000, String(six));
  // 12 MB would need 1084 s at the floor rate: held at the cap.
  check('12 MB is held at the cap', attemptBudgetMs(12 * MB) === ATTEMPT_BUDGET_CAP_MS, String(attemptBudgetMs(12 * MB)));
  check('the cap is 15 minutes', ATTEMPT_BUDGET_CAP_MS === 15 * 60_000, String(ATTEMPT_BUDGET_CAP_MS));
  check('100 MB is held at the cap', attemptBudgetMs(100 * MB) === ATTEMPT_BUDGET_CAP_MS, String(attemptBudgetMs(100 * MB)));
  check('a malformed size falls back to the floor', attemptBudgetMs(Number.NaN) === 180_000 && attemptBudgetMs(-5) === 180_000);
}
// ── 8. a backoff the player can cut short (change: media-upload-reliability, D6) ─
// iOS pauses network work in a backgrounded tab. When the player comes back, the retry should go
// NOW, not after the rest of a backoff that was sized for a flaky link, not a suspended one.
await (async () => {
  let wakeCb: (() => void) | null = null;
  let unsubscribed = false;
  const t0 = Date.now();
  const p = interruptibleSleep(5_000, (cb) => { wakeCb = cb; return () => { unsubscribed = true; }; });
  setTimeout(() => wakeCb?.(), 10);
  await p;
  check('a wake cuts the backoff short', Date.now() - t0 < 1_000, String(Date.now() - t0));
  check('the wake listener is removed afterwards', unsubscribed);
  const t1 = Date.now();
  await interruptibleSleep(20, () => () => {});
  check('without a wake it still ends on time', Date.now() - t1 >= 15 && Date.now() - t1 < 1_000, String(Date.now() - t1));
})();

// ── 9. a player abort is final ──────────────────────────────────────────────
check('a player abort is never retried', !isRetryableStorageError({ code: 'upload/aborted' }));

}

void main().then(() => {
  console.log(`\n${failures === 0 ? 'ALL UPLOAD-RESILIENCY TESTS PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
});
