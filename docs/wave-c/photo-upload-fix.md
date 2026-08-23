# Wave C — photo upload has never worked (P0)

## Symptom (user-confirmed)
Uploading a picture in a photo mission has **never** succeeded, not once. The progress bar
runs 0 → 100% quickly, the button then sits on `עובד…`, and the attempt finally fails with
`לא הצלחנו לשמור את התמונה. צלמו שוב.`

## Root cause (confirmed by reading the code path end to end)
`requireStorageUrl(url, runId, uid)` in `packages/shared/src/validation.ts` extracted the Storage
object path from only two URL shapes:

1. a **production** download URL — `https://firebasestorage.googleapis.com/v0/b/{bucket}/` for one
   of `FIREBASE_STORAGE_BUCKETS`, or
2. a `gs://` URL.

Anything else left `objectPath === null`, and the guard failed with exactly the Hebrew string above
(`validation.ts`, the `storagePath` failure).

Every local/playtest environment serves Storage from the **emulator**, so `getDownloadURL()` returns
`http://127.0.0.1:9199/v0/b/<bucket>/o/<encodedPath>?alt=media&token=…` (and, behind
`npm run playtest` / `playtest:ngrok`, the same path under the single tunnel origin — `scripts/proxy.mjs`
fronts Storage :9199 for `/v0/b/*`). Neither shape starts with a production origin, so the
extraction always produced `null` and `submitStationPhoto` always threw `invalid-argument`.

That is deterministic, not flaky — hence "never worked, not once". `TaskRunner.photo()` maps that
rejection through `isStoragePathError()` to `t.task.photoSaveRetry`, which is the exact string the
user saw. The chain is fully explained with no unknowns.

**Corroboration:** `docs/night-sim/02-browser-fidelity.md` and `scripts/simulate-browser-run.mjs`
(lines ~40 and ~290) already document this — the browser sim had to *rewrite the bucket/URL* to get
a photo submit to pass, i.e. the harness worked around the bug instead of reporting it.

### Same defect in creator task media — YES
`isFirebaseStorageUrl(url)` used the identical production-origin prefix test, and it is the trust
boundary for creator-uploaded task media: `normalizeTaskMedia()` (`validation.ts`) silently **drops**
any `image`/`video` entry whose URL fails it, and `functions/src/games/index.ts::normalizeStagesMedia`
runs every `createGame`/`updateGame` write through it. So against the emulator, a creator who
uploaded an image/video to a task had it silently discarded on save. Fixed the same way.

## The fix

### 1. Opt-in relaxed origin, decided by the caller
`validation.ts` is pure (no `admin`, no env reads) and must stay pure, so the relaxation is an
explicit parameter, never an env lookup inside the validator:

- `requireStorageUrl(url, runId, uid, { allowLocalEmulator })`
- `isFirebaseStorageUrl(url, { allowLocalEmulator })`
- `isTaskMediaValid(m, opts)` / `normalizeTaskMedia(input, opts)` thread the same option.

All options are optional and default to `false`, so **every existing call site keeps byte-identical
production behaviour**.

The two server call sites pass `process.env.FUNCTIONS_EMULATOR === 'true'`:
- `functions/src/index.ts` → `submitStationPhoto`
- `functions/src/games/index.ts` → `normalizeStagesMedia` (createGame/updateGame)

### Production-safety argument
- `FUNCTIONS_EMULATOR` is set to `'true'` **only** by the Firebase Functions emulator. Deployed
  functions never have it, so the relaxed branch is unreachable in production — it is not a
  client-controlled input, not a config file, and not a header.
- With the flag off, the accepted set is byte-identical to before: `FIREBASE_STORAGE_ORIGINS` +
  `gs://`. The anti-injection guard from `prelaunch-critical-fixes` M3 is not weakened.
- The relaxed branch only widens the **origin**; the real IDOR guard — the object path must start
  with `runs/{runId}/teams/{uid}/` — is applied identically in every mode. A team still cannot
  reference another team's or another run's folder even when the flag is on.
- The relaxed branch still requires the Firebase Storage REST shape
  `/v0/b/<bucket>/o/<encodedObjectPath>`; an arbitrary URL such as `https://evil.com/photo.jpg`
  is rejected in both modes.

### 2. The post-100% hang
`services/firebase.ts::uploadResilient` sets progress 100 the instant `uploadBytesResumable`
resolves and then awaits `getDownloadURL(r)` — **with no timeout**, while every other leg of the
pipeline (upload attempt, stall watchdog, callable) is bounded. Over the emulator, and especially
through the playtest tunnel, that metadata GET is the slow leg, and if it never settles the player
sits on `עובד…` forever with no outcome.

Fix: wrap it in the existing `withTimeout(..., 'storage/deadline-exceeded')`. That code is in
`RETRYABLE_STORAGE_CODES`, so a slow metadata fetch is retried by the surrounding `runWithRetry`
instead of hanging, and the whole upload is now bounded on every leg.

**Not** a retry-classification bug: `RETRYABLE_CALLABLE_CODES` in `services/firebase.ts` is
`{internal, unavailable, deadline-exceeded, aborted}` — `invalid-argument` is absent, so the
validation rejection already failed fast (one round trip). The perceived "hang" before the error was
the un-timed `getDownloadURL` plus the emulator callable round trip, not a 3 × 20 s retry loop.

The busy state itself was already safe: `TaskRunner.photo()` / `.audio()` clear `busy` and the
progress store in `finally`, on success and on every error path.

## Tests (TDD, RED first)
`scripts/test-storage-url.ts` (pure lane, run by `npm test`) extended with:
- production origins + `gs://` still accepted with the flag off **and** on;
- an arbitrary external URL rejected in **both** modes;
- an emulator URL (`http://127.0.0.1:9199/v0/b/…`) rejected with the flag off, accepted with it on;
- a proxied tunnel URL (`https://<host>/v0/b/…`, no port) accepted with the flag on;
- the `runs/{runId}/teams/{uid}/` prefix still enforced in emulator mode — another team's folder and
  another run's folder are still rejected;
- `isFirebaseStorageUrl` / `normalizeTaskMedia` emulator-mode equivalents.

End to end: the `scripts/e2e-verify.mjs` photo scenario now submits a **real emulator-hosted**
download URL shape so a regression fails the suite.
