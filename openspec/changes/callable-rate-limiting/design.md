# Design — Per-uid callable rate limiting

## Current behavior (authoritative refs — from the audit + roadmap)

- **Existing throttles are point-specific:** `packages/shared/src/staffThrottle.ts`
  (`shouldLockout`/`isWithinCooldown`, used by `staffSignIn`) and the per-referrer cap in
  `claimReferral` (`functions/src/payments/index.ts`). There is **no general per-uid call limiter**.
- **Hot, currently-unbounded callables:**
  - `functions/src/runs/index.ts` — `submitTaskAnswer` (per-task `attemptLimit` only; aggregate call
    rate unbounded), `requestNextTask`/`getRecommendedTasks` (routing math + reads on every call),
    `getMyTeamState` (poll target), `joinRun`.
  - `functions/src/index.ts` — `verifyStationCode`, `updateLocation` (live-map ping write),
    `triggerSOS` (alert write).
- **Roadmap blueprint already exists:** `functions/src/__planned__/v21-security-and-reliability.todo.test.ts`
  → `describe('Appendix B #19 — callable rate limiting (throttle per uid) …')` with five `test.todo`
  lines: pure `rateLimit(key, max, windowMs)` allow-then-deny, window reset, independent buckets,
  e2e `submitTaskAnswer` past-limit → `resource-exhausted`, e2e `requestNextTask` throttled without
  breaking cadence. Per `openspec/config.yaml`, the FIRST task converts those todos into real
  failing tests.

## Files to touch

| File | Change |
|---|---|
| `packages/shared/src/rateLimit.ts` | **NEW.** Pure fixed-window predicate + per-callable budget constants. |
| `packages/shared/src/index.ts` | `export * from './rateLimit'`. |
| `functions/src/rateLimitStore.ts` | **NEW.** `enforceRateLimit(uid, bucket, limit, windowMs, runId?)` — read-modify-write the counter doc in a transaction, throw `resource-exhausted` past the cap. Uses `FIRESTORE_PATHS` (add a `rateLimit` path helper). |
| `functions/src/runs/index.ts` | Call `enforceRateLimit` at the top of `submitTaskAnswer`, `requestNextTask`, `joinRun`. |
| `functions/src/index.ts` | Call `enforceRateLimit` at the top of `verifyStationCode`, `updateLocation`, `triggerSOS`. |
| `firestore.rules` | Deny client read/write on the `rateLimits` counter docs (server-only). |
| `functions/src/__planned__/v21-security-and-reliability.todo.test.ts` | Convert the `#19` `test.todo` lines into real assertions (move pure ones to `scripts/test-rate-limit.ts` / a vitest file). |
| `scripts/test-rate-limit.ts` | **NEW** pure predicate tests. |
| `scripts/e2e-verify.mjs` | New assertions: spam `submitTaskAnswer` past budget → `resource-exhausted`; normal `requestNextTask` cadence stays allowed. |

## The pure limiter (unit-testable, no clock, no emulator)

```ts
// packages/shared/src/rateLimit.ts
export interface WindowState { count: number; windowStartMs: number }
export interface RateDecision { allowed: boolean; nextState: WindowState; retryAfterMs: number }

/** Fixed-window limiter. `nowMs` is injected — the predicate is pure & deterministic. */
export function rateLimit(
  state: WindowState | null, max: number, windowMs: number, nowMs: number,
): RateDecision {
  const inWindow = state && nowMs - state.windowStartMs < windowMs;
  const count = inWindow ? state.count : 0;
  const windowStartMs = inWindow ? state!.windowStartMs : nowMs;
  if (count >= max) {
    return { allowed: false, nextState: { count, windowStartMs },
             retryAfterMs: windowMs - (nowMs - windowStartMs) };
  }
  return { allowed: true, nextState: { count: count + 1, windowStartMs }, retryAfterMs: 0 };
}

// Generous per-callable budgets — normal play never trips these; abuse does.
export const RATE_LIMITS = {
  submitTaskAnswer: { max: 30, windowMs: 60_000 },  // 30 answers/min/uid
  requestNextTask:  { max: 60, windowMs: 60_000 },  // routing isn't a poll endpoint
  joinRun:          { max: 10, windowMs: 60_000 },
  verifyStationCode:{ max: 30, windowMs: 60_000 },
  updateLocation:   { max: 120, windowMs: 60_000 }, // live ping ~ every few sec is fine
  triggerSOS:       { max: 5,  windowMs: 60_000 },
} as const;
```

- **Why fixed-window:** trivially pure and deterministic — `rateLimit(state, max, windowMs, nowMs)`
  takes the clock as an argument, matching the project's `Date.now()`-forbidden testing rule, exactly
  like `staffThrottle`'s injected clock.
- **Independent buckets:** keying the store doc by `{bucket}__{uid}` (or a per-run subdoc for
  run-scoped buckets) gives each uid an independent window for free — no shared state in the predicate.

## The server store (`enforceRateLimit`)

```ts
// functions/src/rateLimitStore.ts (sketch)
export async function enforceRateLimit(uid, bucket, { max, windowMs }, runId?) {
  const ref = db.doc(FIRESTORE_PATHS.rateLimit(bucket, uid, runId));
  const decision = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = rateLimit(snap.exists ? snap.data() as WindowState : null, max, windowMs, Date.now());
    tx.set(ref, d.nextState);
    return d;
  });
  if (!decision.allowed) {
    logger.warn('rateLimit.tripped', { bucket, uid, runId });
    throw new functions.https.HttpsError('resource-exhausted', bilingual(
      'Too many requests — slow down.', 'יותר מדי בקשות — האט/י לרגע.'));
  }
}
```

- The transaction makes the read-modify-write **race-safe** (concurrent calls can't both slip under
  the cap), the same discipline `submitTaskAnswer`'s `taskAttempts` uses.
- `Date.now()` lives **here** (server edge), never inside the pure predicate.
- Run-scoped buckets (`submitTaskAnswer`, `requestNextTask`, `updateLocation`) store the counter under
  the run subtree so it's pruned with the run by the existing 90-day retention job; global buckets
  (`joinRun`) use a top-level `rateLimits/{bucket}__{uid}`.

## Test strategy (TDD — proves Appendix B #19)

- **Pure (vitest / `scripts/test-rate-limit.ts`)** — convert the `#19` todos:
  - allows up to `max` calls then denies within the window;
  - window resets after `windowMs` (calls allowed again);
  - different uids/keys have independent buckets;
  - `retryAfterMs` is correct at the boundary (and 0 while allowed).
- **e2e (`scripts/e2e-verify.mjs`)** — convert the `[e2e]` todos:
  - join a team, call `submitTaskAnswer` past `RATE_LIMITS.submitTaskAnswer.max` within a window →
    the over-limit call returns `resource-exhausted`;
  - a normal-cadence `requestNextTask` sequence (well under budget) keeps succeeding — **proves
    normal play isn't throttled** (the explicit non-regression the roadmap calls out).
- **Rules** — extend `scripts/test-rules.mjs`: a client cannot read or write a `rateLimits` doc.
- **No new UI string** — the `resource-exhausted` error reuses the generic call-error surface; confirm
  the existing copy renders (run `npm run i18n:check`; add a bilingual string only if missing).

## New Firestore paths / rules

- New `rateLimits` counter docs (top-level `rateLimits/{bucket}__{uid}` and/or
  `…/runs/{runId}/rateLimits/{bucket}__{uid}`), added to `FIRESTORE_PATHS`. **Server-write-only** —
  `firestore.rules` denies client read + write (`allow read, write: if false;`).
- No new env var. No new index (counter docs are fetched by id, never queried).
