## 1. Answer log — the pure core (shared)

- [x] 1.1 RED — write `scripts/test-answer-log.ts` against a not-yet-existing
      `packages/shared/src/answerLog.ts`. Encode: `buildAnswerLogEntry` trims and truncates to
      `MAX_ANSWER_LOG_ANSWER_LEN` (200) and returns `null` for a non-string / empty / whitespace-only
      answer; `appendAnswerLog` appends under the cap, and at `MAX_ANSWER_LOG_ENTRIES` (6) keeps the
      oldest 5 plus the newest (first-recorded and most-recent both survive, the middle is dropped);
      it is total for a malformed `existing` (not an array, entries that are not objects) and returns
      the input unchanged for a null entry; `stripAnswerLogsFromStages` removes every `answerLog`
      while leaving `earnedScore`, `status`, `startedAt`, `completedAt`, `actualMinutes`,
      `submittedAnswer` and `wasCorrect` byte-identical, is idempotent, and reports how many it
      removed. Run `npx tsx scripts/test-answer-log.ts` and confirm it fails on the missing module.
- [x] 1.2 GREEN — implement `packages/shared/src/answerLog.ts`: `AnswerLogKind`, `AnswerLogEntry`,
      `MAX_ANSWER_LOG_ANSWER_LEN`, `MAX_ANSWER_LOG_ENTRIES`, `ANSWER_LOG_RETENTION_DAYS = 30`,
      `buildAnswerLogEntry`, `appendAnswerLog`, `stripAnswerLogsFromStages`. Confirm 1.1 goes green.
- [x] 1.3 Add `answerLog?: AnswerLogEntry[]` to `RunTaskRecord` in `packages/shared/src/types/index.ts`
      with a comment stating it is SERVER + OWNER ONLY and why it is never allow-listed, and export
      the new module from `packages/shared/src/index.ts`.
- [x] 1.4 RED→GREEN — extend `scripts/test-test-mode.ts` to assert `sanitizeTeamForParticipant` omits
      `answerLog` from every task record in BOTH sealed and unsealed mode (feed a team whose records
      carry one). It should pass unchanged — that is the point: prove the allow-list already holds,
      so a future edit that adds the key fails loudly.

## 2. Answer log — writing it (functions)

- [x] 2.1 RED — add e2e assertions to `scripts/e2e-verify.mjs` in a new `recorded-answers` scenario:
      a team submits a WRONG answer then the CORRECT one to a quiz task on a normal (non-testMode)
      run; after the run, the owner's report exposes both submissions in order with
      `correct: false` then `correct: true`. Run `npm run e2e` and confirm the scenario fails.
- [x] 2.2 GREEN — widen `completeTaskForTeam`'s `extras` in `functions/src/runs/index.ts` with
      `answerLog?: AnswerLogEntry`, appended via `appendAnswerLog` onto `taskRec.answerLog` inside the
      transaction that already rewrites the stage array (no new read, no new transaction).
- [x] 2.3 GREEN — record on every grading path of `submitTaskAnswer`: the sealed path (reuse the
      existing `extras`), the correct path (pass new `extras` to `completeTaskForTeam`), the
      cost-active wrong path (append inside the existing transaction), and the no-cost wrong path
      (promote the counter merge-set to a transaction that increments AND appends). The replay guard
      must still return before any of them. Confirm 2.1 goes green for both submissions.
- [x] 2.4 GREEN — record in `submitSequenceStep` (`kind: 'sequence_step'` carrying `stepIndex`) and in
      `verifyStationCode` (`kind: 'station_code'`), riding each callable's existing team write.
- [x] 2.5 Regression guard — confirm grading behaviour is unchanged: run the existing e2e scenarios
      covering attempt limits, wrong-answer cost, hint escalation and the replay guard, and confirm
      the recorded verdict matches the graded one (a charged wrong answer records `correct: false`).

## 3. Answer log — 30-day retention (functions)

- [x] 3.1 RED — extend `scripts/test-answer-log.ts` with the retention boundary: a facts object one
      millisecond before `ANSWER_LOG_RETENTION_DAYS` is not eligible, at the boundary it is; the
      `answerLogPrunedAt` tombstone makes it `already_pruned`; an unfinalized run anchors on the
      maximum of its timestamps so one recent `updatedAt` vetoes the strip. Confirm it fails.
- [x] 3.2 GREEN — add `sweepExpiredAnswerLogs(now, maxRuns)` to `functions/src/maintenance/index.ts`,
      deciding per run with `evaluateRunPrune({ ...facts, piiPrunedAt: facts.answerLogPrunedAt }, now,
      ANSWER_LOG_RETENTION_DAYS)`, stripping each team's stages with `stripAnswerLogsFromStages`,
      committing through `chunk`/batched writes, and stamping `answerLogPrunedAt` on the run.
      Confirm 3.1 goes green.
- [x] 3.3 GREEN — make `pruneRunPII` strip answer logs and stamp `answerLogPrunedAt` too, so the
      90-day prune is a superset of the 30-day one; wire `sweepExpiredAnswerLogs` into the
      `pruneExpiredRunData` schedule, `pruneExpiredRunDataNow` and `pruneRunNow`.
- [x] 3.4 Verify idempotence end to end: run the sweep twice against the same emulator data and
      confirm the second pass strips nothing, changes no score, and logs zero runs.

## 4. Report + history callables (shared core first)

