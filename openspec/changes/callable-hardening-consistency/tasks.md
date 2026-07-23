## 1. RED — failing tests first

- [ ] 1.1 Create `scripts/test-callable-hardening.ts` in the house style of
      `scripts/test-public-task-backfill.ts` (`ok(cond, msg)`, `passed`/`failed`, non-zero exit),
      importing `parseCallables`, `hasAuthAssertion`, `hasAuditWrite`, `findDirectOnCall`,
      `resolveReexport`, `PUBLIC_CALLABLES`, `PRIVILEGED_CALLABLES` and `CALLABLE_FLOOR` from
      `./lib/callableHardening.mjs`.
- [ ] 1.2 Layer 1 — encode the synthetic-fixture cases from the design's Test Strategy for
      `parseCallables`, `hasAuthAssertion`, `hasAuditWrite`, `findDirectOnCall` and
      `resolveReexport`, each asserted in BOTH the conforming and the non-conforming direction. No
      fixture may read the real tree.
- [ ] 1.3 Layer 2 — encode the contract over the real `functions/src/**`: the D9 anti-vacuity
      assertions (scan target exists, callable count ≥ floor), no direct `onCall` outside the
      wrapper module, every callable authenticates or is declared public, every declared-privileged
      callable audits, every callable is re-exported from the entry point, and every declared
      exemption resolves to a real callable.
- [ ] 1.4 Run `npx tsx scripts/test-callable-hardening.ts` and confirm it FAILS because the analyzer
      module does not exist yet. Record the failure verbatim.

## 2. GREEN — the analyzer

- [ ] 2.1 Add `scripts/lib/callableHardening.mjs` with the pure decision functions: `parseCallables`
      (declaration scan, bodies sliced at the next declaration, 1-based lines, multi-line
      declarations tolerated), `hasAuthAssertion` and `hasAuditWrite` (markers plus exactly one
      level of same-file delegation, per D4), `findDirectOnCall`, and `resolveReexport`
      (`export *` vs explicit multi-line name list).
- [ ] 2.2 Add the declared exemption tables — `PUBLIC_CALLABLES` and `PRIVILEGED_CALLABLES`, each
      entry a name mapped to a written reason (D3) — plus `CALLABLE_FLOOR` and the file-walk helper.
- [ ] 2.3 Re-run `npx tsx scripts/test-callable-hardening.ts`. Layer 1 must be fully green; Layer 2
      must now FAIL on the real accountability gaps rather than on a missing module. Record that
      failure verbatim — it is the RED for section 3.

## 3. GREEN — close the accountability gaps

- [ ] 3.1 Add three action-type constants to `functions/src/obs/audit.ts` alongside the existing
      game-lifecycle ones: run PII pruned, run PII sweep, public-task backfill.
- [ ] 3.2 Thread the operator through the game purge sweep: give `sweepPurgeableGames` an
      `operatorId` parameter defaulting to the system operator identity (so the scheduled job's call
      site is unchanged), pass it to `purgeGameTree`, and have `purgeDeletedGamesNow` pass the
      calling admin's uid (D6).
- [ ] 3.3 Add a single best-effort audit write to `pruneRunNow` naming the operator, the run, and
      what was destroyed; and one to `pruneExpiredRunDataNow` naming the operator and the number of
      runs pruned. Both AFTER the action completes (D7, D8).
- [ ] 3.4 Add a single best-effort audit write to `backfillPublicTaskCoordinatesNow` naming the
      operator and the page outcome, marking a report-only invocation as a dry run (D7).
- [ ] 3.5 Re-run `npx tsx scripts/test-callable-hardening.ts` — fully green.

## 4. REFACTOR / verify

- [ ] 4.1 Confirm the guard is picked up by the aggregator (`node scripts/run-unit-tests.mjs` lists
      `test-callable-hardening.ts`).
- [ ] 4.2 Gates: `npm run typecheck`, `npm run lint`, `npm test` — all green. Client builds are NOT
      required (no `packages/shared` types were touched).
- [ ] 4.3 Do NOT edit `scripts/e2e-verify.mjs` (owned by another lane). Report the three emulator
      assertions from the design's Test Strategy, and note that the suite's callable-coverage guard
      already requires a scenario for `backfillPublicTaskCoordinatesNow`.
