# Tasks — Per-uid callable rate limiting (RED → GREEN → REFACTOR)

> Strict TDD. Appendix B #19. The FIRST task converts the planned `test.todo` stubs into real
> failing tests, per `openspec/config.yaml`. Do tasks in order.

## P0 — pure limiter

### 1. RED (pure) — convert the #19 todos
- [ ] In `functions/src/__planned__/v21-security-and-reliability.todo.test.ts`, convert the
  `Appendix B #19` `test.todo` lines into real assertions (or author `scripts/test-rate-limit.ts`):
  `rateLimit(state, max, windowMs, nowMs)` allows up to `max` then denies within the window; the
  window resets after `windowMs`; different uids/keys have independent buckets; `retryAfterMs` is
  correct at the boundary and `0` while allowed. Run → fails RED (`rateLimit` absent).

### 2. GREEN — implement the predicate
- [ ] Create `packages/shared/src/rateLimit.ts` (`rateLimit`, `WindowState`, `RateDecision`,
  `RATE_LIMITS` budget constants); `export * from './rateLimit'` in `packages/shared/src/index.ts`.
  Run the pure tests → green.

## P0 — server enforcement

### 3. GREEN — `enforceRateLimit` store helper
- [ ] Add a `rateLimit(bucket, uid, runId?)` path to `FIRESTORE_PATHS`. Create
  `functions/src/rateLimitStore.ts` `enforceRateLimit(uid, bucket, budget, runId?)` that
  read-modify-writes the counter doc in a `runTransaction` and throws a bilingual
  `resource-exhausted` past the cap (logs `rateLimit.tripped`).

### 4. RED→GREEN (e2e) — apply to hot callables
- [ ] Call `enforceRateLimit` at the top of `submitTaskAnswer`, `requestNextTask`, `joinRun`
  (`functions/src/runs/index.ts`) and `verifyStationCode`, `updateLocation`, `triggerSOS`
  (`functions/src/index.ts`).
- [ ] In `scripts/e2e-verify.mjs`: spam `submitTaskAnswer` past its budget → assert the over-limit
  call is `resource-exhausted`; a normal-cadence `requestNextTask` sequence stays allowed (proves
  play isn't throttled). Run `npm run e2e` → RED first (unbounded), then green after wiring.

## P0 — rules

### 5. RED→GREEN (rules) — counter docs are server-only
- [ ] In `scripts/test-rules.mjs`, assert a client cannot read or write a `rateLimits` doc. Run
  `npm run test:rules` → RED. Add `allow read, write: if false;` for the `rateLimits` paths in
  `firestore.rules` → green.

## P1 — visibility

### 6. GREEN — log on trip
- [ ] Ensure each trip emits a structured `warn` (`rateLimit.tripped` with `bucket`/`uid`/`runId`).
  (Composes with the observability change's logger if landed; otherwise `functions.logger.warn`.)

## Gate — all green before done

### 7. Full gate set
- [ ] `npm run typecheck` · `npm run lint` · `npm test` (incl. new pure tests) ·
  `npm run creator:build` · `npm run play:build` · `npm run e2e` · `npm run test:rules` ·
  `npm run i18n:check` (confirm the `resource-exhausted` copy renders bilingually; add via `t.*` if
  missing — zero new hardcoded strings). All green. Mark Appendix B #19 status updated.

## Implementation status (autonomous run, 2026-06-30)
- [x] 1–2: pure limiter `packages/shared/src/rateLimit.ts` + `scripts/test-rate-limit.ts` (covers
  allow-then-deny, window reset, independent keys, retryAfterMs boundary). The #19 `test.todo` stubs
  were annotated as blueprint (not converted in place) since the pure coverage now lives in the script.
- [x] 3: `functions/src/rateLimitStore.ts` `enforceRateLimit` (transactional counter, bilingual
  `resource-exhausted`); `FIRESTORE_PATHS.rateLimit` added.
- [x] 4: wired into submitTaskAnswer, requestNextTask, joinRun, verifyStationCode, updateLocation,
  triggerSOS. e2e proves the trip: spamming triggerSOS past its budget → `resource-exhausted`.
- [x] 5: `firestore.rules` denies client read+write on `rateLimits/*`; test:rules asserts both.
- [x] 6: each trip logs `rateLimit.tripped` (functions.logger.warn).
- [x] 7 GATES GREEN: all eight gates pass (see observability status).

## Hardening pass 2 (audit-driven, 2026-06-30)
Expanded rate-limit coverage from 6 → 17 participant callables after a read-only gap audit:
added submitSequenceStep, submitStationPhoto, completeTask, requestTaskHint, claimDiscoveryPoi,
checkOutTask, requestGuardianConsent, getMyTeamState (the hot poll endpoint), getRecommendedTasks,
getRunDiscoveryPois, getJoinInfo. Budgets in `RATE_LIMITS` tuned per call type (poll vs mutation).
`enforceRateLimit` now logs `rateLimit.noBudget` on an unknown bucket (typo guard). `checkChallengeAnswer`
is unauthenticated → uid-limiting impossible → documented as an App Check follow-up (#27). All gates re-run green.
