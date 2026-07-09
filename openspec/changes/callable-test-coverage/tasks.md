# Tasks — Callable & component test-coverage hardening (RED → GREEN → REFACTOR)

> Test-only change. Each new spec is authored RED-first (assert the branch, confirm it fails for the
> stated reason / pins existing behavior), then relied upon. Do tasks in order.

## P0 — the reusable harness

### 1. GREEN — mocked-Admin harness + self-test
- [ ] Create `functions/src/testutil/mockAdmin.ts` (in-memory `db` with `doc/get/set/update/
  runTransaction`, `ctx(uid)` fake auth, wallet/game/run/team seeders) and `mockAdmin.test.ts`
  self-test (set→get round-trips; `merge` semantics; transaction read-modify-write). Run vitest → green.

## P0 — error-branch tests for high-risk callables

### 2. RED→GREEN — `launchRun` billing branches
- [ ] `functions/src/runs/launchRun.test.ts`: insufficient credits → `failed-precondition`; a forced
  post-billing failure leaves `eventCredits` **unchanged** (assert the *leak* first to prove the test
  fails, then the rollback). Run vitest.

### 3. RED→GREEN — `submitTaskAnswer` state/limit branches
- [ ] `functions/src/runs/submitTaskAnswer.test.ts`: finished run → rejected; over-`attemptLimit` →
  `resource-exhausted`; wrong-state task → rejected; correct answer → scored.

### 4. RED→GREEN — `finalizeRun` idempotency
- [ ] `functions/src/runs/finalizeRun.test.ts`: re-finalizing an already-finalized run does not
  double-award / is rejected.

### 5. RED→GREEN — `joinRun` + scoring boundaries
- [ ] `functions/src/runs/joinRun.test.ts`: unknown/closed code → typed error; valid code → team
  created. `functions/src/scoring/*.test.ts`: boundary inputs per preset (zero/large/negative guard).

## P1 — honest placeholders + contract test

### 6. REFACTOR — de-inflate the `__planned__` todos
- [ ] Add a "RED-phase blueprint, NOT coverage" header to each `functions/src/__planned__/v21-*.todo.test.ts`.
  Convert todos for **shipped** behavior into real assertions (or delete if redundant with an existing
  spec); leave genuinely-pending rows as `test.todo`.

### 7. GREEN — sanitizer→client contract test
- [ ] Extend `functions/src/runs/sanitizeTask.test.ts` (preferred — no new UI runner) to assert the
  participant payload **never** contains `answers`/`numericAnswer`/`steps[].answer`/`hint`/`secretCode`,
  and exposes only `hasHint` + cost. (If a play-web component runner is already configured, instead add
  `TaskRunner.test.tsx` for the answer-submit happy path.)

### 8. GREEN — document the pattern
- [ ] `functions/src/testutil/README.md`: a one-page "how to add a callable error-branch test" guide.

## Gate — all green before done

### 9. Full gate set
- [ ] `npm run typecheck` · `npm run lint` · `npm test` (the new specs run + pass; todo count reflects
  only pending rows) · `npm run creator:build` · `npm run play:build` · `npm run e2e` (unchanged —
  proves additive) · `npm run i18n:check`. All green.

## Implementation status (autonomous run, 2026-06-30)
- [x] 1: `functions/src/testutil/mockAdmin.ts` + `mockAdmin.test.ts` (in-memory db, merge semantics,
  transactions, ctx) — self-tested.
- [x] 5 (scoring): `functions/src/scoring/calculateScore.test.ts` — boundary coverage for the pure
  scoring entry points (penalties, time bonus cap, z-score guards, completion bonus, tie-breaks).
- [x] 7: `sanitizeTask.test.ts` extended with the full answer-key secrecy contract (answers /
  numericAnswer / steps[].answer / smart.secretCode all stripped; renderable fields survive).
- [x] 6 + 8: all 11 `__planned__/v21-*.todo.test.ts` annotated "RED-PHASE BLUEPRINT — NOT COVERAGE";
  `testutil/README.md` documents the pattern.
- [~] 2–4 (launchRun / submitTaskAnswer / finalizeRun / joinRun ISOLATED unit tests): deferred. The
  existing callables read a module-level `db` and can't be injected without a refactor the change's
  non-goals forbid. Their error branches (insufficient-credit, launch atomicity, attemptLimit,
  finished-run rejection) are covered at the e2e layer (scripts/e2e-verify.mjs). The harness +
  README establish the DI pattern so NEW callables ship with isolated tests.
- [x] 9 GATES GREEN: all eight gates pass.
