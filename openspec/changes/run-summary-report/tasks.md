# Tasks: run-summary-report

## 1. RED
- [x] Add `scripts/test-run-summary.ts` (tsx, auto-run by `npm test`) asserting `composeRunSummary`:
      standings pass through in order (score + totalSeconds intact); `completion` reuses
      `analytics.overallCompletionRate` / `analytics.tasks.length` / `recap.stats` verbatim;
      `feedback.topIssues` is `issueCounts` sorted descending and capped at 3; an empty-feedback run
      yields `responseCount:0` / `responseRate:0` / `topIssues:[]` with no NaN; and the result
      `JSON.stringify`s. Confirm RED (helper does not exist yet).

## 2. GREEN
- [x] Add `packages/shared/src/runSummary.ts` (`RunSummary` types + `composeRunSummary`, pure, reusing
      `RunRecap` / `RunAnalytics` / `RunFeedbackSummary` shapes). Export from `packages/shared/src/index.ts`.
- [x] `npm run shared:build`; the pure test passes GREEN.
- [x] Add `functions/src/runs/runSummaryEmail.ts`: `RUN_SUMMARY_EMAIL_ENABLED` flag (default OFF) +
      `sendRunSummaryEmail(summary, recipient)` no-op-with-`logBestEffort` seam (no provider, no network).
- [x] In `functions/src/runs/index.ts`: add internal `buildRunSummaryResult(game, run, teams, responses)`
      (runs `buildRunRecap` + `computeRunAnalytics` + `computeFeedbackSummary` → `composeRunSummary`) and
      the `getRunSummary` callable (owner-only by access code, mirrors `getRunAnalytics`).
- [x] Re-export `getRunSummary` from `functions/src/index.ts` (next to `getRunRecap`/`getRunAnalytics`).
- [x] In `finalizeRun`, after the commit + player-profile/benchmark blocks, add the best-effort
      post-commit `sendRunSummaryEmail(...)` call (own try/catch → `logBestEffort`; NOT in a transaction).

## 3. Creator UI + i18n
- [x] `apps/creator-web/src/services/calls.ts`: `getRunSummary = callable<{ code: string }, RunSummary>('getRunSummary')`.
- [x] `apps/creator-web/src/pages/RunConsolePage.tsx`: add `RunSummaryPanel` (finished runs) showing
      standings + completion headline + feedback digest + the "will also be emailed once enabled" note.
- [x] Add EN + HE keys in `apps/creator-web/src/i18n.ts` for every new label (`t.runConsole.summary*`).
- [x] `npm run i18n:check` clean (PART A hard gate; zero new PART B findings).

## 4. E2E (callable-coverage guard)
- [x] In `scripts/e2e-verify.mjs`, after finalize, assert `getRunSummary({ code: accessCode })` (owner)
      returns non-empty `standings`, a numeric `completion.overallCompletionRate`, and a `feedback`
      digest; and that a non-owner caller is `permission-denied`. Keeps the coverage guard green.

## 5. Gates
- [x] `npm run typecheck` green (functions + creator-web; play-web tsc blocked only by an unrelated NavMap WIP).
- [x] `npm test` green.
- [x] `npm run lint` green.
- [x] `npm run creator:build` green.
- [x] `npm run play:build` green.
- [x] `npm run i18n:check` green.
- [ ] `npm run e2e` green (new `getRunSummary` scenario passes; coverage guard still 100%). (deferred to batched emulator run)
