# Wave A — Task 11: photo/audio upload resiliency

Symptom (family playtest): taking a photo is slow and often ends in
`לא הצלחנו לשמור את התמונה. צלמו שוב.` (`t.task.photoSaveRetry`) with no way to recover
except retaking the picture.

## SDD — structural plan

### Root cause (two independent defects)

1. **No retry / no timeout on the upload itself.** `uploadTaskPhoto`
   (`apps/play-web/src/services/firebase.ts`) and `uploadTaskAudio` used a bare
   `uploadBytes` — a single non-resumable PUT with no timeout, no progress and no retry.
   The callable wrapper directly below it (`callable()`) already had
   `RETRYABLE_CALLABLE_CODES` + a 20 s timeout + 3 jittered attempts, so
   `submitStationPhoto` survived a flaky moment on mobile data but **the upload before it
   did not**. One blip ⇒ the Hebrew error, no recovery.
2. **Silent full-size fallback in compression.** `compressImageFile` already existed and
   was wired (TaskRunner → `pickFile`), but every failure path (`createImageBitmap` throw,
   no 2d context, `toBlob` → null) silently returned the **original** file. On a 12 MP phone
   photo that is a ~5 MB upload the user experiences as a freeze — and nothing anywhere
   recorded that the fallback happened.

Not a defect (explicitly preserved): the storage path shape
`runs/{runId}/teams/{teamId}/{taskId}-{ts}.jpg` is validated server-side by
`requireStorageUrl` (`packages/shared/src/validation.ts:220`); the forced `image/jpeg`
content type; `MAX_PHOTO_BYTES`; the blob-URL revoke logic in `PhotoEntry`.

### Design

New pure module **`apps/play-web/src/lib/uploadResiliency.ts`** — DOM-free, Firebase-free,
so the retry/backoff logic is unit-testable without touching real Storage:

| export | role |
|---|---|
| `RETRYABLE_STORAGE_CODES` | transient Storage codes, same *shape* as `RETRYABLE_CALLABLE_CODES` |
| `errorCode(e)` / `isRetryableStorageError(e)` | code extraction + predicate |
| `jitteredBackoffMs(attempt, rand)` | the existing `150·(n+1) + rand·250` curve, extracted |
| `runWithRetry(fn, opts)` | generic bounded-retry loop (injectable `sleep`/`rand`) |
| `withTimeout(promise, ms, code, onTimeout)` | timeout race + cancel hook |
| `uploadPercent(transferred, total)` | pure 0–100 clamp, total-0/NaN safe |
| `setUploadProgress` / `getUploadProgress` / `subscribeUploadProgress` | tiny pub-sub so the *upload* (in `firebase.ts`) can drive the *UI* (`PhotoEntry`) without threading a callback through `TaskRunner.photo()` |

`firebase.ts`:
- `uploadBytesResumable` + `on('state_changed')` → publishes progress to the store.
- **Stall** timeout (45 s without a progress byte) *and* an absolute cap (3 min); either
  cancels the resumable task and rejects with a retryable synthetic code.
- 3 attempts with the shared jittered backoff, only for transient codes.
- `callable()` refactored onto the same `runWithRetry` + `withTimeout` (behaviour
  unchanged: 20 s, 3 attempts, same code set) so there is one retry implementation.

`imageResize.ts`:
- `compressImageWithReport(file)` → `{ blob, compressed, reason, originalBytes, outputBytes }`;
  `compressImageFile` kept as a thin back-compat wrapper.
- **Stricter budget:** multi-pass encode — `nextEncodeStep()` steps the plan
  (1280/0.7 → 1280/0.55 → 1024/0.5 → 800/0.45) until the output is under
  `PHOTO_TARGET_BYTES` (900 KB) or the plan is exhausted.
- `chooseUploadBlob(originalBytes, encodedBytes)` — refuses an "encoded" result that isn't
  meaningfully smaller (< 5 % saving) so we never upload a *bigger* re-encode.
- Every fallback is now **observable**: a `reason` in the report + a single
  `console.warn('[rp:photo] …')`.

`TaskRunner.tsx` (owned photo/audio sub-components only):
- `PhotoEntry` subscribes to the progress store and renders a determinate progress bar +
  `t.task.uploadingPercent`, plus `t.task.uploadRetrying` while a retry is pending, so a
  slow upload no longer looks like a freeze.
- `pickFile` uses `compressImageWithReport`.

i18n: `uploadingPercent`, `uploadRetrying`, `photoNotCompressed` added to **both** the HE
object and the EN mirror (TS parity-enforced; HE strings are genuinely Hebrew).

### Affected files

- `apps/play-web/src/lib/uploadResiliency.ts` (new)
- `apps/play-web/src/lib/imageResize.ts`
- `apps/play-web/src/services/firebase.ts`
- `apps/play-web/src/components/TaskRunner.tsx` (PhotoEntry only)
- `apps/play-web/src/i18n.ts` (3 keys × 2 locales)
- `scripts/test-upload-resiliency.ts` (new), `scripts/test-image-resize.ts` (extended)

## TDD — RED first

`scripts/test-upload-resiliency.ts` (picked up automatically by
`scripts/run-unit-tests.mjs`, i.e. `npm test`) asserts, with **no emulator and no DOM**:

1. `uploadPercent` — normal, 0-total, > total, NaN/negative → always finite 0–100.
2. `jitteredBackoffMs` — monotonic in `attempt`, bounded, never negative.
3. `isRetryableStorageError` — `storage/retry-limit-exceeded`, `storage/unknown`,
   `storage/server-file-wrong-size`, `storage/canceled`, our synthetic
   `storage/deadline-exceeded` → true; `storage/unauthorized`,
   `storage/invalid-argument`, `storage/quota-exceeded` → false (never spin on a real
   rejection).
4. `runWithRetry` — succeeds on attempt 1 (no sleep); retries a transient failure and
   returns the later success; **stops immediately** on a non-retryable error; exhausts at
   `attempts` and rethrows the last error; total attempts never exceed the bound.
5. `withTimeout` — resolves a fast promise, rejects a slow one with the given code and
   invokes the cancel hook exactly once.
6. progress store — subscriber receives published values, `getUploadProgress` reflects the
   last publish, unsubscribe stops delivery.

`scripts/test-image-resize.ts` extended with:

7. `chooseUploadBlob` — picks `encoded` on a real saving, `original` when the re-encode is
   bigger or barely smaller, and is junk-input total.
8. `nextEncodeStep` — strictly decreasing quality/edge, terminates (returns `null`).

All eight groups were written and observed **failing** (missing exports) before the
implementation landed, then green after.

## Not verifiable without a device

- Real-world wall-clock improvement of the multi-pass encode on a 12 MP phone photo
  (needs an actual phone camera capture; `createImageBitmap`/`canvas.toBlob` are DOM APIs
  the pure lane cannot exercise).
- That the resumable upload's `state_changed` progress events fire at a useful cadence
  over real mobile data, and that the 45 s stall / 3 min cap are the right numbers.
- Whether the stall timeout ever fires spuriously on a very slow-but-alive 2G link.
- The visual look of the progress bar on a real handset (no component test runner in
  play-web; `npm run test:ui` smoke covers render only).