- [x] 4.1 RED — write `scripts/test-run-player-report.ts` against a not-yet-existing
      `packages/shared/src/runPlayerReport.ts`. Encode: one player row per team and one answer row per
      team × stored task record; rank taken from `run.leaderboard` when present (and equal to it),
      otherwise a score-then-time ordering flagged `provisional`; `answersUnavailable: true` for an
      answerable mission with no `answerLog` and no `submittedAnswer`, and NO answer channel at all
      for `field` / `geofence` / `photo`; a task record naming a mission the game no longer has is
      still emitted under its id with an unknown title; a team with no `stages` and a non-finite score
      still yields a row with a zeroed score and does not affect any other team; the builder reads no
      clock. Confirm it fails.
- [x] 4.2 GREEN — implement `packages/shared/src/runPlayerReport.ts` (`buildRunPlayerReport` returning
      `{ meta, players, answers, missions }`) and export it from the barrel. Confirm 4.1 goes green.
- [x] 4.3 RED — extend the `recorded-answers` e2e scenario: `listMyRuns` returns the FINISHED run
      (and, with a `gameId`, only that game's runs, newest first, excluding a soft-deleted game's);
      `getRunPlayerReport` returns players and per-mission answer rows for the owner. Add both
      callables to the e2e **authz denial matrix** (participant / stranger / other-run staff must get
      `permission-denied`). Confirm the new assertions fail.
- [x] 4.4 GREEN — implement `listMyRuns` and `getRunPlayerReport` in `functions/src/runs/index.ts`
      (owner gate on the run document's own `ownerUid`, `assertGameNotDeleted`, rate-limited) and
      re-export both from `functions/src/index.ts`. Confirm 4.3 goes green and the callable coverage
      guard passes.
- [x] 4.5 Add typed wrappers `listMyRuns` and `getRunPlayerReport` to
      `apps/creator-web/src/services/calls.ts` with the result types.

## 5. Excel export (creator-web, pure first)

- [x] 5.1 RED — write `scripts/test-run-report-export.ts` against a not-yet-existing
      `apps/creator-web/src/lib/runReportExport.ts`. Encode: `buildReportWorkbook(report, labels)`
      yields exactly three sheets (players / answers / missions) each with a header row; one answer
      row per player × mission with several recorded submissions flattened into one readable cell in
      order with their verdicts; an `answersUnavailable` row renders the explicit "not recorded"
      label, NOT an empty string; a mission with no answer channel renders neither; Hebrew strings
      pass through unaltered; a non-finite score renders as 0; the builder is pure (no DOM, no
      dynamic import). Confirm it fails.
- [x] 5.2 GREEN — implement `apps/creator-web/src/lib/runReportExport.ts`: the pure workbook row model
      plus a thin `downloadReportWorkbook()` that `await import('write-excel-file')` and writes the
      file. Add `write-excel-file` to `apps/creator-web/package.json`. Confirm 5.1 goes green.

## 6. Creator UI

- [x] 6.1 Add HE + EN dictionary blocks to `apps/creator-web/src/i18n.ts` for the run-history and
      run-report surfaces (titles, column headers, empty states, the 30-day retention notice, the
      "not recorded" label, export button and error copy). Every string routed through `t.*`.
- [x] 6.2 Build `apps/creator-web/src/pages/RunHistoryPage.tsx` — runs newest-first from `listMyRuns`,
      optional `?game=` filter, a live/finished badge, and rows that route to `/run/:gameId/:runId`
      when live and `/report/:gameId/:runId` when finished, with a skeleton, an error retry and an
      empty state.
- [x] 6.3 Build `apps/creator-web/src/pages/RunReportPage.tsx` — run header (game, date, duration,
      players, completion), a standings table, an expandable per-player breakdown showing each mission
      with the player's own recorded answers and verdicts plus their submitted media, the retention
      notice, and the export button wired to `downloadReportWorkbook`.
- [x] 6.4 Mount both routes in `apps/creator-web/src/App.tsx` through `lib/lazyWithRetry.ts` (never
      bare `React.lazy`).
- [x] 6.5 Add the entry points: make the Dashboard 🏁 total-runs tile a link to `/history`, add a
      "past runs" action to the game card and to the Builder header (both to `/history?game=<id>`),
      and link the Run Console's after-the-run group to `/report/:gameId/:runId`.
- [ ] 6.6 **STILL OPEN** (blocked, not skipped) — verify in the preview: a concurrent session owns
      ports 5180/5181 and the default-block emulator, and the process holding 5180 answers no HTTP,
      so a live walkthrough would have meant killing another agent stack. Everything a build can
      prove is proven (typecheck, creator:build, i18n:check:strict, the pure view-model suites);
      what is NOT yet eyeballed is: the history lists a finished run, the report renders per-player
      missions with recorded answers, and the export downloads a workbook that opens with Hebrew
      intact. Check RTL (logical `ms-`/`text-start` classes, no `text-zinc-*` on light surfaces).

## 7. Gates

- [x] 7.1 Confirm `write-excel-file` is absent from the creator entry chunk by inspecting the
      `npm run creator:build` chunk listing (it must appear only in its own lazy chunk).
- [x] 7.2 Run `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · origin:check · i18n:check:strict) and confirm every gate is green, with zero new
      PART B hardcoded-string findings.
- [x] 7.3 Run `npm run e2e` and confirm all scenarios pass, including the new `recorded-answers`
      scenario, the widened authz denial matrix and the callable coverage guard.
- [x] 7.4 Run `npm run verify:emulator` (redirected to a file, exit code captured — never piped
      through `tail`) and confirm e2e, both rules suites, simulate and adversarial simulate are green.
