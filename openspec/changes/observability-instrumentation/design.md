# Design — Observability instrumentation

## Current behavior (authoritative refs — from the audit)

- **Server logging is near-absent.** The only `functions.logger` calls are:
  - `functions/src/maintenance/index.ts:95` (`warn` storage purge), `:136` (`info` prune count)
  - `functions/src/payments/index.ts:414` (`error` stripeWebhook failed)
  - `functions/src/storageUtil.ts:16` (`warn` deleteRunPhotos failed)
  Every other callable (`createGame`, `launchRun`, `joinRun`, `completeTask`, `submitTaskAnswer`,
  `finalizeRun`, `purchaseCredits`, `staffSignIn`, …) logs **nothing** — no entry, no error context.
- **Silent best-effort catches** (failure → no signal):
  - `functions/src/games/index.ts:137` publicGames delete, `:191`/`:192` playCount increments,
    `:227` creator lookup
  - `functions/src/runs/index.ts:206` game playCount increment
  - `functions/src/payments/index.ts:253` referrer `getUser`
  - `functions/src/users/index.ts:57,135,148` batch commit / data-export / recursiveDelete
- **Client crash seam exists but inert.** `apps/creator-web/src/services/telemetry.ts` defines
  `reportError` (console + optional `reporter`), `setCrashReporter`, and `initTelemetry()`
  (installs `window` `error`/`unhandledrejection` handlers; warns if `VITE_SENTRY_DSN` is set but no
  reporter registered). `ErrorBoundary.tsx:26` calls `reportError`. **No `setCrashReporter` call
  anywhere** ⇒ nothing ships off-device.
- **play-web has no telemetry funnel.** `apps/play-web/src/components/ErrorBoundary.tsx` exists and
  `main.tsx` mounts it, but there is **no** `apps/play-web/src/services/telemetry.ts` and no global
  handler install — async/promise crashes during play are never captured.

## Files to touch

| File | Change |
|---|---|
| `functions/src/obs/log.ts` | **NEW.** `logCall(meta, fn)` wrapper + `logBestEffort(op, ctx, err)` + `redact(...)`. Built on `firebase-functions` `logger`. |
| `functions/src/index.ts` | Wrap each root callable (`inviteStaff`, `staffSignIn`, `updateLocation`, `triggerSOS`, `submitStationPhoto`, `verifyStationCode`, `reviewStationSubmission`, `adjustTeamScore`, `pushAnnouncement`, …) via `logCall`. |
| `functions/src/runs/index.ts` | Wrap run callables; replace `:206` silent catch with `logBestEffort`. |
| `functions/src/games/index.ts` | Wrap game callables; replace `:137/:191/:192/:227` silent catches with `logBestEffort`. |
| `functions/src/payments/index.ts` | Wrap payment callables; replace `:253` silent catch; keep existing `:414` error log (route through helper). |
| `functions/src/gallery/index.ts`, `functions/src/users/index.ts` | Wrap callables; replace `users` `:57/:135/:148` silent catches. |
| `apps/creator-web/src/services/telemetry.ts` | In `initTelemetry`, when `VITE_SENTRY_DSN` set, lazy-import the provider and `setCrashReporter(captureException)`. |
| `apps/play-web/src/services/telemetry.ts` | **NEW** — mirror creator-web's module verbatim (funnel + global handlers + DSN-gated init). |
| `apps/play-web/src/components/ErrorBoundary.tsx` | Import and call `reportError(error, { boundary: 'play-root' })` in `componentDidCatch`. |
| `apps/creator-web/src/main.tsx`, `apps/play-web/src/main.tsx` | Call `initTelemetry()` at startup (creator already may; ensure both). |
| `apps/*/.env.example` | Document `VITE_SENTRY_DSN` (optional; absent ⇒ console-only). |

## The `logCall` model (server)

