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
}

void main().then(() => {
  console.log(`\n${failures === 0 ? 'ALL UPLOAD-RESILIENCY TESTS PASSED' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
});
