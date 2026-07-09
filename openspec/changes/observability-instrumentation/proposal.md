# Proposal — Observability instrumentation (logging, crash reporting, error funnel)

## Why

A 2026-06-30 production-readiness audit found the platform is **blind in production**: across the
whole `functions/` codebase there are only **4** `functions.logger` calls (maintenance prune, the
Stripe webhook, two storage purges) — every other callable runs the full game/run/score/payment
path with **zero structured logging**. When a live run misbehaves (a credit doesn't decrement, a
team can't advance, scoring drifts), there is no server-side trail to reconstruct what happened.

On the client, a crash-reporting **seam already exists** (`telemetry.ts` → `setCrashReporter` /
`reportError` + `initTelemetry` global handlers in creator-web), but **no provider is wired** (no
Sentry SDK, no DSN), and **play-web has no telemetry funnel at all** — its `ErrorBoundary` swallows
crashes locally with nothing shipped off-device. So participant-side crashes during a live event are
invisible.

Finally, **7+ `.catch(() => undefined)` / `.catch(() => null)`** sites in functions silently discard
errors (publicGames cleanup, playCount increments, user-data deletion, referrer lookup). A failure
there leaves stale denormalized data or an orphaned record with **no signal anyone can act on**.

This change closes the observability gap. It adds **no product features** — it makes existing
behavior diagnosable. It is the highest-leverage operational gap before scaling paid live events.

## What Changes

> Observable behavior. No new product features — the system becomes diagnosable.

**P0 — server-side structured logging**
- Every callable logs a **structured entry/exit record** through a shared `logCall` helper:
  `{ callable, uid, runId?, gameId?, ok, ms, errorCode? }`. Success logs at `info`, thrown
  `HttpsError` at `warn`, unexpected throw at `error` — all as structured JSON fields (not string
  concatenation) so they're queryable in Cloud Logging.
- The helper **redacts** secrets/PII: it never logs answer keys, PINs, access codes, photo bytes,
  participant display names, or full registration payloads — only stable ids and sizes.

**P0 — no more silent error swallowing**
- Every existing `.catch(() => undefined)` / `.catch(() => null)` best-effort site is replaced with
  a **logged** best-effort catch (`logBestEffort(operation, context, err)`) that still doesn't throw
  but emits a `warn` so the failure is visible. Behavior (non-fatal) is unchanged; only the silence
  is removed.

**P0 — client crash reporting wired end-to-end**
- A real crash reporter (Sentry) is registered behind the existing `setCrashReporter` seam in
  **both** creator-web and play-web, gated on a `VITE_SENTRY_DSN` env var (absent ⇒ console-only,
  exactly as today — zero behavior change in dev/emulator).
- **play-web gains a telemetry funnel** (`services/telemetry.ts` mirroring creator-web:
  `reportError` / `setCrashReporter` / `initTelemetry` global `error` + `unhandledrejection`
  handlers), and its `ErrorBoundary` routes through `reportError` like creator-web's does.

**P1 — minimal request correlation**
- `logCall` stamps each record with the Firebase-provided `eventId`/`instanceId` (or a generated
  short id) so a participant-reported issue can be correlated to its server log line.

## Capabilities

### New Capabilities
- `observability`: every callable emits a structured, secret-redacted entry/exit log line; all
  best-effort `.catch` sites log instead of silently swallowing.
- `crash-reporting`: a real crash provider is wired behind the existing client seam in creator-web
  **and** play-web, gated by `VITE_SENTRY_DSN`; play-web gets the same telemetry funnel + global
  handlers creator-web already has.

### Modified Capabilities
<!-- None — these are new operational guarantees layered onto existing callables/clients without
     changing their product behavior; they become the observability baseline at archive time. -->

## Surfaces touched

- **Callables:** all modules under `functions/src/**` (`index.ts`, `runs/index.ts`,
  `games/index.ts`, `payments/index.ts`, `gallery/index.ts`, `users/index.ts`, `maintenance/index.ts`)
  — wrap each callable body in / call the shared `logCall`; replace silent catches.
- **Shared (functions-local):** new `functions/src/obs/log.ts` (`logCall`, `logBestEffort`,
  redaction helpers). Not in `packages/shared` — it depends on `firebase-functions/logger`.
- **Client:** `apps/creator-web/src/services/telemetry.ts` (wire Sentry init),
  `apps/play-web/src/services/telemetry.ts` (**new**), `apps/play-web/src/components/ErrorBoundary.tsx`
  (route through `reportError`), both `main.tsx` entry points (`initTelemetry()` call), `.env.example`.
- **No Firestore schema, rules, or path changes.** No new callables.

## Non-goals

- **No metrics/tracing backend** (Cloud Trace spans, custom metrics, dashboards) — this change makes
  logs structured and crashes visible; dashboards/alerts are a follow-up operational task, not code.
- **No log-based alerting rules** (those are configured in GCP console, outside the repo).
- **No change to which errors are fatal** — best-effort stays best-effort; it just gets logged.
- **No PII/retention policy change** — redaction here only ensures we don't *add* PII to logs.
- **No Sentry account/DSN provisioning** — the code is DSN-gated and inert until a DSN is supplied.