```ts
// functions/src/obs/log.ts
import { logger } from 'firebase-functions';

export interface CallMeta {
  callable: string;                 // e.g. 'launchRun'
  uid?: string;                     // context.auth?.uid
  runId?: string; gameId?: string;  // stable ids only — never secrets/PII
}

// Wrap a callable's body. Logs one structured line on success/known-error/crash.
export async function logCall<T>(meta: CallMeta, body: () => Promise<T>): Promise<T> {
  const startedAtMs = meta as unknown as number; // injected clock in tests (see strategy)
  try {
    const result = await body();
    logger.info('callable.ok', { ...meta /*, ms */ });
    return result;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code) logger.warn('callable.error', { ...meta, errorCode: code });   // HttpsError → expected
    else      logger.error('callable.crash', { ...meta, err: String(err) }); // unexpected
    throw err; // never swallow — re-throw so the client still gets the error
  }
}

export function logBestEffort(op: string, ctx: Record<string, unknown>, err: unknown): void {
  logger.warn('bestEffort.failed', { op, ...ctx, err: String(err) });
}
```

- **Redaction is structural:** `logCall` only accepts the typed `CallMeta` (ids + sizes), so a caller
  *cannot* accidentally pass a display name or answer key. Free-form fields are never logged.
- **Timing** uses an injectable clock (a `nowMs()` arg defaulted to `Date.now()` at the call site, not
  inside the pure helper) so the unit test stays deterministic — the project forbids `Date.now()` in
  testable pure logic.
- **Re-throw, never swallow:** `logCall` logs and re-throws; it changes *visibility*, not control flow.
- Silent catches become: `.catch((e) => logBestEffort('playCount.increment', { gameId }, e))`.

## Client wiring (Sentry behind the existing seam)

`initTelemetry()` already warns when `VITE_SENTRY_DSN` is set but no reporter is registered. The change
closes that loop:

```ts
export function initTelemetry(): void {
  /* ...existing idempotency + global handlers... */
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (dsn && !reporter) {
    void import('@sentry/browser').then((Sentry) => {
      Sentry.init({ dsn, tracesSampleRate: 0 });
      setCrashReporter((err, ctx) => Sentry.captureException(err, { extra: ctx }));
    });
  }
}
```

- **Lazy `import()`** keeps Sentry out of the main bundle (project rule: heavy deps behind dynamic
  import / `React.lazy`). No DSN ⇒ the import never runs ⇒ dev/emulator behavior is byte-identical to
  today.
- play-web's new `telemetry.ts` is a copy of the creator-web module (same API), so its `ErrorBoundary`
  and global handlers funnel through the same path.

## Test strategy (TDD — proves each guarantee)

- **`logCall` shape (pure → vitest):** `functions/src/obs/log.test.ts` — a **fake logger** is injected;
  assert (a) success path logs exactly one `info` with `callable`/`uid`/`runId` and **no** secret
  fields, (b) a thrown `HttpsError` (has `.code`) logs one `warn` with `errorCode` and **re-throws**,
  (c) an unexpected `Error` logs one `error` and re-throws, (d) `logBestEffort` logs `warn` and never
  throws. Redaction: pass an object containing a `displayName`/`answer` key in context → assert it is
  **not** present in the emitted record.
- **No-silent-swallow (e2e):** extend `scripts/e2e-verify.mjs` — force one best-effort path to fail
  (e.g. delete the publicGames doc out from under a duplicate) and assert the **callable still
  succeeds** (best-effort unchanged) — the logging itself isn't asserted in e2e (no log sink), it's
  covered by the unit test. This guards that wrapping didn't turn a non-fatal path fatal.
- **Callable wrapping didn't break behavior (e2e):** the **existing** full `npm run e2e` lifecycle
  must stay 100% green after every callable is wrapped — that is the regression proof that `logCall`
  is transparent to control flow.
- **Client (build + manual):** `npm run creator:build` / `npm run play:build` must pass with the
  lazy Sentry import. Manual: with no DSN, console-only (unchanged); the DSN path is verified by build
  + a smoke check that `initTelemetry()` doesn't throw when DSN unset. play-web telemetry parity is a
  pure module copy (no new user-facing string ⇒ no i18n surface).
- **i18n:** no user-facing text added ⇒ `npm run i18n:check` unaffected, but run it to confirm clean.

## New env var

- `VITE_SENTRY_DSN` (both apps, **optional**). Absent ⇒ console-only crash reporting (today's
  behavior). Documented in `apps/*/.env.example`; the real value lives in the gitignored `.env`.
  No server env var is added (Cloud Logging is automatic for Functions).
