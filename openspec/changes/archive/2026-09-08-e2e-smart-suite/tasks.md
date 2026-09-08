# Smart E2E Suite — tasks (RED → GREEN → REFACTOR)

## 1. Harness + diagnostics (e2e lane)

- [x] 1.1 Add `scenario()`, `expectError()`, error-code capture in `check`, per-callable latency
      sampling in `makeParty`, and the grouped end summary to `scripts/e2e-verify.mjs`.
- [x] 1.2 Wrap the existing independent blocks (partial stage, hints, task types, hidden
      location, referral, attempt limit, consent, safe zone, recap/replay/analytics, translate,
      discovery, hot zone, challenge) in scenarios; keep the core lifecycle one scenario.
- [x] 1.3 Replace tautological checks with real assertions (`updateGame accepted 3 stages` →
      `getGame` returns 3 stages).
- [x] 1.4 Run `npm run e2e` — all existing assertions still pass under the new harness.

## 2. Sanitizer allowlist

- [x] 2.1 Add `ALLOWED_TASK_KEYS` / `ALLOWED_SMART_KEYS` subset assertions on the participant
      payload in the core lifecycle + hidden-location scenarios. Run — green (or fix the list).

## 3. Invariant oracle + leaderboard parity

- [x] 3.1 Add `assertLeaderboardInvariants()` + score-conservation helpers.
- [x] 3.2 New scenario: 3 teams with divergent scores; assert oracle on `refreshLeaderboard`,
      parity of ordering with `finalizeRun`, per-task breakdown sums, Σ==team.score. Green.

## 4. Contention (TDD on the backend)

- [x] 4.1 RED: scenario — 2 cap-1 station tasks, 3 teams `requestNextTask` in `Promise.all`,
      creator reads `run.taskCounts` and asserts `≤ cap`; plus concurrent double
      `verifyStationCode` / `completeTask` scoring exactly once. Run `npm run e2e` — confirm the
      cap assertion FAILS (read-then-increment race) while double-submit passes (transactional
      idempotence).
- [x] 4.2 GREEN: make `assignTask` (and `releaseTask`) transactional in
      `functions/src/routing/assignNextTask.ts`; rebuild functions; re-run — cap holds.
- [x] 4.3 REFACTOR: `npm test` (routing unit lane) + `npm run typecheck` green.

## 5. Authz matrix

- [x] 5.1 Add the table-driven denial matrix scenario (player/stranger × owner-only callables).
      Run — green; extend the table if a gap is found (fix any real gap in `functions/` first).

## 6. Boundary fuzz

- [x] 6.1 Add the seeded boundary scenario (quiz casing/whitespace, numeric tolerance edge,
      geofence radius edge). Run — green.

## 7. v2 load simulator

- [x] 7.1 Write `scripts/simulate-run.mjs` (callable-driven, N concurrent teams, seeded, ends
      with the invariant oracle + taskCounts audit + latency table; non-zero exit on violation).
- [x] 7.2 Repoint `npm run simulate` to it; add `simulate:v1` for the legacy script + deprecation
      header on `simulate-tournament.mjs`. Run `npm run simulate` against the emulator — green.

## 8. Callable coverage guard (round 2)

- [x] 8.1 Introspect the served callables from the built lib (child process) and add a guard
      scenario that fails on any never-invoked callable (minus an EXEMPT list); add a long-tail
      scenario exercising the reads/ops/gallery/account callables the lifecycle skipped.
- [x] 8.2 GREEN: fix the bug the guard surfaced — `incrementTaskCopyCount` used
      `require('firebase-admin')` in an esbuild bundle → INTERNAL; switch to ESM `FieldValue` +
      `set({merge})`. Coverage now 66/66.

## 9. Property/invariant unit tests (round 2)

- [x] 9.1 Add `functions/src/__property__/invariants.property.test.ts` (seeded, no-emulator):
      buildRankings invariants + determinism, scoring bounds/monotonicity, matchesTaskAnswer,
      evaluateTrigger, rateLimit cap, haversine metric.
- [x] 9.2 GREEN: fix the bug a property surfaced — `taskScoreSmart` returned a negative score for
      a negative difficulty; clamp difficulty to `>= 0`.

## 10. Tooling + CI (round 2)

- [x] 10.1 Add `npm run verify` (fast gauntlet) + `npm run verify:emulator` (builds → e2e → rules
      → 8-team simulate under a self-booted suite).
- [x] 10.2 Add an 8-team concurrent-load smoke step to CI's emulator job.

## 11. Gates

- [x] 11.1 `npm run typecheck` · `npm run lint` · `npm test` (property tests green; one
      pre-existing unrelated em-dash copy failure flagged separately) · `npm run creator:build` ·
      `npm run play:build` · `npm run e2e` · `npm run test:rules` · `npm run simulate` — all green.
