# Proposal — Per-uid callable rate limiting (anti-abuse / anti-spam)

## Why

The auth-anticheat-hardening change (archived 2026-06-27) closed the worst brute-force hole —
**staff-PIN** sign-in now locks out after 5 failures — and rate-limited `claimReferral` per referrer.
But that was point-specific. The audit (2026-06-30) confirms there is **no general per-caller rate
limit** on the high-frequency participant callables. A single authenticated client (or a buggy/retry
loop) can hammer:

- `submitTaskAnswer` — unbounded answer attempts across tasks (the per-task `attemptLimit` caps one
  task, not the aggregate call rate; a script can still spray the whole game).
- `requestNextTask` / `getRecommendedTasks` / `getMyTeamState` — each runs routing math + Firestore
  reads; a tight poll loop is a cheap way to load the backend during a live event.
- `joinRun` / `verifyStationCode` / `updateLocation` / `triggerSOS` — spammable write/ops paths.

This is exactly **Appendix B #19 — "callable rate limiting (throttle per uid)"**, which already has a
RED-phase blueprint in `functions/src/__planned__/v21-security-and-reliability.todo.test.ts`. This
change realizes that row: a small, pure, unit-tested **fixed-window limiter** plus a thin Firestore-
backed counter, applied to the sensitive callables, returning `resource-exhausted` past the limit.

No product features change — it converts "unbounded" into "fair-use bounded," proven by converting
the existing `test.todo` stubs into real tests.

## What Changes

> Observable behavior. No new features — abusive call volume is bounded.

**P0 — pure limiter + wiring**
- A pure `rateLimit(state, max, windowMs, nowMs)` fixed-window predicate is added to
  `packages/shared` (alongside `staffThrottle`): given the current window's `{count, windowStartMs}`,
  it returns `{ allowed, nextState, retryAfterMs }`. Independent keys (uids) have independent buckets;
  the window resets after `windowMs`.
- A thin `enforceRateLimit(uid, bucket, limit, windowMs)` server helper persists the counter at
  `…/rateLimits/{bucket}__{uid}` (or a per-run subcollection for run-scoped buckets) and throws
  `resource-exhausted` (typed, bilingual) once the window cap is exceeded.

**P0 — apply to the hot callables**
- `submitTaskAnswer`, `requestNextTask`, `verifyStationCode`, `joinRun`, `updateLocation`,
  `triggerSOS` each call `enforceRateLimit` with a **generous** per-callable budget tuned so normal
  play never trips it (documented defaults in design), abusive volume does.

**P1 — alerting hook**
- A trip emits a structured `warn` (`rateLimit.tripped`, via the observability `logBestEffort`/logger)
  so repeated abuse is visible in logs.

## Capabilities

### New Capabilities
- `rate-limiting`: sensitive callables enforce a per-uid fixed-window call budget and return
  `resource-exhausted` past it, without impeding normal play cadence (Appendix B #19).

### Modified Capabilities
<!-- None — a new operational guarantee layered onto existing callables. Becomes baseline at archive. -->

## Surfaces touched

- **Shared:** `packages/shared/src/rateLimit.ts` (**new**, pure predicate + constants), re-exported
  from `packages/shared/src/index.ts`.
- **Callables:** `functions/src/runs/index.ts` (`submitTaskAnswer`, `requestNextTask`, `joinRun`),
  `functions/src/index.ts` (`verifyStationCode`, `updateLocation`, `triggerSOS`) — call
  `enforceRateLimit`; new server helper in `functions/src/obs/` or `functions/src/rateLimitStore.ts`.
- **Rules:** `firestore.rules` — the `rateLimits` counter docs are **server-write-only** (deny client
  read/write), like other run state.
- **Tests:** convert the `#19` `test.todo` stubs in
  `functions/src/__planned__/v21-security-and-reliability.todo.test.ts` into real tests; new
  `scripts/test-rate-limit.ts`; new e2e assertions in `scripts/e2e-verify.mjs`.
- **No UI changes** beyond surfacing the existing `resource-exhausted` error (already handled by the
  generic call-error path; verify copy exists).

## Non-goals

- **No IP-based or pre-auth limiting** — these callables require auth; the bucket key is the uid.
  Edge/CDN/App-Check throttling (Appendix B #27) is a separate concern.
- **No token-bucket/leaky-bucket smoothing** — a fixed window is sufficient and trivially testable;
  burst smoothing is out of scope.
- **No global/tenant-wide quota** — this is per-uid fair-use, not billing quota (credits already gate
  run creation).
- **No change to `attemptLimit`** (answer-correctness cap) — that stays; this bounds call *rate*.
- **No retry/back-off client logic** — clients already surface call errors; automatic retry queues
  are Appendix B #21 (offline queue), tracked separately.
